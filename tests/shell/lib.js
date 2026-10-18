/*
 * Helpers for tests that run inside a nested gnome-shell, loaded next to the
 * extension by run.sh. Results are logged under their own domain, which run.sh
 * picks out of the shell's output:
 *
 *   MSTEST-Message: …: PASS <name>
 *   MSTEST-Message: …: FAIL <name>: <details>
 *   MSTEST-Message: …: DONE failed=<n>
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function report(message) {
    GLib.log_structured('MSTEST', GLib.LogLevelFlags.LEVEL_MESSAGE, {
        MESSAGE: message,
    });
}

export function wait(ms) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Resolves to true as soon as `predicate` holds, or to false once `timeoutMs`
 * has passed. The shell settles over several frames, so a single look at its
 * state tells little; an exception from the predicate counts as "not yet".
 */
export async function until(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (predicate()) {
                return true;
            }
        } catch (_error) {
            // Not ready yet.
        }
        await wait(50);
    }
    return false;
}

/**
 * Watches every popup menu added to uiGroup from now on and records the ones
 * left on screen while closed. Call it when the test module loads, before the
 * extension builds its menus. Tests that call this must not open menus.
 *
 * A menu that is added and hidden in one go is mapped only for a moment and
 * never drawn. One that is still mapped once the main loop gets control back
 * will be in the next frame. Frames are the wrong thing to watch: the nested
 * shell draws few of them, and a menu can sit there unseen until one comes.
 */
export function watchMenus() {
    const shown = new Set();
    const watcher = {
        added: 0,
        destroyed: 0,
        shown: [],
        reset() {
            watcher.added = 0;
            watcher.destroyed = 0;
            watcher.shown = [];
            shown.clear();
        },
    };

    const checkLater = (menu) => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (menu.mapped && !shown.has(menu)) {
                shown.add(menu);
                watcher.shown.push(describeMenu(menu));
            }
            return GLib.SOURCE_REMOVE;
        });
    };

    Main.layoutManager.uiGroup.connect('child-added', (_group, actor) => {
        if (!(actor instanceof BoxPointer.BoxPointer)) {
            return;
        }
        watcher.added++;
        if (actor.mapped) {
            checkLater(actor);
        }
        const mappedId = actor.connect('notify::mapped', () => {
            if (actor.mapped) {
                checkLater(actor);
            }
        });
        actor.connect('destroy', () => {
            watcher.destroyed++;
            actor.disconnect(mappedId);
        });
    });
    return watcher;
}

function describeMenu(menu) {
    const labels = [];
    const collect = (actor) => {
        if (actor.text && !labels.includes(actor.text)) {
            labels.push(actor.text);
        }
        for (const child of actor.get_children()) {
            collect(child);
        }
    };
    collect(menu);
    return labels.slice(0, 3).join(' / ') || menu.toString();
}

function callMutter(path, iface, method, args) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.gnome.Mutter.ScreenCast',
            path,
            `org.gnome.Mutter.ScreenCast${iface}`,
            method,
            args,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result).deep_unpack());
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

/** Resolves to the id of the PipeWire node Mutter creates for `stream`. */
function waitForStreamNode(stream) {
    return new Promise((resolve, reject) => {
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            Gio.DBus.session.signal_unsubscribe(id);
            reject(
                new Error(
                    'Mutter created no PipeWire stream, is PipeWire running?'
                )
            );
            return GLib.SOURCE_REMOVE;
        });
        const id = Gio.DBus.session.signal_subscribe(
            'org.gnome.Mutter.ScreenCast',
            'org.gnome.Mutter.ScreenCast.Stream',
            'PipeWireStreamAdded',
            stream,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => {
                GLib.source_remove(timeoutId);
                Gio.DBus.session.signal_unsubscribe(id);
                resolve(parameters.deep_unpack()[0]);
            }
        );
    });
}

/** pipewiresrc finds a node by its serial, Mutter only tells its id. */
function nodeSerial(id) {
    const dump = Gio.Subprocess.new(
        ['pw-dump', `${id}`],
        Gio.SubprocessFlags.STDOUT_PIPE
    );
    return new Promise((resolve, reject) => {
        dump.communicate_utf8_async(null, null, (_dump, result) => {
            try {
                const [, stdout] = dump.communicate_utf8_finish(result);
                // Objects whose serial equals the id come out too.
                const node = JSON.parse(stdout).find((o) => o.id === id);
                resolve(node.info.props['object.serial']);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Plugs in a 1280×800 virtual monitor and resolves to a function that unplugs
 * it. Mutter creates the monitor only once something consumes the PipeWire
 * stream behind it, and sizes it after what the consumer asks for, so a
 * GStreamer pipeline reads the stream. Both go away with the shell: the
 * session is the shell's own, and the pipeline stops once its stream is gone.
 */
export async function plugMonitor() {
    const noProperties = new GLib.Variant('(a{sv})', [{}]);
    const [session] = await callMutter(
        '/org/gnome/Mutter/ScreenCast',
        '',
        'CreateSession',
        noProperties
    );
    const [stream] = await callMutter(
        session,
        '.Session',
        'RecordVirtual',
        noProperties
    );
    const nodeAdded = waitForStreamNode(stream);
    await callMutter(session, '.Session', 'Start', null);
    const serial = await nodeSerial(await nodeAdded);
    Gio.Subprocess.new(
        [
            'gst-launch-1.0',
            '-q',
            'pipewiresrc',
            `target-object=${serial}`,
            // Without a media type WirePlumber won't link it to a video stream.
            'stream-properties=props,media.type=Video,media.category=Capture',
            '!',
            'video/x-raw,width=1280,height=800',
            '!',
            'fakesink',
        ],
        Gio.SubprocessFlags.NONE
    );
    return () => callMutter(session, '.Session', 'Stop', null);
}

let failures = 0;

export function check(name, ok, details = '') {
    if (ok) {
        report(`PASS ${name}`);
    } else {
        failures++;
        report(`FAIL ${name}${details ? `: ${details}` : ''}`);
    }
    return ok;
}

/** Runs the test body, then shuts the shell down so run.sh gets its result. */
export function run(body) {
    body()
        .catch((error) => check('test body', false, `${error}\n${error.stack}`))
        .finally(() => {
            report(`DONE failed=${failures}`);
            global.context.terminate();
        });
}
