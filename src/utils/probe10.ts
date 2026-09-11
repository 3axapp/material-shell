/**
 * TEMPORARY probe for issue #10. Logs under the GLIB_DOMAIN "MS10" so it can be
 * read with `journalctl -b 'GLIB_DOMAIN=MS10'`. Delete this file and its call
 * sites before committing anything.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export function probe(...args: unknown[]): void {
    GLib.log_structured('MS10', GLib.LogLevelFlags.LEVEL_MESSAGE, {
        MESSAGE: args.join(' '),
    });
}

/** Actor plus the monitor of the msWorkspace it lives on, without importing it. */
export function describeActor(actor: Clutter.Actor | null): string {
    if (actor === null) return 'null';
    let current: Clutter.Actor | null = actor;
    while (current !== null) {
        const msWorkspace = (current as unknown as { msWorkspace?: unknown })
            .msWorkspace as
            | { monitor?: { index: number }; monitorIsExternal?: boolean }
            | undefined;
        if (msWorkspace?.monitor !== undefined) {
            return `${actor}@mon${msWorkspace.monitor.index}${
                msWorkspace.monitorIsExternal ? 'ext' : 'pri'
            }`;
        }
        current = current.get_parent();
    }
    return `${actor}@outside`;
}

export function describeFocusWindow(): string {
    const window = global.display.get_focus_window();
    if (window === null) return 'none';
    return `${window.get_wm_class()}"${window.get_title()}"mon${window.get_monitor()}client${window.get_client_type()}`;
}
