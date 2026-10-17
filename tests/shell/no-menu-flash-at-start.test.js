/*
 * #15: the context menu of a workspace button ("Panel icons style") flashed in
 * the top left corner while the shell started. No menu may stay on screen
 * unless someone opens it.
 */

import { check, run, until, wait, watchMenus } from './lib.js';

const menus = watchMenus();

run(async () => {
    const built = await until(() => {
        const panel = global.ms.layout.panel;
        return global.ms.loaded && panel.visible && panel.mapped;
    }, 15000);
    if (!check('interface built', built)) return;

    // Let the shell settle and the menu checks run.
    await wait(1000);

    if (
        !check(
            'menus created at start',
            menus.added > 0,
            'no menu reached uiGroup, so this run proves nothing'
        )
    )
        return;
    check(
        'no closed menu on screen at start',
        menus.shown.length === 0,
        menus.shown.join('; ')
    );
});
