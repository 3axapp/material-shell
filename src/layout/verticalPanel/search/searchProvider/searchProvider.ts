/* exported loadRemoteSearchProviders */
import GLib from 'gi://GLib';
import St from 'gi://St';
import { AppSearchProvider } from './AppSearchProvider';
import { RecentSearchProvider } from './RecentSearchProvider';
import { RemoteSearchProvider } from './RemoteSearchProvider';

export interface RawMeta {
    [prop: string]: GLib.Variant;
}

export interface UnpackedMeta {
    [prop: string]: unknown;
    id?: string;
    name?: string;
    icon?: GLib.Variant;
    gicon?: string;
    description?: string;
    clipboardText?: string;
    /** width, height, rowstride, has alpha, bits per sample, channels, data */
    'icon-data'?: [number, number, number, boolean, number, number, Uint8Array];
}

export interface ResultMeta {
    id: string;
    name: string;
    createIcon: (size: number) => St.Icon | null;
    description?: string;
    clipboardText?: string;
}

export type SearchProvider = AppSearchProvider | RemoteSearchProvider;

export type ReactiveSearchProvider = SearchProvider | RecentSearchProvider;
