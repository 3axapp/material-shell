import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { assertNotNull } from 'src/utils/assert';

const themeSchemaName = 'org.gnome.shell.extensions.materialshell.theme';
const tweaksSchemaName = 'org.gnome.shell.extensions.materialshell.tweaks';
const layoutsSchemaName = 'org.gnome.shell.extensions.materialshell.layouts';
const hotkeysSchemaName = 'org.gnome.shell.extensions.materialshell.bindings';

const tilingLayouts = [
    'maximize',
    'split',
    'half',
    'half-horizontal',
    'half-vertical',
    'ratio',
    'grid',
    'float',
    'simple',
    'simple-horizontal',
    'simple-vertical',
];

/** Summary and description of a settings key, as written in the gschema. */
function keyLabels(settings: Gio.Settings, key: string) {
    const schemaKey = settings.settings_schema.get_key(key);
    return {
        title: schemaKey.get_summary() ?? key,
        // Descriptions are indented inside the gschema XML, so they arrive
        // padded with newlines.
        subtitle: (schemaKey.get_description() ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
        // The labels are plain text taken from the schema, never markup.
        useMarkup: false,
    };
}

/** The values an enum-typed key accepts, in the order the gschema lists them. */
function enumValues(settings: Gio.Settings, key: string): string[] {
    return settings.settings_schema
        .get_key(key)
        .get_range()
        .get_child_value(1)
        .recursiveUnpack() as string[];
}

function rgbaToHexString(rgba: Gdk.RGBA) {
    const component = (value: number) =>
        Math.round(Math.min(Math.max(value, 0), 1) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${component(rgba.red)}${component(rgba.green)}${component(
        rgba.blue
    )}`;
}

/**
 * Keep a combo row in sync with a string-typed key. Adw.ComboRow works on the
 * index of its model, so it cannot be bound with Gio.Settings.bind directly.
 */
function bindComboRow(
    row: Adw.ComboRow,
    settings: Gio.Settings,
    key: string,
    getValues: () => string[]
) {
    let values: string[] = [];
    let syncing = false;

    const refreshModel = () => {
        values = getValues();
        syncing = true;
        row.model = Gtk.StringList.new(values);
        syncing = false;
        // The stored value may have just dropped out of the model. A combo row
        // always shows one of its items, so move the setting to what the row
        // now displays instead of leaving the two disagreeing.
        if (values.length > 0 && !values.includes(settings.get_string(key))) {
            settings.set_string(key, values[0]);
        }
        syncFromSettings();
    };

    const syncFromSettings = () => {
        const index = values.indexOf(settings.get_string(key));
        if (index < 0 || row.selected === index) return;
        syncing = true;
        row.selected = index;
        syncing = false;
    };

    row.connect('notify::selected', () => {
        if (syncing) return;
        const value = values[row.selected];
        if (value !== undefined && value !== settings.get_string(key)) {
            settings.set_string(key, value);
        }
    });
    settings.connect(`changed::${key}`, syncFromSettings);

    refreshModel();
    return refreshModel;
}

function addSwitchRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string
) {
    const row = new Adw.SwitchRow(keyLabels(settings, key));
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
}

function addEnumComboRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string
) {
    const row = new Adw.ComboRow(keyLabels(settings, key));
    bindComboRow(row, settings, key, () => enumValues(settings, key));
    group.add(row);
}

function addSpinRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string,
    lower: number,
    upper: number,
    step: number,
    digits: number
) {
    const row = Adw.SpinRow.new_with_range(lower, upper, step);
    row.set(keyLabels(settings, key));
    row.digits = digits;
    settings.bind(
        key,
        row.get_adjustment(),
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );
    group.add(row);
}

function addColorRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string
) {
    const row = new Adw.ActionRow(keyLabels(settings, key));
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ with_alpha: false }),
        valign: Gtk.Align.CENTER,
    });

    const syncFromSettings = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string(key))) button.set_rgba(rgba);
    };
    syncFromSettings();

    button.connect('notify::rgba', () => {
        const hexString = rgbaToHexString(button.get_rgba());
        if (hexString !== settings.get_string(key)) {
            settings.set_string(key, hexString);
        }
    });
    settings.connect(`changed::${key}`, syncFromSettings);

    row.add_suffix(button);
    row.activatable_widget = button;
    group.add(row);
}

/**
 * Adw.EntryRow carries no subtitle, and these keys need their description to
 * stay visible, so the entry goes into a plain action row instead.
 */
function addEntryRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string
) {
    const row = new Adw.ActionRow(keyLabels(settings, key));
    const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER,
        // Without this the entry asks for a width that the whole window then
        // has to accommodate.
        width_chars: 12,
        max_width_chars: 12,
    });
    settings.bind(key, entry, 'text', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(entry);
    row.activatable_widget = entry;
    group.add(row);
}

function buildThemeGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({ title: _('Theme') });

    addEnumComboRow(group, settings, 'theme');
    addColorRow(group, settings, 'primary-color');
    addEnumComboRow(group, settings, 'vertical-panel-position');
    addEnumComboRow(group, settings, 'horizontal-panel-position');
    addSpinRow(group, settings, 'panel-size', 0, 1000, 1, 0);
    addSpinRow(group, settings, 'panel-opacity', 0, 1000, 1, 0);
    addEnumComboRow(group, settings, 'panel-icon-style');
    addSwitchRow(group, settings, 'panel-icon-color');
    addEnumComboRow(group, settings, 'taskbar-item-style');
    addSpinRow(group, settings, 'surface-opacity', 0, 1000, 1, 0);
    addSwitchRow(group, settings, 'blur-background');
    addSwitchRow(group, settings, 'clock-horizontal');
    addSwitchRow(group, settings, 'clock-app-launcher');
    addEnumComboRow(group, settings, 'focus-effect');

    return group;
}

function buildTweaksGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({ title: _('Tweaks') });

    addSwitchRow(group, settings, 'cycle-through-windows');
    addSwitchRow(group, settings, 'cycle-through-workspaces');
    addSwitchRow(group, settings, 'disable-notifications');
    addSwitchRow(group, settings, 'enable-persistence');

    return group;
}

function buildLayoutsGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({ title: _('Tiling layouts') });

    const defaultLayoutRow = new Adw.ComboRow(
        keyLabels(settings, 'default-layout')
    );
    // Only layouts the user left enabled can be the default one.
    const refreshDefaultLayout = bindComboRow(
        defaultLayoutRow,
        settings,
        'default-layout',
        () => tilingLayouts.filter((layout) => settings.get_boolean(layout))
    );
    group.add(defaultLayoutRow);

    tilingLayouts.forEach((layout) => {
        addSwitchRow(group, settings, layout);
        settings.connect(`changed::${layout}`, refreshDefaultLayout);
        if (layout === 'ratio') {
            addSpinRow(group, settings, 'ratio-value', 0, 1, 0.1, 2);
        }
    });

    addSpinRow(group, settings, 'gap', 0, 1000, 1, 0);
    addSwitchRow(group, settings, 'use-screen-gap');
    addSpinRow(group, settings, 'screen-gap', 0, 1000, 1, 0);
    addSpinRow(group, settings, 'tween-time', 0, 1, 0.1, 2);
    addEntryRow(group, settings, 'windows-excluded');
    addEntryRow(group, settings, 'roles-excluded');

    return group;
}

/**
 * Grab the keyboard until the user presses a shortcut, Escape to cancel or
 * Backspace to disable the binding.
 */
function captureShortcut(
    row: Gtk.Widget,
    onAccelerator: (accelerator: string) => void
) {
    const window = assertNotNull(row.get_root()) as Gtk.Window;
    const dialog = new Adw.Dialog({
        title: _('Set Shortcut'),
        content_width: 440,
        content_height: 220,
        presentation_mode: Adw.DialogPresentationMode.FLOATING,
    });
    dialog.set_child(
        new Adw.StatusPage({
            title: _('Press your keyboard shortcut…'),
            description: _('Press Esc to cancel, Backspace to disable.'),
        })
    );

    const toplevel = window.get_surface() as Gdk.Toplevel;
    toplevel.inhibit_system_shortcuts(null);
    dialog.connect('closed', () => toplevel.restore_system_shortcuts());

    const controller = new Gtk.EventControllerKey({
        propagation_phase: Gtk.PropagationPhase.CAPTURE,
    });
    controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (mask === 0 && keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }

        if (mask === 0 && keyval === Gdk.KEY_BackSpace) {
            onAccelerator('');
            dialog.close();
            return Gdk.EVENT_STOP;
        }

        if (!Gtk.accelerator_valid(keyval, mask)) return Gdk.EVENT_STOP;

        onAccelerator(
            Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask)
        );
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);

    dialog.present(window);
}

function buildHotkeysGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup();

    settings
        .list_keys()
        .map((key) => ({ key, labels: keyLabels(settings, key) }))
        .sort((a, b) => a.labels.title.localeCompare(b.labels.title))
        .forEach(({ key, labels }) => {
            const row = new Adw.ActionRow(labels);
            row.activatable = true;
            const shortcutLabel = new Gtk.ShortcutLabel({
                accelerator: settings.get_strv(key)[0] ?? '',
                disabled_text: _('Disabled'),
                valign: Gtk.Align.CENTER,
            });

            settings.connect(`changed::${key}`, () => {
                shortcutLabel.accelerator = settings.get_strv(key)[0] ?? '';
            });
            row.connect('activated', () => {
                captureShortcut(row, (accelerator) =>
                    settings.set_strv(key, [accelerator])
                );
            });

            row.add_suffix(shortcutLabel);
            group.add(row);
        });

    return group;
}

export default class MyExtensionPreferences extends ExtensionPreferences {
    // Held for the lifetime of the preferences object so the bindings above
    // outlive fillPreferencesWindow.
    private settingsRefs: Gio.Settings[] = [];

    private lookupSettings(
        schemaSource: Gio.SettingsSchemaSource,
        schemaName: string
    ) {
        const settings = new Gio.Settings({
            settings_schema: assertNotNull(
                schemaSource.lookup(schemaName, false)
            ),
        });
        this.settingsRefs.push(settings);
        return settings;
    }

    override async fillPreferencesWindow(window: Adw.PreferencesWindow) {
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            assertNotNull(this.metadata.dir.get_child('schemas').get_path()),
            Gio.SettingsSchemaSource.get_default(),
            false
        );

        const settingsPage = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        settingsPage.add(
            buildThemeGroup(this.lookupSettings(schemaSource, themeSchemaName))
        );
        settingsPage.add(
            buildTweaksGroup(
                this.lookupSettings(schemaSource, tweaksSchemaName)
            )
        );
        settingsPage.add(
            buildLayoutsGroup(
                this.lookupSettings(schemaSource, layoutsSchemaName)
            )
        );
        window.add(settingsPage);

        const hotkeysPage = new Adw.PreferencesPage({
            title: _('Hotkeys'),
            icon_name: 'input-keyboard-symbolic',
        });
        hotkeysPage.add(
            buildHotkeysGroup(
                this.lookupSettings(schemaSource, hotkeysSchemaName)
            )
        );
        window.add(hotkeysPage);
    }
}
