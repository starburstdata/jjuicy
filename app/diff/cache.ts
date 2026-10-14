import type { FileDiff } from "../messages/FileDiff";
import type { RevSet } from "../messages/RevSet";

// commit ids are content hashes, so a cached diff never goes stale
export class Lru<K, V> {
    #map = new Map<K, V>();
    #limit: number;

    constructor(limit: number) {
        this.#limit = limit;
    }

    get(key: K): V | undefined {
        let value = this.#map.get(key);
        if (value !== undefined) {
            this.#map.delete(key);
            this.#map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V) {
        this.#map.delete(key);
        this.#map.set(key, value);
        while (this.#map.size > this.#limit) {
            this.#map.delete(this.#map.keys().next().value as K);
        }
    }

    clear() {
        this.#map.clear();
    }
}

export function diffKey(set: RevSet, path: string): string {
    return `${set.from.commit.hex}:${set.to.commit.hex}:${path}`;
}

export const diffCache = new Lru<string, FileDiff>(20);
