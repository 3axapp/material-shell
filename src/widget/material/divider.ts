/** Gnome libs imports */
import St from 'gi://St';
import { MetaInfo, registerGObjectClass } from 'src/utils/gjs';

/** Extension imports */

@registerGObjectClass
export class MatDivider extends St.Widget {
    static metaInfo: MetaInfo = {
        GTypeName: 'MatDivider',
    };

    vertical: boolean;

    constructor(vertical = false) {
        super({
            y_expand: vertical,
            x_expand: !vertical,
        });

        this.vertical = vertical;
    }

    override vfunc_get_preferred_width(forHeight: number): [number, number] {
        return this.vertical
            ? [1, 1]
            : // Note: clutter typing is incorrect here
              (super.vfunc_get_preferred_width(forHeight) as [number, number]);
    }
    override vfunc_get_preferred_height(forWidth: number): [number, number] {
        return !this.vertical
            ? [1, 1]
            : // Note: clutter typing is incorrect here
              (super.vfunc_get_preferred_height(forWidth) as [number, number]);
    }
}
