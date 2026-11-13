/*
 * #10: switching the primary monitor to an empty workspace by a shortcut
 * latched the shortcut's key in an XWayland window of another monitor, which
 * then repeated it endlessly. The search entry of the app launcher must still
 * get the keyboard after such a switch, once the shortcut is released, and a
 * click must give it back to that window with no modifier left held.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { check, plugMonitor, run, until, wait } from './lib.js';

const KEY_LOG = `${GLib.get_home_dir()}/keys.log`;

const CLIENT = (title, logged) => `
imports.gi.versions.Gtk = '3.0';
const { GLib, Gtk, Gdk } = imports.gi;
Gtk.init(null);
const win = new Gtk.Window({ title: '${title}' });
win.set_default_size(600, 400);
if (${logged}) {
    const record = (line) => {
        const [, old] = GLib.file_get_contents('${KEY_LOG}');
        GLib.file_set_contents('${KEY_LOG}', imports.byteArray.toString(old) + line + '\\n');
    };
    const SUPER = Gdk.ModifierType.MOD4_MASK | Gdk.ModifierType.SUPER_MASK;
    const describe = (e) => Gdk.keyval_name(e.get_keyval()[1]) + (e.get_state()[1] & SUPER ? '+Super' : '');
    win.connect('key-press-event', (w, e) => { record('P ' + describe(e)); return false; });
    win.connect('key-release-event', (w, e) => { record('R ' + describe(e)); return false; });
}
win.show_all();
Gtk.main();
`;

async function openClient(title, logged) {
    const launcher = new Gio.SubprocessLauncher();
    launcher.setenv('GDK_BACKEND', 'x11', true);
    launcher.spawnv(['gjs', '-c', CLIENT(title, logged)]);
    await until(() => findWindow(title), 10000);
    return findWindow(title);
}

function findWindow(title) {
    return (
        global.display
            .list_all_windows()
            .find((window) => window.get_title() === title) ?? null
    );
}

function keysSeen() {
    const [, bytes] = GLib.file_get_contents(KEY_LOG);
    return new TextDecoder().decode(bytes).trim().split('\n').filter(Boolean);
}

function forgetKeys() {
    GLib.file_set_contents(KEY_LOG, '');
}

function seat() {
    return global.stage.get_context().get_backend().get_default_seat();
}

const keyboard = seat().create_virtual_device(
    Clutter.InputDeviceType.KEYBOARD_DEVICE
);
const pointer = seat().create_virtual_device(
    Clutter.InputDeviceType.POINTER_DEVICE
);

function key(keyval, pressed) {
    keyboard.notify_keyval(
        GLib.get_monotonic_time(),
        keyval,
        pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED
    );
}

async function type(keyval) {
    key(keyval, true);
    await wait(60);
    key(keyval, false);
    await wait(400);
}

async function nextWorkspaceShortcut(superReleasedFirst) {
    key(Clutter.KEY_Super_L, true);
    await wait(40);
    key(Clutter.KEY_s, true);
    await wait(150);
    const order = superReleasedFirst
        ? [Clutter.KEY_Super_L, Clutter.KEY_s]
        : [Clutter.KEY_s, Clutter.KEY_Super_L];
    key(order[0], false);
    await wait(40);
    key(order[1], false);
    await wait(800);
}

async function click(window) {
    const rect = window.get_frame_rect();
    pointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
    );
    await wait(100);
    pointer.notify_button(
        GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY,
        Clutter.ButtonState.PRESSED
    );
    await wait(60);
    pointer.notify_button(
        GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY,
        Clutter.ButtonState.RELEASED
    );
    await wait(400);
}

function primaryWorkspace() {
    return global.ms.msWorkspaceManager.getActivePrimaryMsWorkspace();
}

function searchEntry() {
    return primaryWorkspace().appLauncher.appListContainer.inputContainer;
}

function describeKeyFocus() {
    const focus = global.stage.key_focus;
    return `key focus ${focus?.constructor.name ?? 'null'}, focus window ${
        global.display.focus_window?.get_title() ?? 'null'
    }`;
}

async function focusWindow(window) {
    await click(window);
    await until(() => global.display.focus_window === window, 2000);
    forgetKeys();
}

async function switchesToTheSearch(label, superReleasedFirst, side) {
    await focusWindow(side);
    const from = primaryWorkspace();
    await nextWorkspaceShortcut(superReleasedFirst);
    if (
        !check(
            `${label}: the shortcut opens the next workspace`,
            primaryWorkspace() !== from &&
                primaryWorkspace().tileableFocused ===
                    primaryWorkspace().appLauncher
        )
    ) {
        return;
    }

    const seen = keysSeen();
    check(
        `${label}: the side window never sees the shortcut key`,
        !seen.some((line) => line.endsWith(' s')),
        seen.join(' ')
    );
    check(
        `${label}: the search entry has the keyboard`,
        await until(
            () => global.stage.key_focus === searchEntry().clutter_text,
            1000
        ),
        describeKeyFocus()
    );

    searchEntry().set_text('');
    forgetKeys();
    await type(Clutter.KEY_a);
    check(
        `${label}: typing goes to the search`,
        searchEntry().get_text() === 'a' && keysSeen().length === 0,
        `entry '${searchEntry().get_text()}', side window ${keysSeen().join(
            ' '
        )}`
    );

    forgetKeys();
    await wait(600);
    const later = keysSeen();
    check(
        `${label}: no key repeats in the side window`,
        later.length === 0,
        later.join(' ')
    );

    global.workspace_manager
        .get_workspace_by_index(0)
        .activate(global.get_current_time());
    await until(
        () => global.workspace_manager.get_active_workspace_index() === 0,
        2000
    );
}

run(async () => {
    const loaded = await until(() => global.ms.loaded, 15000);
    if (!check('extension loaded', loaded)) {
        return;
    }
    await plugMonitor();
    if (
        !check(
            'second monitor plugged',
            await until(() => Main.layoutManager.monitors.length === 2, 10000)
        )
    ) {
        return;
    }
    await wait(1500);

    forgetKeys();
    const side = await openClient('side', true);
    if (!check('side window opened', side !== null)) {
        return;
    }
    await wait(500);
    const external = Main.layoutManager.monitors.findIndex(
        (monitor) => monitor.index !== Main.layoutManager.primaryIndex
    );
    side.move_to_monitor(external);
    const anchor = await openClient('anchor', false);
    if (
        !check(
            'one window on each monitor',
            anchor !== null &&
                (await until(() => side.get_monitor() === external, 3000)) &&
                anchor.get_monitor() === Main.layoutManager.primaryIndex
        )
    ) {
        return;
    }
    await wait(800);

    await switchesToTheSearch('shortcut released first', false, side);
    await switchesToTheSearch('Super released first', true, side);

    await focusWindow(side);
    await nextWorkspaceShortcut(false);
    await click(side);
    forgetKeys();
    await type(Clutter.KEY_a);
    check(
        'a click gives the keyboard back to the side window',
        keysSeen().join(' ') === 'P a R a',
        `${keysSeen().join(' ')}; ${describeKeyFocus()}`
    );

    global.workspace_manager
        .get_workspace_by_index(0)
        .activate(global.get_current_time());
    await until(
        () => global.workspace_manager.get_active_workspace_index() === 0,
        2000
    );
    await focusWindow(side);
    key(Clutter.KEY_Super_L, true);
    await wait(40);
    key(Clutter.KEY_s, true);
    await wait(100);
    key(Clutter.KEY_s, false);
    await wait(100);
    anchor.activate(global.display.get_current_time_roundtrip());
    await until(() => global.display.focus_window === anchor, 1000);
    key(Clutter.KEY_Super_L, false);
    await wait(400);
    check(
        'a window raised before Super is let go keeps the keyboard',
        global.display.focus_window === anchor &&
            global.stage.key_focus === null,
        describeKeyFocus()
    );
});
