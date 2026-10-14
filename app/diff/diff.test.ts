import { describe, it, expect } from "vitest";
import type { DiffRow } from "../messages/DiffRow";
import type { FileDiffHunk } from "../messages/FileDiffHunk";
import { pairRows } from "./pairing";
import { splitSpans } from "./spans";
import { computeGaps } from "./gaps";
import { buildItems, expandReveal, formatSize, hiddenLines, maxColumns, revealRanges } from "./items";
import { Lru } from "./cache";

function row(kind: DiffRow["kind"], text: string, old_line: number | null = null, new_line: number | null = null): DiffRow {
    return { kind, old_line, new_line, text, tokens: [] };
}

function hunk(oldStart: number, oldLen: number, newStart: number, newLen: number): FileDiffHunk {
    return {
        header: {
            location: { from_file: { start: oldStart, len: oldLen }, to_file: { start: newStart, len: newLen } },
            lines: { lines: [] },
        },
        rows: [],
    };
}

describe("pairRows", () => {
    it("puts context on both sides", () => {
        let c = row("Context", "a", 1, 1);
        expect(pairRows([c])).toEqual([{ left: c, right: c }]);
    });

    it("aligns removals with the following additions", () => {
        let r1 = row("Removed", "r1"), r2 = row("Removed", "r2"), a1 = row("Added", "a1");
        expect(pairRows([r1, r2, a1])).toEqual([
            { left: r1, right: a1 },
            { left: r2, right: null },
        ]);
    });

    it("pads lone additions on the left", () => {
        let c = row("Context", "c"), a1 = row("Added", "a1"), a2 = row("Added", "a2");
        expect(pairRows([c, a1, a2])).toEqual([
            { left: c, right: c },
            { left: null, right: a1 },
            { left: null, right: a2 },
        ]);
    });

    it("starts a new run when removals follow additions", () => {
        let a = row("Added", "a"), r = row("Removed", "r");
        expect(pairRows([a, r])).toEqual([
            { left: null, right: a },
            { left: r, right: null },
        ]);
    });

    it("lets markers span both sides", () => {
        let r = row("Removed", "r"), m = row("Marker", "\\ No newline"), a = row("Added", "a");
        expect(pairRows([r, m, a])).toEqual([
            { left: r, right: null },
            { left: m, right: m },
            { left: null, right: a },
        ]);
    });
});

describe("splitSpans", () => {
    it("returns the whole text when there are no tokens", () => {
        expect(splitSpans("abc", [])).toEqual([{ text: "abc", changed: false }]);
    });

    it("marks token ranges", () => {
        expect(splitSpans("let x = 1;", [{ start: 4, end: 5 }, { start: 8, end: 9 }])).toEqual([
            { text: "let ", changed: false },
            { text: "x", changed: true },
            { text: " = ", changed: false },
            { text: "1", changed: true },
            { text: ";", changed: false },
        ]);
    });

    it("clamps out-of-range and overlapping tokens", () => {
        expect(splitSpans("abc", [{ start: 1, end: 10 }, { start: 2, end: 3 }, { start: 5, end: 6 }])).toEqual([
            { text: "a", changed: false },
            { text: "bc", changed: true },
        ]);
    });

    it("indexes by utf-16 units", () => {
        expect(splitSpans("😀x", [{ start: 2, end: 3 }])).toEqual([
            { text: "😀", changed: false },
            { text: "x", changed: true },
        ]);
    });

    it("keeps an empty line renderable", () => {
        expect(splitSpans("", [])).toEqual([{ text: "", changed: false }]);
    });
});

describe("computeGaps", () => {
    it("finds leading, middle and trailing gaps", () => {
        let gaps = computeGaps([hunk(5, 7, 5, 8), hunk(30, 6, 31, 6)], 50);
        expect(gaps).toEqual([
            { start: 1, end: 4, offset: 0 },
            { start: 13, end: 30, offset: -1 },
            { start: 37, end: 50, offset: -1 },
        ]);
    });

    it("omits empty gaps", () => {
        expect(computeGaps([hunk(1, 3, 1, 4)], 4)).toEqual([null, null]);
    });

    it("handles empty sides", () => {
        // whole file deleted
        expect(computeGaps([hunk(1, 3, 1, 0)], 0)).toEqual([null, null]);
    });

    it("has nothing to show without hunks", () => {
        expect(computeGaps([], 10)).toEqual([null]);
    });
});

