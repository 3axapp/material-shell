/** Gnome libs imports */
import Meta from 'gi://Meta';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';

/** Meta with the preference that OverrideModule replaces */
type WritableMeta = { prefs_get_workspaces_only_on_primary: () => boolean };

/* exported OverrideModule */
export class OverrideModule {
    orignalMetaWorkspaceOnPrimary: () => boolean;
    windowManagersFunctionToRestore: [unknown, unknown][];

    constructor() {
        this.windowManagersFunctionToRestore = [];
        this.overrideWindowManagerFunctions();
        this.orignalMetaWorkspaceOnPrimary =
            Meta.prefs_get_workspaces_only_on_primary;
        // Typescript doesn't allow us to modify this method by default, but we can trick it into allowing us
        (Meta as WritableMeta).prefs_get_workspaces_only_on_primary = () =>
            true;
    }

    destroy() {
        this.restoreWindowManagersFunctions();
        (Meta as WritableMeta).prefs_get_workspaces_only_on_primary =
            this.orignalMetaWorkspaceOnPrimary;
    }

    overrideWindowManagerFunctions() {
        this.windowManagersFunctionToRestore = [];
        const _shouldAnimate =
            WindowManager.WindowManager.prototype._shouldAnimate;
        WindowManager.WindowManager.prototype._shouldAnimate = function () {
            return false;
        };
        this.windowManagersFunctionToRestore.push([
            WindowManager.WindowManager.prototype._shouldAnimate,
            _shouldAnimate,
        ]);
    }

    restoreWindowManagersFunctions() {
        this.windowManagersFunctionToRestore.forEach((functions) => {
            functions[0] = functions[1];
        });
    }
}
