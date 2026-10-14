import type { BookmarkEntry } from "../messages/BookmarkEntry";
import type { RemoteBookmarkState } from "../messages/RemoteBookmarkState";
import type { RevHeader } from "../messages/RevHeader";
import type { StoreRef } from "../messages/StoreRef";
import { formatCount } from "../shell/statusbar";

export type BookmarkRef = Extract<StoreRef, { type: "LocalBookmark" | "RemoteBookmark" }>;
export type BookmarkGroup = "local" | "tracked" | "untracked";

export interface Badge {
    text: string;
    tip: string;
    kind: "ahead" | "behind" | "diverged" | "absent" | "conflict";
}

export interface BookmarkRow {
    key: string;
    label: string;
    header: RevHeader | null;
    ref: BookmarkRef;
    badges: Badge[];
}

export const GROUP_TITLES: Record<BookmarkGroup, string> = {
    local: "Local",
    tracked: "Tracked remote",
    untracked: "Untracked remote",
};

// the headers already carry fully-populated refs; reuse them so drag and context menus
// see the same state as the chips on log cards
export function localRef(entry: BookmarkEntry): BookmarkRef {
    let found = entry.target?.refs.find(r => r.type == "LocalBookmark" && r.bookmark_name == entry.name);
    if (found?.type == "LocalBookmark") return found;
    return {
        type: "LocalBookmark",
        bookmark_name: entry.name,
        has_conflict: entry.has_conflict,
        is_synced: false,
        tracking_remotes: entry.remotes.filter(r => r.tracked).map(r => r.remote),
        available_remotes: entry.remotes.length,
        potential_remotes: 0,
    };
}

export function remoteRef(entry: BookmarkEntry, remote: RemoteBookmarkState): BookmarkRef {
    let found = remote.target?.refs.find(
        r => r.type == "RemoteBookmark" && r.bookmark_name == entry.name && r.remote_name == remote.remote,
    );
    if (found?.type == "RemoteBookmark") return found;
    return {
        type: "RemoteBookmark",
        bookmark_name: entry.name,
        remote_name: remote.remote,
        has_conflict: false,
        is_synced: false,
        is_tracked: remote.tracked,
        is_absent: remote.absent,
    };
}

export function syncBadges(entry: BookmarkEntry): Badge[] {
    let badges: Badge[] = [];
    if (entry.has_conflict) {
        badges.push({ text: "conflict", tip: "bookmark target is conflicted", kind: "conflict" });
    }
    for (let r of entry.remotes) {
        if (!r.tracked || r.ahead === null || r.behind === null) continue;
        let at = `${entry.name}@${r.remote}`;
        if (r.ahead > 0 && r.behind > 0) {
            badges.push({
                text: `↑${formatCount(r.ahead)} ↓${formatCount(r.behind)}`,
                tip: `diverged from ${at}`,
                kind: "diverged",
            });
        } else if (r.ahead > 0) {
            badges.push({ text: `↑${formatCount(r.ahead)}`, tip: `${formatCount(r.ahead)} ahead of ${at}`, kind: "ahead" });
        } else if (r.behind > 0) {
            badges.push({ text: `↓${formatCount(r.behind)}`, tip: `${formatCount(r.behind)} behind ${at}`, kind: "behind" });
        }
    }
    return badges;
}

export function groupBookmarks(entries: BookmarkEntry[]): Record<BookmarkGroup, BookmarkRow[]> {
    let groups: Record<BookmarkGroup, BookmarkRow[]> = { local: [], tracked: [], untracked: [] };
    for (let entry of entries) {
        if (entry.target) {
            groups.local.push({
                key: entry.name,
                label: entry.name,
                header: entry.target,
                ref: localRef(entry),
                badges: syncBadges(entry),
            });
        }
        for (let remote of entry.remotes) {
            let badges: Badge[] = remote.absent
                ? [{ text: "absent", tip: "deleted locally; push to delete it on the remote", kind: "absent" }]
                : [];
            (remote.tracked ? groups.tracked : groups.untracked).push({
                key: `${entry.name}@${remote.remote}`,
                label: `${entry.name}@${remote.remote}`,
                header: remote.target,
                ref: remoteRef(entry, remote),
                badges,
            });
        }
    }
    return groups;
}

export function localCount(entries: BookmarkEntry[]): number {
    return entries.filter(e => e.target).length;
}

export function mergedTargets(entries: BookmarkEntry[]): BookmarkRef[] {
    return entries.filter(e => e.is_merged && e.target).map(localRef);
}

export function absentTargets(entries: BookmarkEntry[]): BookmarkRef[] {
    return entries.flatMap(e => e.remotes.filter(r => r.absent).map(r => remoteRef(e, r)));
}

export function refLabel(ref: BookmarkRef): string {
    return ref.type == "LocalBookmark" ? ref.bookmark_name : `${ref.bookmark_name}@${ref.remote_name}`;
}

// widen rather than replace the revset, so the user keeps their context
export function withRevision(revset: string, hex: string): string {
    let current = revset.trim();
    return current == "" ? hex : `(${current}) | ${hex}`;
}
