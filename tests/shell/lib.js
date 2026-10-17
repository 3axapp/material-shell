/*
 * Helpers for tests that run inside a nested gnome-shell, loaded next to the
 * extension by run.sh. Results are logged under their own domain, which run.sh
 * picks out of the shell's output:
 *
 *   MSTEST-Message: …: PASS <name>
 *   MSTEST-Message: …: FAIL <name>: <details>
 *   MSTEST-Message: …: DONE failed=<n>
 */

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
            if (predicate()) return true;
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
        if (!(actor instanceof BoxPointer.BoxPointer)) return;
        watcher.added++;
        if (actor.mapped) checkLater(actor);
        const mappedId = actor.connect('notify::mapped', () => {
            if (actor.mapped) checkLater(actor);
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
        if (actor.text && !labels.includes(actor.text)) labels.push(actor.text);
        for (const child of actor.get_children()) collect(child);
    };
    collect(menu);
    return labels.slice(0, 3).join(' / ') || menu.toString();
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
