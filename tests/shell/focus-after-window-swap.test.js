/*
 * #26: a window may change tiles during its first seconds, once its title
 * matches a restored tile better. The focused window does not change when that
 * happens, so no focus signal fires: the shown tile stayed behind, holding a
 * window that was still minimized from its hidden tile, while keys and clicks
 * went to the focused window underneath.
 *
 * Tiles are created the way a restored state creates them. They only compete
 * for windows of the same app, which takes a desktop file.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import { check, run, until, wait } from './lib.js';

const APP_ID = 'mstest.desktop';
const REASSOCIATION_MS = 3000;

function installApp() {
    const directory = `${GLib.get_user_data_dir()}/applications`;
    GLib.mkdir_with_parents(directory, 0o755);
    GLib.file_set_contents(
        `${directory}/${APP_ID}`,
        '[Desktop Entry]\nType=Application\nName=MsTest\nExec=/bin/true\nStartupWMClass=mstest\n'
    );
}

const CLIENT = (renames, retitleMs) => `
imports.gi.versions.Gtk = '3.0';
const { GLib, Gtk } = imports.gi;
GLib.set_prgname('mstest');
Gtk.init(null);
const opened = ${JSON.stringify(renames)}.map((title, index) => {
    const win = new Gtk.Window({ title: 'loading' });
    win.set_default_size(700, 500);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300 * (index + 1), () => {
        win.show_all();
        return GLib.SOURCE_REMOVE;
    });
    return { win, title };
});
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300 * opened.length + ${retitleMs}, () => {
    opened.forEach(({ win, title }) => win.set_title(title));
    return GLib.SOURCE_REMOVE;
});
Gtk.main();
`;

function openClient(renames, retitleMs) {
    const launcher = new Gio.SubprocessLauncher();
    launcher.setenv('GDK_BACKEND', 'x11', true);
    launcher.spawnv(['gjs', '-c', CLIENT(renames, retitleMs)]);
}

function createRestoredTile(app, title) {
    return global.ms.msWindowManager.createNewMsWindow(
        app,
        {
            msWorkspace: activeWorkspace(),
            focus: false,
            insert: false,
        },
        undefined,
        undefined,
        { appId: app.id, title },
        new Date(0)
    );
}

function activeWorkspace() {
    return global.ms.msWorkspaceManager.getActiveMsWorkspace();
}

function describe(tile) {
    const window = tile.metaWindow;
    return window
        ? `${window.get_title()} min=${window.minimized}`
        : 'no window';
}

function holdsItsOwnTitle(tile, title) {
    return tile.metaWindow?.get_title() === title;
}

async function shownTileFollowsFocusedWindow(app) {
    const first = createRestoredTile(app, 'focus-first');
    const second = createRestoredTile(app, 'focus-second');
    const workspace = activeWorkspace();
    workspace.focusTileable(second);

    openClient(['focus-second', 'focus-first'], 800);
    if (
        !check(
            'windows reach the tiles they fit by title',
            await until(
                () =>
                    holdsItsOwnTitle(first, 'focus-first') &&
                    holdsItsOwnTitle(second, 'focus-second'),
                8000
            ),
            `${describe(first)} | ${describe(second)}`
        )
    ) {
        return;
    }

    const focused = global.display.focus_window;
    check(
        'focused window is the one that moved',
        focused === first.metaWindow,
        focused?.get_title()
    );
    check(
        'shown tile follows the focused window',
        await until(() => workspace.tileableFocused === first, 2000),
        describe(workspace.tileableFocused)
    );
    await wait(500);
    check(
        'focus stays on the moved window',
        global.display.focus_window === focused,
        global.display.focus_window?.get_title()
    );
    check(
        'shown tile keeps its window on screen',
        !first.metaWindow.minimized,
        describe(first)
    );
    check(
        'hidden tile keeps its window minimized',
        second.metaWindow.minimized,
        describe(second)
    );
}

async function shownWindowIsNotLeftMinimized(app) {
    const shown = createRestoredTile(app, 'idle-shown');
    const hidden = createRestoredTile(app, 'idle-hidden');
    const workspace = activeWorkspace();

    openClient(['idle-hidden', 'idle-shown'], 1500);
    if (
        !check(
            'windows open in the tiles in list order',
            await until(() => shown.metaWindow && hidden.metaWindow, 8000),
            `${describe(shown)} | ${describe(hidden)}`
        )
    ) {
        return;
    }

    await until(() => workspace.tileableFocused === hidden, 1000);
    workspace.focusTileable(shown);
    await until(() => global.display.focus_window === shown.metaWindow, 500);
    await wait(100);
    global.display.unset_input_focus(global.get_current_time());
    if (
        !check(
            'shown tile is settled with no focused window before the swap',
            (await until(() => global.display.focus_window === null, 300)) &&
                workspace.tileableFocused === shown &&
                !shown.metaWindow.minimized &&
                shown.metaWindow.get_title() === 'loading',
            `${global.display.focus_window?.get_title()}: ${describe(
                shown
            )} shown=${describe(workspace.tileableFocused)}`
        )
    ) {
        return;
    }

    if (
        !check(
            'windows swap tiles',
            await until(
                () =>
                    holdsItsOwnTitle(shown, 'idle-shown') &&
                    holdsItsOwnTitle(hidden, 'idle-hidden'),
                5000
            ),
            `${describe(shown)} | ${describe(hidden)}`
        )
    ) {
        return;
    }

    check(
        'window swapped into the shown tile is restored',
        await until(() => !shown.metaWindow.minimized, 2000),
        describe(shown)
    );
    check(
        'window swapped into the hidden tile is minimized',
        await until(() => hidden.metaWindow.minimized, 2000),
        describe(hidden)
    );
    check(
        'the shown tile stays the same',
        workspace.tileableFocused === shown,
        describe(workspace.tileableFocused)
    );
}

installApp();

run(async () => {
    const loaded = await until(() => global.ms.loaded, 15000);
    if (!check('extension loaded', loaded)) {
        return;
    }

    const appSystem = Shell.AppSystem.get_default();
    const appFound = await until(() => appSystem.lookup_app(APP_ID), 10000);
    if (!check('desktop file picked up', appFound)) {
        return;
    }
    const app = appSystem.lookup_app(APP_ID);

    await shownTileFollowsFocusedWindow(app);
    await wait(REASSOCIATION_MS + 500);
    await shownWindowIsNotLeftMinimized(app);
});
