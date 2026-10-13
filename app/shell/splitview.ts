export interface SplitState {
    sizes: number[];
    collapsed: boolean[];
}

export function defaultState(n: number, collapsed?: boolean[]): SplitState {
    return {
        sizes: Array.from({ length: n }, () => 1 / n),
        collapsed: Array.from({ length: n }, (_, i) => collapsed?.[i] ?? false),
    };
}

// each window remembers its own layout; web mode has a single window
export function windowStorageKey(base: string): string {
    let label = (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return label ? `${base}:${label}` : base;
}

export function loadState(key: string, n: number, fallback: SplitState): SplitState {
    try {
        let raw = localStorage.getItem(key);
        if (!raw) return fallback;
        let parsed = JSON.parse(raw) as Partial<SplitState>;
        let sizes = parsed.sizes;
        let collapsed = parsed.collapsed;
        if (!Array.isArray(sizes) || sizes.length != n || sizes.some(s => typeof s != "number" || !(s > 0))) {
            return fallback;
        }
        if (!Array.isArray(collapsed) || collapsed.length != n) {
            collapsed = fallback.collapsed;
        }
        let total = sizes.reduce((a, b) => a + b, 0);
        return { sizes: sizes.map(s => s / total), collapsed: collapsed.map(c => !!c) };
    } catch {
        return fallback;
    }
}

export function saveState(key: string, state: SplitState) {
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch {
        // storage can be unavailable (private mode, quota) - layout just won't persist
    }
}

/**
 * Moves the boundary between adjacent visible columns `a` and `b`, preserving
 * their combined share. `leftPx` is the requested width of `a` and `pairPx` the
 * combined width of both; returns the input unchanged if the minimums can't fit.
 */
export function resizePair(
    sizes: number[],
    a: number,
    b: number,
    leftPx: number,
    pairPx: number,
    minSizes: number[],
): number[] {
    let minA = minSizes[a] ?? 0;
    let minB = minSizes[b] ?? 0;
    if (pairPx <= 0 || pairPx < minA + minB) return sizes;
    let clamped = Math.min(pairPx - minB, Math.max(minA, leftPx));
    let share = sizes[a] + sizes[b];
    let next = [...sizes];
    next[a] = (share * clamped) / pairPx;
    next[b] = share - next[a];
    return next;
}

export function gridTemplate(state: SplitState, minSizes: number[]): string {
    let parts: string[] = [];
    state.sizes.forEach((size, i) => {
        if (state.collapsed[i]) return;
        if (parts.length > 0) parts.push("var(--ju-components-separatorWidth)");
        parts.push(`minmax(${minSizes[i] ?? 0}px, ${size}fr)`);
    });
    return parts.join(" ");
}
