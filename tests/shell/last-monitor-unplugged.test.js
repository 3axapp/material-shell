/*
 * #22: the only monitor may go away while the shell runs, and a window may
 * open before it comes back. Material Shell threw from its monitors-changed
 * handlers, asked Mutter about the monitor that was gone, and the window got
 * no task bar item, not even once the monitor was back.
 *
 * shell-test: headless
 */

import Gio from 'gi://Gio';

import { check, plugMonitor, run, until } from './lib.js';

function openWindow(title) {
    const script = `
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
Gtk.init();
new Gtk.Window({ title: '${title}' }).present();
new GLib.MainLoop(null, false).run();
`;
    // Not killed at the end: it exits with the shell's Wayland display.
    Gio.Subprocess.new(['gjs', '-c', script], Gio.SubprocessFlags.NONE);
    return until(() => findWindow(title) !== null, 15000);
}

function activateWorkspace(index) {
    global.workspace_manager
        .get_workspace_by_index(index)
        .activate(global.get_current_time());
}

// Mutter answers a query for a missing monitor with a CRITICAL only.
const missingMonitorQueries = [];
const getMonitorInFullscreen = global.display.get_monitor_in_fullscreen;
global.display.get_monitor_in_fullscreen = function (index) {
    if (index >= global.display.get_n_monitors()) {
        missingMonitorQueries.push(new Error().stack.split('\n')[1]);
    }
    return getMonitorInFullscreen.call(this, index);
};

function interfaceBuilt() {
    const panel = global.ms.layout.panel;
    return global.ms.loaded && panel.visible && panel.mapped;
}

function findWindow(title) {
    for (const msWorkspace of global.ms.msWorkspaceManager.msWorkspaceList) {
        const msWindow = msWorkspace.msWindowList.find(
            (msWindow) => msWindow.metaWindow?.get_title() === title
        );
        if (msWindow) {
            return { msWorkspace, msWindow };
        }
    }
    return null;
}

function hasTaskBarItem({ msWorkspace, msWindow }) {
    return msWorkspace.msWorkspaceActor.panel.taskBar.items.some(
        (item) => item.tileable === msWindow
    );
}

run(async () => {
    const unplug = await plugMonitor();
    if (!check('interface built', await until(interfaceBuilt, 15000))) {
        return;
    }

    // Material Shell appends a workspace after the window on the last one.
    if (!check('first window opens', await openWindow('ms-first'))) {
        return;
    }
    activateWorkspace(1);
    if (!check('second window opens', await openWindow('ms-second'))) {
        return;
    }
    activateWorkspace(0);
    const first = findWindow('ms-first').msWorkspace;
    const second = findWindow('ms-second').msWorkspace;
    if (!check('windows on two workspaces', first !== second)) {
        return;
    }

    await unplug();
    const unplugged = await until(
        () => global.display.get_n_monitors() === 0,
        15000
    );
    if (!check('the monitor goes away', unplugged)) {
        return;
    }

    const opened = await openWindow('ms-unplugged');
    if (!check('a window opens with no monitor', opened)) {
        return;
    }
    check(
        'no fullscreen query for a missing monitor',
        missingMonitorQueries.length === 0,
        missingMonitorQueries.join('; ')
    );

    await plugMonitor();
    const replugged = await until(
        () => global.display.get_n_monitors() > 0 && interfaceBuilt(),
        15000
    );
    if (!check('interface back on the new monitor', replugged)) {
        return;
    }

    const itemShown = await until(
        () => hasTaskBarItem(findWindow('ms-unplugged')),
        5000
    );
    check('the window has a task bar item', itemShown);
    check(
        'windows keep their workspaces',
        findWindow('ms-first')?.msWorkspace === first &&
            findWindow('ms-second')?.msWorkspace === second &&
            global.ms.msWorkspaceManager.msWorkspaceList.includes(second),
        JSON.stringify({
            first: global.ms.msWorkspaceManager.msWorkspaceList.indexOf(
                findWindow('ms-first')?.msWorkspace
            ),
            second: global.ms.msWorkspaceManager.msWorkspaceList.indexOf(
                findWindow('ms-second')?.msWorkspace
            ),
        })
    );
});
