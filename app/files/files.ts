import type { RevChange } from "../messages/RevChange";
import type { RevConflict } from "../messages/RevConflict";

export interface FileEntry {
    change: RevChange;
    name: string;
    dir: string;
    added: number;
    removed: number;
}

export type FileRow =
    | { type: "dir"; path: string; name: string; depth: number; added: number; removed: number; collapsed: boolean }
    | { type: "file"; entry: FileEntry; depth: number };

// path null means "all files"
export interface FileSelection {
    path: string | null;
}

// unresolved conflicts don't appear in the diff, so they become pseudo-changes
export function mergeChanges(changes: RevChange[], conflicts: RevConflict[]): RevChange[] {
    let merged = changes.concat(
        conflicts.map((conflict) => ({
            kind: "None",
            path: conflict.path,
            has_conflict: true,
            hunks: conflict.hunks,
        })),
    );
    return merged.sort(compareChanges);
}

export function compareChanges(a: RevChange, b: RevChange): number {
    if (a.has_conflict != b.has_conflict) return a.has_conflict ? -1 : 1;
    return a.path.relative_path.localeCompare(b.path.relative_path);
}

export function splitPath(p: string): [string, string] {
    let sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return sep >= 0 ? [p.slice(0, sep), p.slice(sep + 1)] : ["", p];
}

export function toEntry(change: RevChange): FileEntry {
    let [dir, name] = splitPath(change.path.relative_path);
    let added = 0;
    let removed = 0;
    // conflict hunks are materialised file content, not a diff
    if (!change.has_conflict || change.kind != "None") {
        for (let hunk of change.hunks) {
            for (let line of hunk.lines.lines) {
                if (line.startsWith("+")) added++;
                else if (line.startsWith("-")) removed++;
            }
        }
    }
    return { change, name, dir, added, removed };
}

export function badge(change: RevChange): { symbol: string; state: "add" | "change" | "remove" | "conflict" } {
    if (change.has_conflict) return { symbol: "!", state: "conflict" };
    switch (change.kind) {
        case "Added":
            return { symbol: "+", state: "add" };
        case "Deleted":
            return { symbol: "−", state: "remove" };
        default:
            return { symbol: "~", state: "change" };
    }
}

// subsequence match, case-insensitive; an empty query matches everything
export function fuzzyMatch(query: string, text: string): boolean {
    let q = query.trim().toLowerCase();
    if (q == "") return true;
    let t = text.toLowerCase();
    let i = 0;
    for (let c of t) {
        if (c == q[i]) i++;
        if (i == q.length) return true;
    }
    return false;
}

export function listRows(entries: FileEntry[]): FileRow[] {
    return entries.map((entry) => ({ type: "file", entry, depth: 0 }));
}

interface DirNode {
    name: string;
    path: string;
    dirs: Map<string, DirNode>;
    files: FileEntry[];
    added: number;
    removed: number;
}

// tree segments come from repo_path, which always uses forward slashes
export function treeRows(entries: FileEntry[], collapsed: Set<string>): FileRow[] {
    let root: DirNode = { name: "", path: "", dirs: new Map(), files: [], added: 0, removed: 0 };
    for (let entry of entries) {
        let segments = entry.change.path.repo_path.split("/");
        segments.pop();
        let node = root;
        for (let segment of segments) {
            let path = node.path ? `${node.path}/${segment}` : segment;
            let child = node.dirs.get(segment);
            if (!child) {
                child = { name: segment, path, dirs: new Map(), files: [], added: 0, removed: 0 };
                node.dirs.set(segment, child);
            }
            child.added += entry.added;
            child.removed += entry.removed;
            node = child;
        }
        node.files.push(entry);
    }

    let rows: FileRow[] = [];
    function walk(node: DirNode, depth: number) {
        let dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
        for (let dir of dirs) {
            let isCollapsed = collapsed.has(dir.path);
            rows.push({
                type: "dir",
                path: dir.path,
                name: dir.name,
                depth,
                added: dir.added,
                removed: dir.removed,
                collapsed: isCollapsed,
            });
            if (!isCollapsed) walk(dir, depth + 1);
        }
        for (let entry of [...node.files].sort((a, b) => compareChanges(a.change, b.change))) {
            rows.push({ type: "file", entry, depth });
        }
    }
    walk(root, 0);
    return rows;
}

// keeps the stored choice across a set change when it still applies, else falls back to the first file
export function resolveSelection(stored: FileSelection | null, paths: string[]): string | null {
    if (stored) {
        if (stored.path == null) return null;
        if (paths.includes(stored.path)) return stored.path;
    }
    return paths[0] ?? null;
}
