/*
 * #12: gnome-shell may start before any monitor exists — the nested devkit
 * shell does, as does a session whose only screen is plugged in later.
 * Material Shell has to wait for a monitor instead of failing to enable.
 */

import { check, run, until } from './lib.js';

// Read while the shell imports the extension, before the devkit viewer has
// created its monitor.
const monitorsAtStart = global.display.get_n_monitors();

function describeState() {
    return JSON.stringify({
        monitors: global.display.get_n_monitors(),
        loaded: global.ms?.loaded,
        layout: Boolean(global.ms?.layout),
    });
}

run(async () => {
    if (
        !check(
            'no monitor when the extension loads',
            monitorsAtStart === 0,
            `${monitorsAtStart} already present, so this run proves nothing`
        )
    )
        return;

    const monitorAdded = await until(
        () => global.display.get_n_monitors() > 0,
        15000
    );
    if (!check('a monitor appears', monitorAdded, describeState())) return;

    const built = await until(() => {
        const panel = global.ms.layout.panel;
        return global.ms.loaded && panel.visible && panel.mapped;
    }, 15000);
    check('interface built on the new monitor', built, describeState());
});
