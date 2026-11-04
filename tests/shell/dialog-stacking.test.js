/*
 * #25: the clones of a tile's dialogs were ordered by user_time, so a dialog
 * covered by its modal child could be drawn above it while the modal child kept
 * the focus. Clicking the visible part of the covered dialog freshens its
 * user_time; the wrong order shows up on the next focusDialogs(), for instance
 * when coming back from another tile.
 *
 * The client is X11 and GTK3 because window types are what the bug hinges on:
 * the type hints set here reach mutter only through X11.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import { check, run, until, wait } from './lib.js';

const TOP_LEVEL = { width: 900, height: 700 };
const DIALOG = { width: 600, height: 450, dialog: true };
const SMALL_DIALOG = { width: 400, height: 250, dialog: true };

const CHAIN = [
    { title: 'chain-other', ...TOP_LEVEL },
    { title: 'chain-main', ...TOP_LEVEL },
    { title: 'chain-list', parent: 'chain-main', ...DIALOG },
    {
        title: 'chain-merge',
        parent: 'chain-list',
        modal: true,
        ...SMALL_DIALOG,
    },
];

const SIBLINGS = [
    { title: 'siblings-main', ...TOP_LEVEL },
    { title: 'siblings-small', parent: 'siblings-main', ...SMALL_DIALOG },
    { title: 'siblings-large', parent: 'siblings-main', ...DIALOG },
];

const CLIENT = (windows) => `
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.Gtk = '3.0';
const { Gdk, GLib, Gtk } = imports.gi;
Gtk.init(null);
const opened = {};
${JSON.stringify(windows)}.forEach((spec, index) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700 * (index + 1), () => {
        const win = new Gtk.Window({ title: spec.title });
        win.set_default_size(spec.width, spec.height);
        if (spec.dialog) {
            win.set_type_hint(Gdk.WindowTypeHint.DIALOG);
        }
        if (spec.parent) {
            win.set_transient_for(opened[spec.parent]);
        }
        win.set_modal(Boolean(spec.modal));
        win.show_all();
        opened[spec.title] = win;
        return GLib.SOURCE_REMOVE;
    });
});
Gtk.main();
`;

function openClient(windows) {
    const launcher = new Gio.SubprocessLauncher();
    launcher.setenv('GDK_BACKEND', 'x11', true);
    launcher.spawnv(['gjs', '-c', CLIENT(windows)]);
}

function findWindow(title) {
    return global
        .get_window_actors()
        .map((actor) => actor.meta_window)
        .find((metaWindow) => metaWindow.get_title() === title);
}

function allManaged(windows) {
    return windows.every((spec) => findWindow(spec.title)?.msWindow);
}

function focusedTitle() {
    return global.display.focus_window?.get_title();
}

/** Titles of the tile's dialogs as drawn, from the bottom up. */
function drawnDialogs(msWindow) {
    const { dialogs } = msWindow.lifecycleState;
    return msWindow
        .get_children()
        .map((child) => dialogs.find((dialog) => dialog.clone === child))
        .filter((dialog) => dialog)
        .map((dialog) => dialog.metaWindow.get_title())
        .join(' < ');
}

/** A point on `window` which `cover` does not hide. */
function visiblePoint(window, cover) {
    const frame = window.get_frame_rect();
    const covering = cover.get_frame_rect();
    const inset = 20;
    return [
        [frame.x + inset, frame.y + inset],
        [frame.x + frame.width - inset, frame.y + inset],
        [frame.x + inset, frame.y + frame.height - inset],
        [frame.x + frame.width - inset, frame.y + frame.height - inset],
    ].find(
        ([x, y]) =>
            x < covering.x ||
            x >= covering.x + covering.width ||
            y < covering.y ||
            y >= covering.y + covering.height
    );
}

/*
 * One device for the whole test: a new pointer starts at 0,0 and opens the
 * overview through the hot corner. global.get_current_time() as the event time
 * would spoil the user_time of the clicked window.
 */
