/**
 * Shell modules that `@girs/gnome-shell` 51.0.1 does not ship types for.
 *
 * This file must stay free of top level imports: these are declarations of
 * modules the package does not know about, not augmentations of existing ones.
 */

declare module 'resource:///org/gnome/shell/ui/shellEntry.js' {
    export function addContextMenu(
        entry: import('gi://St').default.Entry,
        params?: { actionMode?: number }
    ): void;
}
