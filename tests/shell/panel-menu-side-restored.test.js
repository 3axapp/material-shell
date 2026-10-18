/*
 * #17: on disable, restorePanelMenuSide put back the saved _calculateArrowSide
 * of every panel menu, including menus added after the extension had
 * overridden them. Those had nothing saved, so they got undefined, which
 * shadowed the BoxPointer method and broke the menu once the extension was
 * off.
 */

import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { check, run, until } from './lib.js';

const UUID = 'material-shell@papyelgringo';

/** The BoxPointer method itself, not a leftover override or undefined. */
function arrowSideRestored(boxPointer) {
    const method = boxPointer._calculateArrowSide;
    return [
        method === BoxPointer.BoxPointer.prototype._calculateArrowSide,
        `${method}`.slice(0, 80),
    ];
}

run(async () => {
    const loaded = await until(() => global.ms.loaded, 15000);
    if (!check('extension loaded', loaded)) {
        return;
    }

    const oldMenu = Main.panel.statusArea.quickSettings.menu;
    const button = new PanelMenu.Button(0.0, 'mstest');
    Main.panel.addToStatusArea('mstest-menu', button);

    Main.extensionManager.disableExtension(UUID);
    const disabled = await until(
        () =>
            Main.extensionManager.lookup(UUID).state !== ExtensionState.ACTIVE,
        5000
    );
    if (!check('extension disabled', disabled)) {
        return;
    }

    const [newOk, newDetails] = arrowSideRestored(button.menu._boxPointer);
    check('menu added after enable keeps its arrow side', newOk, newDetails);

    const [oldOk, oldDetails] = arrowSideRestored(oldMenu._boxPointer);
    check('menu present at enable gets its arrow side back', oldOk, oldDetails);
    check(
        'saved arrow side removed',
        !('oldArrowSideFunction' in oldMenu._boxPointer)
    );

    button.destroy();
});
