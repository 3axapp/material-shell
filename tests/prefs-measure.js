#!/usr/bin/env -S gjs -m
/*
 * Prints the width every widget in the preferences window asks for.
 *
 * Adw.PreferencesWindow opens at 640x576 unless told otherwise, and libadwaita
 * clips whatever asks for more instead of growing the window. This is how to
 * find out which widget is responsible when it does.
 *
 * Usage: gjs -m tests/prefs-measure.js
 */

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import { loadPreferencesWindow, walkWidgets } from './harness.js';

const prefsWindow = await loadPreferencesWindow();

function describe(widget, depth) {
    const [minimum, natural] = widget.measure(Gtk.Orientation.HORIZONTAL, -1);
    const name = widget.constructor.$gtype.name;
    const id = widget.get_buildable_id?.() ?? '';
    return (
        `${' '.repeat(depth * 2)}${name}${id ? `#${id}` : ''} ` +
        `min=${minimum} nat=${natural} allocated=${widget.get_allocated_width()}`
    );
}

prefsWindow.present();

const loop = GLib.MainLoop.new(null, false);
// One turn of the main loop, so sizes are allocated rather than merely asked for.
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
    const [minimum] = prefsWindow.measure(Gtk.Orientation.HORIZONTAL, -1);
    print(
        `window: minimum width ${minimum}, default ${prefsWindow.default_width}x${prefsWindow.default_height}`
    );

    const depths = new Map([[prefsWindow, 0]]);
    walkWidgets(prefsWindow, (widget) => {
        const parent = widget.get_parent();
        const depth = parent ? (depths.get(parent) ?? 0) + 1 : 0;
        depths.set(widget, depth);
        print(describe(widget, depth));
    });

    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
