import type { DiffRow } from "../messages/DiffRow";

export interface RowPair {
    left: DiffRow | null;
    right: DiffRow | null;
}

// a run of removals is aligned with the run of additions that immediately follows it;
// the shorter side is padded so unchanged lines stay level across both columns
export function pairRows(rows: DiffRow[]): RowPair[] {
    let pairs: RowPair[] = [];
    let removed: DiffRow[] = [];
    let added: DiffRow[] = [];

    function flush() {
        let n = Math.max(removed.length, added.length);
        for (let i = 0; i < n; i++) {
            pairs.push({ left: removed[i] ?? null, right: added[i] ?? null });
        }
        removed = [];
        added = [];
    }

    for (let row of rows) {
        switch (row.kind) {
            case "Removed":
                // removals after additions start a new run
                if (added.length > 0) flush();
                removed.push(row);
                break;
            case "Added":
                added.push(row);
                break;
            default:
                flush();
                pairs.push({ left: row, right: row });
        }
    }
    flush();
    return pairs;
}
