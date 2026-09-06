/*
 * Stand-in for resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js.
 *
 * The real module lives in a gresource that only the Extensions app registers,
 * and it drags in the whole extensions D-Bus service. The preferences code only
 * needs a base class to extend and the gettext helpers, so the tests compile
 * this file into a gresource under the same path instead.
 */

export class ExtensionPreferences {
    constructor(metadata) {
        this.metadata = metadata;
    }

    get uuid() {
        return this.metadata['uuid'];
    }

    get dir() {
        return this.metadata['dir'];
    }

    get path() {
        return this.metadata['path'];
    }

    getPreferencesWidget() {
        throw new Error('not implemented');
    }

    async fillPreferencesWindow(_window) {}
}

export function gettext(str) {
    return str;
}

function ngettextImpl(singular, plural, n) {
    return n === 1 ? singular : plural;
}
export { ngettextImpl as ngettext };

export function pgettext(_context, str) {
    return str;
}
