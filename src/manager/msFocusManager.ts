/** Gnome libs imports */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { default as Me } from 'src/extension';

import { MsWindow } from 'src/layout/msWorkspace/msWindow';
import { MsWorkspaceActor } from 'src/layout/msWorkspace/msWorkspace';
import { MsManager } from 'src/manager/msManager';
import { Async } from 'src/utils/async';

import { Debug } from 'src/utils/debug';
import { describeActor, describeFocusWindow, probe } from 'src/utils/probe10';
import {
    MetaWindowWithMsProperties,
    MsWindowManagerType,
} from './msWindowManager';

export type MsFocusManagerType = InstanceType<typeof MsFocusManager>;
export class MsFocusManager extends MsManager {
    msWindowManager: MsWindowManagerType;
    lastMsWindowFocused: MsWindow | null = null;
    lastKeyFocus: Clutter.Actor | null = null;
    focusProtected?: boolean;
    /** Set while we drop the key focus ourselves, so that the protection below
     * does not hand it straight back to the actor we are giving up on.
     */
    releasingKeyFocus?: boolean;
    actorGrabMap: Map<Clutter.Actor, boolean | Clutter.Grab> = new Map();
    constructor(msWindowManager: MsWindowManagerType) {
        super();
        this.msWindowManager = msWindowManager;
        this.observe(
            global.stage,
            'notify::key-focus',
            this.onKeyFocus.bind(this)
        );

        this.observe(
            global.display,
            'notify::focus-window',
            this.onWindowFocus.bind(this)
        );

        this.observe(
            global.workspace_manager,
            'active-workspace-changed',
            () => {
                if (!Me.instance.loaded) return;
                this.focusProtected = true;
                Async.addTimeout(GLib.PRIORITY_DEFAULT, 100, () => {
                    delete this.focusProtected;
                    return GLib.SOURCE_REMOVE;
                });
            }
        );
    }

    onKeyFocus(): void {
        const keyFocus = global.stage.key_focus;
        probe(
            'onKeyFocus new=' + describeActor(keyFocus),
            'last=' + describeActor(this.lastKeyFocus),
            'lastMsWindow=' + (this.lastMsWindowFocused ?? 'null'),
            'protected=' + (this.focusProtected ? 'yes' : 'no'),
            'focusWindow=' + describeFocusWindow()
        );
        if (this.releasingKeyFocus) return;
        if (!keyFocus) {
            if (
                this.focusProtected &&
                this.lastKeyFocus &&
                this.lastKeyFocus != this.lastMsWindowFocused &&
                this.lastKeyFocus.mapped
            ) {
                // Never restore the focus to an actor of a workspace we just left: it
                // would pin the keyboard focus to the shell. As long as a shell actor
                // holds the key focus mutter stops forwarding key events to wayland
                // clients, so the release of the shortcut key never reaches the focused
                // window and stays stuck down for it.
                if (!this.isOnActivePrimaryMsWorkspace(this.lastKeyFocus)) {
                    Debug.logFocus(
                        'Focus Protected, drop the stale focus of ',
                        this.lastKeyFocus
                    );
                    probe('DROP ' + describeActor(this.lastKeyFocus));

                    this.lastKeyFocus = null;
                    return;
                }

                Debug.logFocus(
                    'Focus Protected, restore focus to ',
                    this.lastKeyFocus
                );
                probe('RESTORE ' + describeActor(this.lastKeyFocus));

                return this.lastKeyFocus.grab_key_focus();
            }
            return;
        }

        this.lastKeyFocus = keyFocus;

        let actor: Clutter.Actor | null = keyFocus;
        while (actor !== null) {
            if (actor instanceof MsWindow) {
                this.setFocusToMsWindow(actor);
                return;
            }
            actor = actor.get_parent();
        }

        if (keyFocus != Main.layoutManager.uiGroup) {
            this.lastMsWindowFocused = null;
        }
    }

    onWindowFocus(): void {
        const windowFocus =
            global.display.get_focus_window() as MetaWindowWithMsProperties;

        if (!windowFocus || !windowFocus.msWindow) return;

        const msWindow = windowFocus.msWindow;
        msWindow.focusDialogs();
        this.setFocusToMsWindow(msWindow);
    }

    /**
     * Whether the actor still lives on the active workspace of the primary monitor.
     * The focus protection is only ever armed by a workspace switch, which happens on
     * the primary monitor, so an actor of any other workspace is stale. Asking
     * isDisplayed() here would not do: it reports every workspace of an external
     * monitor as displayed, which left the whole check without effect as soon as a
     * second monitor was connected.
     * Actors outside of any msWorkspace (panels, overlays) are never stale.
     */
    isOnActivePrimaryMsWorkspace(actor: Clutter.Actor): boolean {
        let current: Clutter.Actor | null = actor;
        while (current !== null) {
            if (current instanceof MsWorkspaceActor) {
                return (
                    current.msWorkspace ===
                    Me.msWorkspaceManager!.getActivePrimaryMsWorkspace()
                );
            }
            current = current.get_parent();
        }
        return true;
    }

    /**
     * Whether the actor belongs to one of our msWorkspaces rather than to the rest
     * of the shell.
     */
    isOwnWorkspaceActor(actor: Clutter.Actor): boolean {
        let current: Clutter.Actor | null = actor;
        while (current !== null) {
            if (current instanceof MsWorkspaceActor) return true;
            current = current.get_parent();
        }
        return false;
    }

    /**
     * Give up the clutter key focus when one of our own actors holds it.
     *
     * While a shell actor holds it mutter stops forwarding key events to wayland
     * clients altogether, so the release of a shortcut key never reaches the window
     * which had the keyboard and an XWayland client keeps the key latched in the X
     * server. Nothing in mutter ever clears the clutter key focus, so an actor which
     * stays on screen, like the app launcher of an external monitor, keeps it across
     * workspace switches: we are the only ones who can let it go.
     *
     * Actors of the rest of the shell are left alone, their keyboard is none of our
     * business.
     */
    releaseOwnKeyFocus(): void {
        const keyFocus = global.stage.key_focus;
        if (keyFocus === null || !this.isOwnWorkspaceActor(keyFocus)) return;

        probe('releaseOwnKeyFocus ' + describeActor(keyFocus));
        this.releasingKeyFocus = true;
        this.lastKeyFocus = null;
        global.stage.set_key_focus(null);
        delete this.releasingKeyFocus;
    }

    setFocusToMsWindow(msWindow: MsWindow): void {
        if (msWindow === this.lastMsWindowFocused) return;
        this.lastMsWindowFocused = msWindow;
        this.emit('focus-changed', msWindow);
    }

    /**
     * Return true if granted
     * @param {MsWindow} msWindow
     */
    requestFocus(msWindow: MsWindow): boolean {
        return (
            msWindow !== this.lastMsWindowFocused &&
            !this.msWindowManager.msDndManager.dragInProgress
        );
    }

    pushModal(
        actor: Clutter.Actor,
        options?: {
            timestamp?: number;
            options?: never;
            actionMode?: Shell.ActionMode;
        }
    ) {
        const grab = Main.pushModal(actor, options);
        this.actorGrabMap.set(actor, grab);
    }

    popModal(actor: Clutter.Actor) {
        const grab = this.actorGrabMap.get(actor);
        if (grab !== undefined) {
            Main.popModal(grab);

            this.actorGrabMap.delete(actor);
        }
    }
}
