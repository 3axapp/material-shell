/*
 * Loads the built preferences module into a real Adw.PreferencesWindow inside
 * an ordinary gjs process, so the settings UI can be exercised without opening
 * the Extensions app.
 *
 * Needs a display, and dist/ has to be built first (`make compile`).
 */

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

// Before anything creates a Gio.Settings: the tests write to every key they
// touch, and those writes must never reach the user's real configuration.
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const [thisFile] = GLib.filename_from_uri(import.meta.url);
export const testsDir = GLib.path_get_dirname(thisFile);
export const repoDir = GLib.path_get_dirname(testsDir);
export const distDir = GLib.build_filenamev([repoDir, 'dist']);

/** Fails the run with a message on stderr rather than a stack trace. */
export function die(message) {
    printerr(message);
    imports.system.exit(1);
}

function registerPrefsStub() {
    const stubDir = GLib.build_filenamev([testsDir, 'stub']);
    // A fixed path, so repeated runs overwrite one file instead of filling the
    // temporary directory up.
    const buildDir = GLib.build_filenamev([
        GLib.get_tmp_dir(),
        'material-shell-tests',
    ]);
    GLib.mkdir_with_parents(buildDir, 0o755);
    const target = GLib.build_filenamev([buildDir, 'prefs.gresource']);

    const [spawned, , stderr, status] = GLib.spawn_sync(
        stubDir,
        ['glib-compile-resources', 'prefs.gresource.xml', `--target=${target}`],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null
    );
    if (!spawned || status !== 0) {
        die(
            'Could not compile the preferences stub. Is glib-compile-resources ' +
                `installed?\n${new TextDecoder().decode(
                    stderr ?? new Uint8Array()
                )}`
        );
    }

    Gio.resources_register(Gio.resource_load(target));
}

/**
 * Build the preferences window the Extensions app would build.
 *
 * @returns {Promise<Adw.PreferencesWindow>}
 */
export async function loadPreferencesWindow() {
    const dir = Gio.File.new_for_path(distDir);
    if (!dir.get_child('prefs.js').query_exists(null)) {
        die(`No built extension in ${distDir}. Run \`make compile\` first.`);
    }

    registerPrefsStub();
    Gtk.init();
    Adw.init();

    if (
        Gio.SettingsBackend.get_default().constructor.$gtype.name !==
        'GMemorySettingsBackend'
    ) {
        die('Refusing to run against a persistent GSettings backend.');
    }

    const module = await import(dir.get_child('prefs.js').get_uri());
    const preferences = new module.default({
        uuid: 'material-shell@papyelgringo',
        name: 'Material Shell',
        dir,
        path: distDir,
    });

    const window = new Adw.PreferencesWindow({ search_enabled: false });
    await preferences.fillPreferencesWindow(window);
    // Held so the preferences object, and with it the settings bindings, live
    // as long as the window does.
    window._preferences = preferences;
    return window;
}

/** Call visit() on a widget and every descendant, depth first. */
export function walkWidgets(widget, visit) {
    visit(widget);
    let child = widget.get_first_child();
    while (child) {
        walkWidgets(child, visit);
        child = child.get_next_sibling();
    }
}

/** A Gio.Settings on one of the extension's schemas, from the built dist/. */
export function settingsFor(name) {
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([distDir, 'schemas']),
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    return new Gio.Settings({
        settings_schema: schemaSource.lookup(
            `org.gnome.shell.extensions.materialshell.${name}`,
            false
        ),
    });
}
