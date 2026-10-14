import type { FileDiffHunk } from "../messages/FileDiffHunk";

// unchanged lines hidden around hunks, in new-side line numbers (1-based, inclusive).
// offset converts a new-side line number to the old side.
export interface Gap {
    start: number;
    end: number;
    offset: number;
}

// gaps[i] precedes hunks[i]; gaps[hunks.length] trails the last hunk.
// hunk starts are the first line position on each side, even for empty ranges.
export function computeGaps(hunks: FileDiffHunk[], newLineCount: number): (Gap | null)[] {
    let gaps: (Gap | null)[] = [];
    let nextNew = 1;
    let nextOld = 1;
    for (let hunk of hunks) {
        let { from_file, to_file } = hunk.header.location;
        gaps.push(to_file.start > nextNew ? { start: nextNew, end: to_file.start - 1, offset: nextOld - nextNew } : null);
        nextNew = to_file.start + to_file.len;
        nextOld = from_file.start + from_file.len;
    }
    let trailing = hunks.length > 0 && newLineCount >= nextNew;
    gaps.push(trailing ? { start: nextNew, end: newLineCount, offset: nextOld - nextNew } : null);
    return gaps;
}
