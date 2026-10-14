import type { Parser } from "@lezer/common";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";
import type { DiffRow } from "../messages/DiffRow";
import type { DiffItem } from "./items";

// class names match the theme's [syntax] section, so `.syn-x` is coloured by `--ju-syntax-x`
const highlighter = tagHighlighter([
    { tag: [tags.keyword, tags.tagName, tags.self], class: "syn-keyword" },
    { tag: [tags.string, tags.regexp, tags.escape, tags.character, tags.url], class: "syn-string" },
    { tag: tags.comment, class: "syn-comment" },
    { tag: [tags.number, tags.bool, tags.atom, tags.null], class: "syn-number" },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.attributeName, tags.labelName], class: "syn-type" },
    {
        tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName, tags.heading],
        class: "syn-function",
    },
    { tag: [tags.punctuation, tags.operator, tags.meta], class: "syn-punctuation" },
    { tag: [tags.variableName, tags.propertyName], class: "syn-variable" },
]);

// grammars are split into their own chunks and only fetched for files that need them
const LOADERS: Record<string, () => Promise<Parser>> = {
    js: async () => (await import("@lezer/javascript")).parser,
    jsx: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "jsx" }),
    ts: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "ts" }),
    tsx: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "ts jsx" }),
    rust: async () => (await import("@lezer/rust")).parser,
    python: async () => (await import("@lezer/python")).parser,
    css: async () => (await import("@lezer/css")).parser,
    scss: async () => (await import("@lezer/sass")).parser,
    sass: async () => (await import("@lezer/sass")).parser.configure({ dialect: "indented" }),
    html: async () => (await import("@lezer/html")).parser,
    json: async () => (await import("@lezer/json")).parser,
    markdown: async () => (await import("@lezer/markdown")).parser,
    go: async () => (await import("@lezer/go")).parser,
    java: async () => (await import("@lezer/java")).parser,
    cpp: async () => (await import("@lezer/cpp")).parser,
    php: async () => (await import("@lezer/php")).parser,
    xml: async () => (await import("@lezer/xml")).parser,
    yaml: async () => (await import("@lezer/yaml")).parser,
};

const EXTENSIONS: Record<string, string> = {
    js: "js", mjs: "js", cjs: "js", jsx: "jsx",
    ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
    rs: "rust", py: "python", pyi: "python",
    css: "css", scss: "scss", sass: "sass",
    html: "html", htm: "html", svelte: "html", vue: "html",
    json: "json", jsonc: "json",
    md: "markdown", markdown: "markdown",
    go: "go", java: "java",
    c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
    php: "php", xml: "xml", svg: "xml", yaml: "yaml", yml: "yaml",
};

let parsers = new Map<string, Promise<Parser | null>>();

export function languageOf(path: string): string | null {
    let name = path.slice(path.lastIndexOf("/") + 1);
    let dot = name.lastIndexOf(".");
    if (dot <= 0) return null;
    return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

export function parserFor(path: string): Promise<Parser | null> {
    let language = languageOf(path);
    if (!language) return Promise.resolve(null);
    let parser = parsers.get(language);
    if (!parser) {
        parser = LOADERS[language]().catch(() => null);
        parsers.set(language, parser);
    }
    return parser;
}

export interface SyntaxSpan {
    start: number;
    end: number;
    cls: string;
}

// highlights the rows as one document, so constructs spanning lines (block comments, strings) colour correctly
export function highlightRows(parser: Parser, rows: DiffRow[]): SyntaxSpan[][] {
    let code = rows.map((r) => r.text).join("\n");
    let out: SyntaxSpan[][] = rows.map(() => []);
    let line = 0;
    let col = 0;
    highlightCode(
        code,
        parser.parse(code),
        highlighter,
        (text, classes) => {
            if (classes && line < out.length) out[line].push({ start: col, end: col + text.length, cls: classes });
            col += text.length;
        },
        () => {
            line++;
            col = 0;
        },
    );
    return out;
}

// highlights the contiguous stretches of a diff that intersect the visible window, on demand
export class DiffHighlighter {
    private segments: [number, number][] = [];
    private done = new Set<number>();
    private spans = new Map<DiffRow, SyntaxSpan[]>();

    constructor(
        private parser: Parser,
        private items: DiffItem[],
    ) {
        let start = 0;
        items.forEach((item, i) => {
            if (item.type == "gap") {
                if (i > start) this.segments.push([start, i]);
                start = i + 1;
            }
        });
        if (items.length > start) this.segments.push([start, items.length]);
    }

    // returns a fresh map when anything new was highlighted, so dependants re-render
    ensure(first: number, last: number): Map<DiffRow, SyntaxSpan[]> {
        let changed = false;
        this.segments.forEach(([start, end], i) => {
            if (this.done.has(i) || end <= first || start >= last) return;
            this.done.add(i);
            changed = true;
            this.highlightSegment(start, end);
        });
        if (changed) this.spans = new Map(this.spans);
        return this.spans;
    }

    private highlightSegment(start: number, end: number) {
        let rows: DiffRow[] = [];
        for (let item of this.items.slice(start, end)) {
            if (item.type == "row") rows.push(item.row);
            else if (item.type == "pair") {
                if (item.pair.left) rows.push(item.pair.left);
                if (item.pair.right && item.pair.right !== item.pair.left) rows.push(item.pair.right);
            }
        }
        // old and new sides are separate documents; context rows belong to both and take the new side
        let newRows = rows.filter((r) => r.kind == "Context" || r.kind == "Added");
        let oldDoc = rows.filter((r) => r.kind == "Removed" || r.kind == "Context");
        let oldSpans = highlightRows(this.parser, oldDoc);
        oldDoc.forEach((row, i) => {
            if (row.kind == "Removed") this.spans.set(row, oldSpans[i]);
        });
        let newSpans = highlightRows(this.parser, newRows);
        newRows.forEach((row, i) => this.spans.set(row, newSpans[i]));
    }
}
