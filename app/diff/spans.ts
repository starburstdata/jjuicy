import type { DiffToken } from "../messages/DiffToken";

export interface Span {
    text: string;
    changed: boolean;
}

// tokens are utf-16 ranges, which is what string indexing uses
export function splitSpans(text: string, tokens: DiffToken[]): Span[] {
    let spans: Span[] = [];
    let offset = 0;
    let sorted = [...tokens].sort((a, b) => a.start - b.start);
    for (let token of sorted) {
        let start = Math.max(offset, Math.min(token.start, text.length));
        let end = Math.min(token.end, text.length);
        if (end <= start) continue;
        if (start > offset) spans.push({ text: text.slice(offset, start), changed: false });
        spans.push({ text: text.slice(start, end), changed: true });
        offset = end;
    }
    if (offset < text.length || spans.length == 0) spans.push({ text: text.slice(offset), changed: false });
    return spans;
}

export interface Part {
    text: string;
    cls: string | null;
}

// syntax classes are a second layer inside the word spans, so a changed word stays one highlight
export function syntaxParts(spans: Span[], syntax: { start: number; end: number; cls: string }[]): Part[][] {
    let offset = 0;
    return spans.map((span) => {
        let parts: Part[] = [];
        let end = offset + span.text.length;
        let at = offset;
        for (let s of syntax) {
            if (s.end <= at || s.start >= end) continue;
            let from = Math.max(s.start, at);
            let to = Math.min(s.end, end);
            if (from > at) parts.push({ text: span.text.slice(at - offset, from - offset), cls: null });
            parts.push({ text: span.text.slice(from - offset, to - offset), cls: s.cls });
            at = to;
        }
        if (at < end || parts.length == 0) parts.push({ text: span.text.slice(at - offset), cls: null });
        offset = end;
        return parts;
    });
}