describe("buildItems", () => {
    function rowsHunk(oldStart: number, newStart: number, rows: DiffRow[]): FileDiffHunk {
        let oldLen = rows.filter((r) => r.kind != "Added" && r.kind != "Marker").length;
        let newLen = rows.filter((r) => r.kind != "Removed" && r.kind != "Marker").length;
        return { ...hunk(oldStart, oldLen, newStart, newLen), rows };
    }

    let h1 = rowsHunk(4, 4, [row("Context", "c4", 4, 4), row("Removed", "x", 5, null), row("Added", "y", null, 5)]);
    let h2 = rowsHunk(40, 40, [row("Added", "z", null, 40)]);
    let gaps = computeGaps([h1, h2], 60);

    it("separates hunks with collapsed gaps", () => {
        let items = buildItems([h1, h2], gaps, new Map(), new Map(), "unified");
        expect(items.map((i) => i.type)).toEqual(["gap", "hunk", "row", "row", "row", "gap", "hunk", "row", "gap"]);
        expect(items[0]).toMatchObject({ hidden: 3, leading: true });
        expect(items[5]).toMatchObject({ hidden: 34, leading: false, trailing: false });
        expect(items[8]).toMatchObject({ hidden: 20, trailing: true });
    });

    it("pairs rows in split mode", () => {
        let items = buildItems([h1], computeGaps([h1], 5), new Map(), new Map(), "split");
        expect(items.map((i) => i.type)).toEqual(["gap", "hunk", "pair", "pair"]);
    });

    it("reveals context from both ends of a middle gap", () => {
        let gap = gaps[1]!;
        let reveal = expandReveal(gap, undefined, false, false, false);
        // 34 hidden lines, so one step from each end covers it
        expect(reveal).toEqual({ top: 34, bottom: 0 });
        expect(revealRanges(gap, reveal)).toEqual([[gap.start, gap.end]]);

        let small = expandReveal({ start: 1, end: 100, offset: 0 }, undefined, false, false, false);
        expect(revealRanges({ start: 1, end: 100, offset: 0 }, small)).toEqual([[1, 20], [81, 100]]);
    });

    it("grows leading gaps upwards and trailing gaps downwards", () => {
        let gap = { start: 1, end: 100, offset: 2 };
        expect(expandReveal(gap, undefined, true, false, false)).toEqual({ top: 0, bottom: 20 });
        expect(expandReveal(gap, undefined, false, true, false)).toEqual({ top: 20, bottom: 0 });
        expect(expandReveal(gap, undefined, true, false, true)).toEqual({ top: 100, bottom: 0 });
    });

    it("renders revealed lines with both line numbers", () => {
        let lines = new Map([[1, "one"], [2, "two"], [3, "three"]]);
        let items = buildItems([h1], computeGaps([h1], 5), new Map([[0, { top: 3, bottom: 0 }]]), lines, "unified");
        expect(items.slice(0, 3)).toEqual([
            { type: "row", row: { kind: "Context", old_line: 1, new_line: 1, text: "one", tokens: [] } },
            { type: "row", row: { kind: "Context", old_line: 2, new_line: 2, text: "two", tokens: [] } },
            { type: "row", row: { kind: "Context", old_line: 3, new_line: 3, text: "three", tokens: [] } },
        ]);
        expect(hiddenLines(computeGaps([h1], 5)[0]!, { top: 3, bottom: 0 })).toBe(0);
    });

    it("measures the widest row", () => {
        let items = buildItems([h1], [null, null], new Map(), new Map(), "split");
        expect(maxColumns(items)).toBe(2);
        expect(maxColumns([{ type: "row", row: row("Context", "\ta") }])).toBe(5);
    });

    it("formats sizes", () => {
        expect(formatSize(10)).toBe("10 B");
        expect(formatSize(2048)).toBe("2.0 KB");
        expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
    });
});

describe("Lru", () => {
    it("evicts the least recently used entry", () => {
        let lru = new Lru<string, number>(2);
        lru.set("a", 1);
        lru.set("b", 2);
        lru.get("a");
        lru.set("c", 3);
        expect(lru.get("b")).toBeUndefined();
        expect(lru.get("a")).toBe(1);
        expect(lru.get("c")).toBe(3);
    });
});
