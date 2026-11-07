import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** Drops the cached theme node of every St widget in the subtree.
 *
 * st_widget_style_changed cascades to descendants on its own, so the walk only
 * has to reach the first St.Widget in each branch — MsWorkspaceActor, its
 * tileableContainer and MsWindow are plain Clutter actors, while HorizontalPanel
 * and MsWindowContent are not.
 */
export function invalidateStyleRecursively(actor: Clutter.Actor) {
    if (actor instanceof St.Widget) {
        actor.style_changed();
        return;
    }
    for (const child of actor.get_children()) {
        invalidateStyleRecursively(child);
    }
}

/** Sets whether the widget has the given style class */
export function setStyleClass(
    widget: St.Widget,
    styleClass: string,
    enabled: boolean
) {
    if (enabled) {
        if (!widget.has_style_class_name(styleClass)) {
            widget.add_style_class_name(styleClass);
        }
    } else {
        if (widget.has_style_class_name(styleClass)) {
            widget.remove_style_class_name(styleClass);
        }
    }
}
