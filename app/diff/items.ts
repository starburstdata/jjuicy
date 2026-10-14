import type { DiffRow } from "../messages/DiffRow";
import type { FileDiffHunk } from "../messages/FileDiffHunk";
import type { Gap } from "./gaps";
import { pairRows, type RowPair } from "./pairing";

export type DiffMode = "unified" | "split";

// every item renders at the same height so long files can be windowed by index
export type DiffItem =
    | { type: "hunk"; hunk: FileDiffHunk }
    | { type: "gap"; index: number; hidden: number; leading: boolean; trailing: boolean }
    | { type: "row"; row: DiffRow }
    | { type: "pair"; pair: RowPair };

// lines revealed from each end of a gap: top follows the previous hunk, bottom precedes the next
export interface Reveal {
    top: number;
    bottom: number;
}

export const EXPAND_STEP = 20;

export function hiddenLines(gap: Gap, reveal: Reveal | undefined): number {
    return Math.max(0, gap.end - gap.start + 1 - (reveal?.top ?? 0) - (reveal?.bottom ?? 0));
}

// the new-side line ranges a reveal needs, clamped to the gap
export function revealRanges(gap: Gap, reveal: Reveal): [number, number][] {
    let len = gap.end - gap.start + 1;
    if (reveal.top + reveal.bottom >= len) return [[gap.start, gap.end]];
    let ranges: [number, number][] = [];
    if (reveal.top > 0) ranges.push([gap.start, gap.start + reveal.top - 1]);
    if (reveal.bottom > 0) ranges.push([gap.end - reveal.bottom + 1, gap.end]);
    return ranges;
}

// leading gaps only grow upwards from the first hunk, trailing ones downwards from the last
export function expandReveal(gap: Gap, reveal: Reveal | undefined, leading: boolean, trailing: boolean, all: boolean): Reveal {
    let len = gap.end - gap.start + 1;
    if (all) return { top: len, bottom: 0 };
    let top = reveal?.top ?? 0;
    let bottom = reveal?.bottom ?? 0;
    if (!leading) top += EXPAND_STEP;
    if (!trailing) bottom += EXPAND_STEP;
    if (top + bottom >= len) return { top: len, bottom: 0 };
    return { top, bottom };
}

function contextRow(line: number, offset: number, lines: Map<number, string>): DiffRow {
    return { kind: "Context", old_line: line + offset, new_line: line, text: lines.get(line) ?? "", tokens: [] };
}

export function buildItems(
    hunks: FileDiffHunk[],
    gaps: (Gap | null)[],
    reveals: Map<number, Reveal>,
    lines: Map<number, string>,
    mode: DiffMode,
): DiffItem[] {
    let items: DiffItem[] = [];

    function pushRows(rows: DiffRow[]) {
        if (mode == "unified") {
            for (let row of rows) items.push({ type: "row", row });
        } else {
            for (let pair of pairRows(rows)) items.push({ type: "pair", pair });
        }
    }

    function pushGap(index: number) {
        let gap = gaps[index];
        if (!gap) return;
        let reveal = reveals.get(index) ?? { top: 0, bottom: 0 };
        let hidden = hiddenLines(gap, reveal);
        let top: DiffRow[] = [];
        let bottom: DiffRow[] = [];
        if (hidden == 0) {
            for (let n = gap.start; n <= gap.end; n++) top.push(contextRow(n, gap.offset, lines));
        } else {
            for (let n = gap.start; n < gap.start + reveal.top; n++) top.push(contextRow(n, gap.offset, lines));
            for (let n = gap.end - reveal.bottom + 1; n <= gap.end; n++) bottom.push(contextRow(n, gap.offset, lines));
        }
        pushRows(top);
        if (hidden > 0) {
            items.push({ type: "gap", index, hidden, leading: index == 0, trailing: index == hunks.length });
        }
        pushRows(bottom);
    }

    hunks.forEach((hunk, i) => {
        pushGap(i);
        items.push({ type: "hunk", hunk });
        pushRows(hunk.rows);
    });
    if (hunks.length > 0) pushGap(hunks.length);
    return items;
}

// widest row in characters, so every row of a file can share one scroll width
export function maxColumns(items: DiffItem[]): number {
    let max = 0;
    function measure(row: DiffRow | null) {
        if (!row) return;
        let cols = 0;
        for (let c of row.text) cols += c == "\t" ? 4 : 1;
        if (cols > max) max = cols;
    }
    for (let item of items) {
        if (item.type == "row") measure(item.row);
        else if (item.type == "pair") {
            measure(item.pair.left);
            measure(item.pair.right);
        }
    }
    return max;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
