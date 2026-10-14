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
