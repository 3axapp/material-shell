/*
 * #12: gnome-shell may start before any monitor exists, as does a session
 * whose only screen is plugged in later. Material Shell has to wait for a
 * monitor instead of failing to enable.
 *
 * With the devkit viewer the monitor raced the extension, so the test runs
 * headless with no monitor at all and plugs one in itself, through the
 * virtual monitor of Mutter's screen cast API (#20).
 *
 * shell-test: headless
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { check, run, until } from './lib.js';

// Read while the shell imports the extension.
const monitorsAtStart = global.display.get_n_monitors();

function describeState() {
    return JSON.stringify({
        monitors: global.display.get_n_monitors(),
        loaded: global.ms?.loaded,
        layout: Boolean(global.ms?.layout),
    });
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
 * Plugs in a virtual monitor. Mutter creates it only once something consumes
 * the PipeWire stream behind it, so a GStreamer pipeline is started to read
 * the stream. Both go away with the shell: the session is the shell's own,
 * and the pipeline stops once its stream is gone.
 */
async function addVirtualMonitor() {
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
            'fakesink',
        ],
        Gio.SubprocessFlags.NONE
    );
}

run(async () => {
    if (
        !check(
            'no monitor when the extension loads',
            monitorsAtStart === 0,
            `${monitorsAtStart} already present, so this run proves nothing`
        )
    )
        return;

    // The monitor stays until the shell stops: unplugging it while the
    // extension runs is a case of its own, Material Shell fails on it.
    await addVirtualMonitor();
    const monitorAdded = await until(
        () => global.display.get_n_monitors() > 0,
        15000
    );
    if (!check('a monitor appears', monitorAdded, describeState())) return;

    const built = await until(() => {
        const panel = global.ms.layout.panel;
        return global.ms.loaded && panel.visible && panel.mapped;
    }, 15000);
    check('interface built on the new monitor', built, describeState());
});
