// Inspired by https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/blob/master/utils.js

/** Extension imports */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { default as Me } from 'src/extension';
import { MsWorkspaceState } from 'src/layout/msWorkspace/msWorkspace';
import { HistoryItem } from 'src/layout/verticalPanel/search/searchProvider/RecentSearchProvider';
import { MsWorkspaceManagerState } from 'src/manager/msWorkspaceManager';

import { Debug } from 'src/utils/debug';
import { getSettings } from 'src/utils/settings';

/** Gnome libs imports */
const FileTest = GLib.FileTest;

const REGISTRY_PATH = `${GLib.get_user_cache_dir()}/material-shell@papyelgringo-state.json`;

/** What the extension keeps between sessions, by key. */
export interface PersistedState {
    'panels-visible'?: boolean;
    'notification-uuid'?: string;
    /** ISO date of the last notification check. */
    'notification-check'?: string;
    'workspaces-state'?: MsWorkspaceManagerState;
    'recent-searches'?: { history: HistoryItem[] };
}

/** Older versions kept workspaces in two lists. */
type LegacyWorkspacesState = Omit<
    MsWorkspaceManagerState,
    'msWorkspaceList'
> & {
    msWorkspaceList?: LegacyMsWorkspaceState[];
    primaryWorkspaceList: LegacyMsWorkspaceState[];
    externalWorkspaces: LegacyMsWorkspaceState[];
};

/** Older versions called layoutKey tilingLayout. */
type LegacyMsWorkspaceState = Omit<MsWorkspaceState, 'layoutKey'> & {
    layoutKey?: string;
    tilingLayout?: string;
};

export class StateManager {
    state: PersistedState;
    stateFile: Gio.File;
    stateChangedTriggered: boolean | undefined;

    constructor() {
        this.state = {};
        this.stateFile = Gio.file_new_for_path(REGISTRY_PATH);
    }
    loadRegistry(callback: (state: PersistedState) => void) {
        if (typeof callback !== 'function')
            throw TypeError('`callback` must be a function');
        const serializedState = global.get_persistent_state(
            's',
            'material-shell-state'
        );
        if (serializedState) {
            try {
                this.state = this.updateState(
                    JSON.parse(serializedState.deep_unpack<string>())
                );
            } catch (_e) {
                this.state = {};
            }
            return callback(this.state);
        }
        if (GLib.file_test(REGISTRY_PATH, FileTest.EXISTS)) {
            this.stateFile.load_contents_async(null, (obj, res) => {
                const file = obj as unknown as Gio.File;
                const [success, contents] = file.load_contents_finish(res);
                if (success) {
                    try {
                        this.state = this.updateState(
                            JSON.parse(imports.byteArray.toString(contents))
                        );
                    } catch (e) {
                        Debug.log(e);
                        this.state = {};
                    }
                }
                callback(this.state);
            });
        } else {
            this.state = {};
            callback(this.state);
        }
    }

    updateState(state: PersistedState) {
        if (state) {
            const workspacesState = state['workspaces-state'] as
                | LegacyWorkspacesState
                | undefined;
            if (workspacesState) {
                // in old version the workspaces was split in 2 different array
                workspacesState.msWorkspaceList =
                    workspacesState.msWorkspaceList || [
                        ...workspacesState.primaryWorkspaceList,
                        ...workspacesState.externalWorkspaces,
                    ];

                workspacesState.msWorkspaceList.map(
                    (msWorkspaceState: LegacyMsWorkspaceState) => {
                        msWorkspaceState.layoutKey =
                            msWorkspaceState.layoutKey ||
                            msWorkspaceState.tilingLayout;
                        delete msWorkspaceState.tilingLayout;
                        return msWorkspaceState;
                    }
                );
            }
        }
        return state;
    }

    saveRegistry() {
        const json = JSON.stringify(this.state);
        global.set_persistent_state(
            'material-shell-state',
            GLib.Variant.new_string(json)
        );
    }
    getState<K extends keyof PersistedState>(key: K): PersistedState[K] {
        return this.state[key];
    }
    setState<K extends keyof PersistedState>(key: K, value: PersistedState[K]) {
        if (value === undefined) {
            delete this.state[key];
        } else {
            this.state[key] = value;
        }
        this.saveRegistry();
    }

    stateChanged() {
        if (
            !Me.instance.loaded ||
            Me.msWorkspaceManager.updatingMonitors ||
            this.stateChangedTriggered ||
            Me.instance.disableInProgress
        )
            return;

        this.stateChangedTriggered = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.saveCurrentState();
            this.stateChangedTriggered = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    saveCurrentState() {
        // Avoid unnecessary work
        if (!Me.instance.loaded || Me.instance.disableInProgress) return;

        if (getSettings('tweaks').get_boolean('enable-persistence')) {
            this.setState('workspaces-state', Me.msWorkspaceManager.state);
        }
    }

    destroy() {}
}
