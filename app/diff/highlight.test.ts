import { describe, it, expect } from "vitest";
import type { DiffRow } from "../messages/DiffRow";
import { DiffHighlighter, highlightRows, languageOf, parserFor } from "./highlight";
import { buildItems } from "./items";
import { splitSpans, syntaxParts } from "./spans";

function row(kind: DiffRow["kind"], text: string, line: number): DiffRow {
    return {
        kind,
        old_line: kind == "Added" ? null : line,
        new_line: kind == "Removed" ? null : line,
        text,
        tokens: [],
    };
}

function classesOf(text: string, spans: { start: number; end: number; cls: string }[]) {
    return spans.map((s) => [text.slice(s.start, s.end), s.cls]);
}

describe("languageOf", () => {
    it("maps extensions and ignores unknown or dotfiles", () => {
        expect(languageOf("src/worker/mod.rs")).toBe("rust");
        expect(languageOf("app/App.TSX")).toBe("tsx");
        expect(languageOf("README")).toBeNull();
        expect(languageOf(".gitignore")).toBeNull();
        expect(languageOf("notes.txt")).toBeNull();
    });
});

describe("highlightRows", () => {
    it("colours tokens by theme class", async () => {
        let parser = (await parserFor("a.rs"))!;
        let [spans] = highlightRows(parser, [row("Context", 'fn main() { let s = "x"; }', 1)]);
        let found = classesOf('fn main() { let s = "x"; }', spans);
        expect(found).toContainEqual(["fn", "syn-keyword"]);
        expect(found).toContainEqual(['"x"', "syn-string"]);
    });

    it("carries block comments across lines", async () => {
        let parser = (await parserFor("a.ts"))!;
        let spans = highlightRows(parser, [row("Context", "/* start", 1), row("Context", "end */ let x = 1;", 2)]);
        expect(classesOf("end */ let x = 1;", spans[1])).toContainEqual(["end */", "syn-comment"]);
    });

    it("returns nothing for unknown languages", async () => {
        expect(await parserFor("a.unknown")).toBeNull();
    });
});

describe("DiffHighlighter", () => {
    it("highlights old and new sides as separate documents", async () => {
        let parser = (await parserFor("a.ts"))!;
        let removed = row("Removed", "let a = 1; /*", 2);
        let added = row("Added", "let a = 2;", 2);
        let after = row("Context", "let b = 3;", 3);
        let items = buildItems(
            [{ header: { location: { from_file: { start: 2, len: 2 }, to_file: { start: 2, len: 2 } }, lines: { lines: [] } }, rows: [removed, added, after] }],
            [null, null],
            new Map(),
            new Map(),
            "unified",
        );
        let spans = new DiffHighlighter(parser, items).ensure(0, items.length);
        // the comment opened on the removed line must not leak into the new side
        expect(classesOf(after.text, spans.get(after)!)).toContainEqual(["let", "syn-keyword"]);
        expect(classesOf(removed.text, spans.get(removed)!)).toContainEqual(["let", "syn-keyword"]);
    });
});

describe("syntaxParts", () => {
    it("nests syntax classes inside word spans", () => {
        let text = "let x = 1;";
        let spans = splitSpans(text, [{ start: 4, end: 9 }]);
        let parts = syntaxParts(spans, [
            { start: 0, end: 3, cls: "syn-keyword" },
            { start: 8, end: 9, cls: "syn-number" },
        ]);
        expect(parts).toEqual([
            [{ text: "let", cls: "syn-keyword" }, { text: " ", cls: null }],
            [{ text: "x = ", cls: null }, { text: "1", cls: "syn-number" }],
            [{ text: ";", cls: null }],
        ]);
    });
});
