/*
 * #12: gnome-shell may start before any monitor exists, as does a session
 * whose only screen is plugged in later. Material Shell has to wait for a
 * monitor instead of failing to enable.
 *
 * With the devkit viewer the monitor raced the extension, so the test runs
 * headless with no monitor at all and plugs one in itself, through the
 * virtual monitor of Mutter's screen cast API (#20).
 *
 * shell-test: headless
 */

import { check, plugMonitor, run, until } from './lib.js';

// Read while the shell imports the extension.
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
    ) {
        return;
    }

    await plugMonitor();
    const monitorAdded = await until(
        () => global.display.get_n_monitors() > 0,
        15000
    );
    if (!check('a monitor appears', monitorAdded, describeState())) {
        return;
    }

    const built = await until(() => {
        const panel = global.ms.layout.panel;
        return global.ms.loaded && panel.visible && panel.mapped;
    }, 15000);
    check('interface built on the new monitor', built, describeState());
});
