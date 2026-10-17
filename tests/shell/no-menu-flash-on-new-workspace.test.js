/*
 * #15: every new workspace gets a panel button with its own context menu, and
 * that menu flashed in the top left corner when the workspace was created.
 *
 * Material Shell keeps one empty workspace at the end and removes any other
 * empty one, so a workspace appended through the API is gone before the next
 * frame. The test takes the user's path instead: a window opens on the last
 * empty workspace, and Material Shell appends a new one after it.
 */

import Gio from 'gi://Gio';

import { check, run, until, wait, watchMenus } from './lib.js';

const menus = watchMenus();

const WINDOW_SCRIPT = `
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
Gtk.init();
new Gtk.Window({ title: 'ms-shell-test' }).present();
new GLib.MainLoop(null, false).run();
`;

run(async () => {
    const built = await until(() => {
        const panel = global.ms.layout.panel;
        return global.ms.loaded && panel.visible && panel.mapped;
    }, 15000);
    if (!check('interface built', built)) return;
    await wait(1000);

    const msWorkspaceManager = global.ms.msWorkspaceManager;
    const before = msWorkspaceManager.primaryMsWorkspaces.length;
    menus.reset();
    // Not killed at the end: it exits with the shell's Wayland display.
    // Killing it a second after its window appears trips an unrelated
    // assertion in MsWindow.metaWindowUnManaged.
    Gio.Subprocess.new(['gjs', '-c', WINDOW_SCRIPT], Gio.SubprocessFlags.NONE);

    const created = await until(
        () => msWorkspaceManager.primaryMsWorkspaces.length > before,
        15000
    );
    if (!check('a window opens a new workspace', created)) return;
    // Let the shell settle and the menu checks run.
    await wait(1000);

    if (
        !check(
            'menu created for the new workspace',
            menus.added > menus.destroyed,
            'no menu stayed in uiGroup, so this run proves nothing'
        )
    )
        return;
    check(
        'no closed menu on screen on new workspace',
        menus.shown.length === 0,
        menus.shown.join('; ')
    );
});
