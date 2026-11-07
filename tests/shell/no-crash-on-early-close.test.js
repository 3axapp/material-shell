/*
 * #21: on Wayland MsWindow defers maximize() and move_resize_frame() to an
 * idle. A window that closed before the idle ran was still touched, and
 * set_maximize_flags() on an unmanaged MetaWindow crashed the shell.
 *
 * The test makes the race certain. It leaves a tiled window unmaximized, so
 * Material Shell has to maximize it back, lets Material Shell schedule that,
 * and kills the client in the same main loop iteration. Waiting for the client
 * to exit leaves its disconnect pending, and that is dispatched before any idle.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import { check, run, until, wait } from './lib.js';

const TITLE = 'ms-shell-test-early-close';

const WINDOW_SCRIPT = `
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
Gtk.init();
new Gtk.Window({ title: '${TITLE}' }).present();
new GLib.MainLoop(null, false).run();
`;

function findWindow() {
    return global
        .get_window_actors()
        .map((actor) => actor.meta_window)
        .find((metaWindow) => metaWindow.get_title() === TITLE);
}

run(async () => {
    const loaded = await until(() => global.ms.loaded, 15000);
    if (!check('extension loaded', loaded)) {
        return;
    }

    const client = Gio.Subprocess.new(
        ['gjs', '-c', WINDOW_SCRIPT],
        Gio.SubprocessFlags.NONE
    );

    const settled = await until(() => {
        const metaWindow = findWindow();
        return (
            metaWindow?.msWindow &&
            metaWindow.firstFrameDrawn &&
            metaWindow.maximized_horizontally &&
            metaWindow.maximized_vertically
        );
    }, 15000);
    if (!check('window tiled and maximized', settled)) {
        return;
    }
    await wait(500);

    const metaWindow = findWindow();
    const msWindow = metaWindow.msWindow;
    let unmanaged = false;
    metaWindow.connect('unmanaged', () => {
        unmanaged = true;
    });

    metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
    metaWindow.unmaximize();
    msWindow.updateMetaWindowPositionAndSizeInternal();
    const unmanagedBeforeDeferred = new Promise((resolve) => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            resolve(unmanaged);
            return GLib.SOURCE_REMOVE;
        });
    });
    client.force_exit();
    client.wait(null);

    check(
        'window unmanaged before the deferred maximize',
        await unmanagedBeforeDeferred,
        'the client disconnect came after the idle, so this run proves nothing'
    );
    await wait(1000);
    check('shell survived', true);
});