function createClicker() {
    const pointer = global.stage.context
        .get_backend()
        .get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    return async ([x, y]) => {
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        await wait(100);
        for (const state of [
            Clutter.ButtonState.PRESSED,
            Clutter.ButtonState.RELEASED,
        ]) {
            pointer.notify_button(
                GLib.get_monotonic_time(),
                Clutter.BUTTON_PRIMARY,
                state
            );
            await wait(50);
        }
    };
}

async function modalStaysOnTop(click) {
    const main = findWindow('chain-main');
    const list = findWindow('chain-list');
    const merge = findWindow('chain-merge');
    const tile = main.msWindow;

    check(
        'covered dialog and its modal child share a tile',
        list.msWindow === tile && merge.msWindow === tile
    );
    check(
        'window types are the ones from the bug',
        list.window_type === Meta.WindowType.DIALOG &&
            merge.window_type === Meta.WindowType.MODAL_DIALOG,
        `list=${list.window_type} merge=${merge.window_type}`
    );
    if (
        !check(
            'modal child has the focus',
            await until(() => focusedTitle() === 'chain-merge', 5000),
            focusedTitle()
        )
    ) {
        return;
    }

    await click(visiblePoint(list, merge));
    check(
        'click makes the covered dialog the most recently used',
        await until(() => list.user_time > merge.user_time, 3000),
        `list=${list.user_time} merge=${merge.user_time}`
    );

    const workspace = tile.msWorkspace;
    workspace.focusTileable(findWindow('chain-other').msWindow);
    await until(() => focusedTitle() === 'chain-other', 3000);
    workspace.focusTileable(tile);
    await until(() => focusedTitle() === 'chain-merge', 3000);
    await wait(500);

    check(
        'modal child has the focus after coming back',
        focusedTitle() === 'chain-merge',
        focusedTitle()
    );
    check(
        'modal child is drawn above the dialog it covers',
        drawnDialogs(tile) === 'chain-list < chain-merge',
        drawnDialogs(tile)
    );
}

async function siblingsFollowTheStack(click) {
    const small = findWindow('siblings-small');
    const large = findWindow('siblings-large');
    const tile = small.msWindow;

    small.activate(global.get_current_time());
    if (
        !check(
            'activated sibling takes the focus and the top',
            await until(
                () =>
                    focusedTitle() === 'siblings-small' &&
                    drawnDialogs(tile) === 'siblings-large < siblings-small',
                5000
            ),
            `${focusedTitle()}: ${drawnDialogs(tile)}`
        )
    ) {
        return;
    }

    await click(visiblePoint(large, small));
    check(
        'clicked sibling takes the focus',
        await until(() => focusedTitle() === 'siblings-large', 3000),
        focusedTitle()
    );
    await wait(500);
    check(
        'clicked sibling keeps the focus',
        focusedTitle() === 'siblings-large',
        focusedTitle()
    );
    check(
        'clicked sibling is drawn on top',
        drawnDialogs(tile) === 'siblings-small < siblings-large',
        drawnDialogs(tile)
    );

    small.raise();
    check(
        'raising a sibling reorders the drawing',
        await until(
            () => drawnDialogs(tile) === 'siblings-large < siblings-small',
            3000
        ),
        drawnDialogs(tile)
    );
    check(
        'raising a sibling leaves the focus alone',
        focusedTitle() === 'siblings-large',
        focusedTitle()
    );
}

run(async () => {
    const loaded = await until(() => global.ms.loaded, 15000);
    if (!check('extension loaded', loaded)) {
        return;
    }

    const click = createClicker();

    openClient(CHAIN);
    if (
        !check(
            'chain of dialogs opened',
            await until(() => allManaged(CHAIN), 15000),
            `DISPLAY=${GLib.getenv('DISPLAY')}`
        )
    ) {
        return;
    }
    await wait(500);
    await modalStaysOnTop(click);

    openClient(SIBLINGS);
    if (
        !check(
            'sibling dialogs opened',
            await until(() => allManaged(SIBLINGS), 15000)
        )
    ) {
        return;
    }
    await wait(500);
    await siblingsFollowTheStack(click);
});
