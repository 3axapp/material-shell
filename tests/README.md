# Tests

Checks for the preferences window. The extension itself runs inside
gnome-shell and cannot be exercised this way, but `prefs.js` is an ordinary
GTK module, so it can be loaded into a plain `gjs` process and inspected.

## Running

```sh
make compile   # the tests read dist/, not src/
make test      # or: gjs -m tests/prefs-check.js
```

A display is needed — the widgets have to be realized to report their sizes.
Wayland and X11 both work.

Settings are read and written against `GSETTINGS_BACKEND=memory`, which
`harness.js` sets before anything creates a `Gio.Settings`, and then verifies.
Your own configuration is never touched.

## What is here

| File               |                                                                                                          |
|--------------------|----------------------------------------------------------------------------------------------------------|
| `prefs-check.js`   | Asserts the window fits, and that every kind of row reads and writes its key. Exits non-zero on failure. |
| `prefs-measure.js` | Prints the width each widget asks for, as a tree. A diagnostic, not a test.                              |
| `harness.js`       | Loads `dist/prefs.js` into an `Adw.PreferencesWindow`.                                                   |
| `stub/`            | Stands in for the gnome-shell resource `prefs.js` imports.                                               |

`prefs-measure.js` is the tool that found
[#8](https://github.com/3axapp/material-shell/issues/8): the hidden Hotkeys
page pushed the content's minimum width to 765px while the window opened at
640px, and libadwaita clips rather than grows. Reach for it whenever the
preferences window looks cut off — it names the widget responsible.

## The stub

`prefs.js` imports `ExtensionPreferences` from
`resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`. That resource
is registered only inside the Extensions app, and the real module pulls in the
extensions D-Bus service with it. `stub/prefs.js` provides the same exports and
is compiled into a gresource under the same path at the start of every run, so
`glib-compile-resources` has to be on `PATH`.
