import type { BookmarkEntry } from "../messages/BookmarkEntry";
import type { RevHeader } from "../messages/RevHeader";

export function mkHeader(hex: string): RevHeader {
    return {
        id: {
            change: { type: "ChangeId", hex: hex.repeat(2), prefix: hex.slice(0, 4), rest: hex.slice(4), offset: null, is_divergent: false },
            commit: { type: "CommitId", hex, prefix: hex.slice(0, 4), rest: hex.slice(4) },
        },
        description: { lines: [hex] },
        author: { email: "a@example.com", name: "A", timestamp: "2024-01-15T12:00:00Z" },
        has_conflict: false,
        is_working_copy: false,
        working_copy_of: null,
        is_immutable: false,
        refs: [],
        parent_ids: [],
    };
}

export const ENTRIES: BookmarkEntry[] = [
    {
        name: "feature",
        target: mkHeader("aaaa1111"),
        has_conflict: false,
        is_merged: false,
        remotes: [
            { remote: "origin", target: mkHeader("bbbb2222"), tracked: true, absent: false, ahead: 2, behind: 0 },
        ],
    },
    {
        name: "landed",
        target: mkHeader("cccc3333"),
        has_conflict: false,
        is_merged: true,
        remotes: [],
    },
    {
        name: "gone",
        target: null,
        has_conflict: false,
        is_merged: false,
        remotes: [{ remote: "origin", target: mkHeader("dddd4444"), tracked: true, absent: true, ahead: null, behind: null }],
    },
    {
        name: "theirs",
        target: null,
        has_conflict: false,
        is_merged: false,
        remotes: [{ remote: "upstream", target: mkHeader("eeee5555"), tracked: false, absent: false, ahead: null, behind: null }],
    },
    {
        name: "busy",
        target: mkHeader("ffff6666"),
        has_conflict: true,
        is_merged: false,
        remotes: [{ remote: "origin", target: mkHeader("abab7777"), tracked: true, absent: false, ahead: 150, behind: 3 }],
    },
];
