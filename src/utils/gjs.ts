import GObject from 'gi://GObject';
const Signals = imports.signals;

/// Type of the `static metaInfo` field read by `registerGObjectClass`.
export type MetaInfo = GObject.MetaInfo<
    { [key: string]: GObject.ParamSpec },
    { $gtype: GObject.GType }[],
    {
        [key: string]: {
            param_types?: readonly GObject.GTypeInput[];
            [key: string]: unknown;
        };
    }
>;

/// Decorator function to call `GObject.registerClass` with the given class.
/// Use like
/// ```
/// @registerGObjectClass
/// export class MyThing extends GObject.Object { ... }
/// ```
export function registerGObjectClass<
    K,
    T extends {
        metaInfo?: MetaInfo;
        // GObject.registerClass requires `new (...args: any[]) => K`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (...params: any[]): K;
    }
>(target: T) {
    // Note that we use 'hasOwnProperty' because otherwise we would get inherited meta infos.
    // This would be bad because we would inherit the GObjectName too, which is supposed to be unique.
    if (Object.prototype.hasOwnProperty.call(target, 'metaInfo')) {
        return GObject.registerClass<K, T>(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            target.metaInfo!,
            target
        ) as typeof target;
    } else {
        return GObject.registerClass<K, T>(target) as typeof target;
    }
}

export class WithSignals {
    // Note: these will be replaced by the addSignalMethods function
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any
    emit(name: string, ...params: any[]): void {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    connect(name: string, callback: (...params: any[]) => void): number {
        return 0;
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
    disconnect(id: number): void {}
}
Signals.addSignalMethods(WithSignals.prototype);
