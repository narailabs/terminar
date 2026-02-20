/**
 * Type-safe EventEmitter interface.
 *
 * Usage:
 *   interface MyEvents {
 *     data: [payload: string];
 *     error: [err: Error];
 *     close: [];
 *   }
 *   class MyEmitter extends (EventEmitter as new () => TypedEventEmitter<MyEvents>) { ... }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A type-safe EventEmitter interface. Constrains on(), emit(), once(), off(),
 * addListener(), and removeListener() to the event map.
 *
 * T should be an interface mapping event names to argument tuples, e.g.:
 *   { data: [payload: string]; close: [] }
 */
export interface TypedEventEmitter<T> {
    on<K extends keyof T & string>(event: K, listener: (...args: T[K] extends any[] ? T[K] : never) => void): this;
    once<K extends keyof T & string>(event: K, listener: (...args: T[K] extends any[] ? T[K] : never) => void): this;
    off<K extends keyof T & string>(event: K, listener: (...args: T[K] extends any[] ? T[K] : never) => void): this;
    emit<K extends keyof T & string>(event: K, ...args: T[K] extends any[] ? T[K] : never): boolean;
    addListener<K extends keyof T & string>(event: K, listener: (...args: T[K] extends any[] ? T[K] : never) => void): this;
    removeListener<K extends keyof T & string>(event: K, listener: (...args: T[K] extends any[] ? T[K] : never) => void): this;
    removeAllListeners<K extends keyof T & string>(event?: K): this;
    listeners<K extends keyof T & string>(event: K): ((...args: T[K] extends any[] ? T[K] : never) => void)[];
    listenerCount<K extends keyof T & string>(event: K): number;
}

/**
 * Maps event names to their argument tuples. Used as a documentation alias.
 */
export type EventMap = Record<string, any[]>;
