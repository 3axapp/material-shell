#!/usr/bin/env -S gjs -m
/*
 * Checks the preferences window: that it fits the window the Extensions app
 * opens it in, and that every kind of row reads and writes its settings key.
 *
 * Runs against an in-memory GSettings backend, so nothing here touches the
 * user's configuration.
 *
 * Usage: gjs -m tests/prefs-check.js
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { loadPreferencesWindow, settingsFor, walkWidgets } from './harness.js';

const prefsWindow = await loadPreferencesWindow();

let failures = 0;
function check(label, actual, expected) {
    const passed = String(actual) === String(expected);
    if (!passed) failures++;
    print(
        `${passed ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
            (passed ? '' : ` (expected ${expected})`)
    );
}

/** Every preferences row in the window, keyed by its title. */
const rows = new Map();
walkWidgets(prefsWindow, (widget) => {
    if (widget instanceof Adw.PreferencesRow) rows.set(widget.title, widget);
});

function suffixOfType(row, type) {
    let found = null;
    walkWidgets(row, (widget) => {
        if (widget instanceof type) found = widget;
    });
    return found;
}

const theme = settingsFor('theme');
const tweaks = settingsFor('tweaks');
const layouts = settingsFor('layouts');
const bindings = settingsFor('bindings');

// --- issue #8: the window has to fit the size the Extensions app opens ------
const [minimumWidth] = prefsWindow.measure(Gtk.Orientation.HORIZONTAL, -1);
check(
    `window fits its ${prefsWindow.default_width}px default width`,
    minimumWidth <= prefsWindow.default_width,
    true
);

check('every row has a title', [...rows.keys()].filter((t) => !t).length, 0);

// --- combo rows -------------------------------------------------------------
const modelStrings = (row) =>
    [...Array(row.model.get_n_items()).keys()].map((i) =>
        row.model.get_string(i)
    );

const themeRow = rows.get('Theme');
check(
    'theme row lists the enum values',
    modelStrings(themeRow).join(','),
    'dark,light,primary'
);
check(
    'theme row starts on the stored value',
    themeRow.model.get_string(themeRow.selected),
    theme.get_string('theme')
);
themeRow.selected = 1;
check(
    'choosing in the theme row stores the value',
    theme.get_string('theme'),
    'light'
);
theme.set_string('theme', 'primary');
check('an external change moves the theme row', themeRow.selected, 2);

// --- switch rows ------------------------------------------------------------
const blurRow = rows.get('Blur background');
check(
    'switch row starts on the stored value',
    blurRow.active,
    theme.get_boolean('blur-background')
);
blurRow.active = true;
check(
    'flipping a switch row stores the value',
    theme.get_boolean('blur-background'),
    true
);

const persistenceRow = rows.get('Enable session persistence');
persistenceRow.active = false;
check(
    'tweaks switch rows store their value',
    tweaks.get_boolean('enable-persistence'),
    false
);

// --- spin rows --------------------------------------------------------------
const panelSizeRow = rows.get('Panels size');
check(
    'spin row starts on the stored value',
    panelSizeRow.value,
    theme.get_int('panel-size')
);
panelSizeRow.value = 64;
check('changing a spin row stores the value', theme.get_int('panel-size'), 64);

// Opacity is a percentage the extension divides by 100 and uses as an alpha,
// so the gschema caps it at 100 and the row has to follow the schema, not the
// bounds hardcoded in prefs.js.
for (const title of ['Panel opacity', 'Surface opacity']) {
    const row = rows.get(title);
    check(`'${title}' stops at 100`, row.adjustment.upper, 100);
}
check(
    'a key without a range keeps the bounds from prefs.js',
    rows.get('Panels size').adjustment.upper,
    1000
);

const ratioRow = rows.get('Ratio of the ratio layout');
check('fractional spin rows show two digits', ratioRow.digits, 2);
check(
    'fractional spin row starts on the stored value',
    ratioRow.value.toFixed(4),
    layouts.get_double('ratio-value').toFixed(4)
);

// --- entry rows -------------------------------------------------------------
const excludedRow = rows.get('Excluded window classes');
check(
    'entry rows keep their description visible',
    excludedRow.subtitle.startsWith('Comma separated list of window classes'),
    true
);
const excludedEntry = suffixOfType(excludedRow, Gtk.Entry);
excludedEntry.text = 'Firefox';
check(
    'typing in an entry row stores the value',
    layouts.get_string('windows-excluded'),
    'Firefox'
);

// --- the default layout follows the enabled layouts -------------------------
const defaultLayoutRow = rows.get('Default layout');
check(
    'default layout offers only enabled layouts',
    modelStrings(defaultLayoutRow).join(','),
    'maximize,split,half,float'
);
layouts.set_boolean('grid', true);
check(
    'enabling a layout adds it to the list',
    modelStrings(defaultLayoutRow).includes('grid'),
    true
);
layouts.set_boolean('maximize', false);
check(
    'disabling a layout removes it from the list',
    modelStrings(defaultLayoutRow).includes('maximize'),
    false
);
check(
    'disabling the default layout moves the setting on',
    layouts.get_string('default-layout'),
    'split'
);
check(
    'the row shows what is stored',
    defaultLayoutRow.model.get_string(defaultLayoutRow.selected),
    'split'
);
layouts.set_boolean('maximize', true);
check(
    're-enabling a layout rewrites nothing',
    layouts.get_string('default-layout'),
    'split'
);

// --- hotkeys ----------------------------------------------------------------
const nextWindowRow = rows.get('Focus next window');
check(
    'schema descriptions lose their XML indentation',
    nextWindowRow.subtitle,
    'Focus the next window of the current workspace'
);
const shortcutLabel = suffixOfType(nextWindowRow, Gtk.ShortcutLabel);
check(
    'hotkey rows show the stored shortcut',
    shortcutLabel.accelerator,
    bindings.get_strv('next-window')[0]
);
bindings.set_strv('next-window', ['<Super><Shift>k']);
check(
    'an external change updates the shortcut',
    shortcutLabel.accelerator,
    '<Super><Shift>k'
);
bindings.set_strv('next-window', ['']);
check('a cleared binding shows no shortcut', shortcutLabel.accelerator, '');

// --- the shortcut capture dialog --------------------------------------------
prefsWindow.present();
let dialogError = null;
try {
    nextWindowRow.emit('activated');
} catch (error) {
    dialogError = error.message;
}
check('activating a hotkey row raises no error', dialogError, 'null');
const dialog = prefsWindow.visible_dialog;
check(
    'activating a hotkey row opens a dialog',
    dialog instanceof Adw.Dialog,
    true
);
if (dialog) {
    check('the dialog is the shortcut capture', dialog.title, 'Set Shortcut');
    dialog.close();
}

print(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
if (failures > 0) imports.system.exit(1);
