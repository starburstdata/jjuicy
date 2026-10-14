import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import type { RevsResult } from "../messages/RevsResult";
import type { RevChangeSummary } from "../messages/RevChangeSummary";
import type { ChangeKind } from "../messages/ChangeKind";
import { setupMocks, cleanupMocks } from "../mocks";
import { fuzzyMatch, mergeChanges, resolveSelection, toEntry, treeRows } from "./files";

function mkChange(path: string, kind: ChangeKind = "Modified", added = 1, removed = 1): RevChangeSummary {
    return {
        kind,
        path: { repo_path: path, relative_path: path },
        old_path: null,
        has_conflict: false,
        added,
        removed,
        binary: false,
    };
}

function mkRevs(hex: string, changes: RevChangeSummary[]): Extract<RevsResult, { type: "Detail" }> {
    let id = {
        change: { type: "ChangeId" as const, hex, prefix: hex.slice(0, 3), rest: hex.slice(3), offset: null, is_divergent: false },
        commit: { type: "CommitId" as const, hex, prefix: hex.slice(0, 4), rest: hex.slice(4) },
    };
    return {
        type: "Detail",
        set: { from: id, to: id },
        headers: [
            {
                id,
                description: { lines: ["msg"] },
                author: { email: "t@example.com", name: "T", timestamp: "2024-01-15T12:00:00Z" },
                has_conflict: false,
                is_working_copy: false,
                working_copy_of: null,
                is_immutable: false,
                refs: [],
                parent_ids: [],
            },
        ],
        parents: [],
        changes,
        conflicts: [],
    };
}

describe("files", () => {
    it("sorts conflicts first, then by path", () => {
        let merged = mergeChanges(
            [mkChange("b.txt"), mkChange("a.txt")],
            [{ path: { repo_path: "z.txt", relative_path: "z.txt" } }],
        );
        expect(merged.map((c) => c.path.repo_path)).toEqual(["z.txt", "a.txt", "b.txt"]);
        expect(merged[0].has_conflict).toBe(true);
    });

    it("carries added and removed counts", () => {
        let entry = toEntry(mkChange("src/x.rs", "Modified", 2, 1));
        expect(entry).toMatchObject({ name: "x.rs", dir: "src", added: 2, removed: 1 });
    });

    it("matches fuzzy subsequences case-insensitively", () => {
        expect(fuzzyMatch("", "anything")).toBe(true);
        expect(fuzzyMatch("smr", "src/main.rs")).toBe(true);
        expect(fuzzyMatch("SMR", "src/main.rs")).toBe(true);
        expect(fuzzyMatch("mz", "src/main.rs")).toBe(false);
    });

    it("groups the tree by directory with summed counts", () => {
        let entries = [mkChange("src/a/x.rs"), mkChange("src/b.rs"), mkChange("top.txt")].map(toEntry);
        let rows = treeRows(entries, new Set());
        expect(rows.map((r) => (r.type == "dir" ? `d:${r.path}:${r.depth}` : `f:${r.entry.name}:${r.depth}`))).toEqual([
            "d:src:0",
            "d:src/a:1",
            "f:x.rs:2",
            "f:b.rs:1",
            "f:top.txt:0",
        ]);
        expect(rows[0]).toMatchObject({ added: 2, removed: 2 });
    });

    it("hides the children of collapsed folders", () => {
        let entries = [mkChange("src/a/x.rs"), mkChange("src/b.rs")].map(toEntry);
        let rows = treeRows(entries, new Set(["src"]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ type: "dir", collapsed: true });
    });

    it("keeps the selected path only while it exists", () => {
        expect(resolveSelection({ path: "b" }, ["a", "b"])).toBe("b");
        expect(resolveSelection({ path: "c" }, ["a", "b"])).toBe("a");
        expect(resolveSelection({ path: null }, ["a", "b"])).toBe(null);
        expect(resolveSelection(null, [])).toBe(null);
    });
});

describe("FilesPane", () => {
    beforeEach(() => {
        setupMocks();
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("shows a file count and keeps the selection across a revision change", async () => {
        let { default: FilesPane } = await import("./FilesPane.svelte");
        let { selectedFile } = await import("../stores");
        selectedFile.set(null);

        let { container, rerender } = render(FilesPane, {
            props: { revs: mkRevs("aaaaaaaa", [mkChange("a.txt"), mkChange("b.txt")]) },
        });
        expect(container.textContent).toContain("2 files");
        expect(container.querySelector("[aria-selected=true]")?.textContent).toContain("a.txt");

        let b = [...container.querySelectorAll("button")].find((el) => el.textContent?.includes("b.txt"))!;
        await fireEvent.click(b);
        expect(get(selectedFile)).toEqual({ path: "b.txt" });

        await rerender({ revs: mkRevs("bbbbbbbb", [mkChange("b.txt"), mkChange("c.txt")]) });
        await tick();
        expect(container.querySelector("[aria-selected=true]")?.textContent).toContain("b.txt");

        await rerender({ revs: mkRevs("cccccccc", [mkChange("c.txt")]) });
        await tick();
        expect(container.querySelector("[aria-selected=true]")?.textContent).toContain("c.txt");
    });

    it("filters rows", async () => {
        let { default: FilesPane } = await import("./FilesPane.svelte");
        let { container } = render(FilesPane, {
            props: { revs: mkRevs("aaaaaaaa", [mkChange("src/main.rs"), mkChange("readme.md")]) },
        });
        await fireEvent.click(container.querySelector("button[title='filter files']")!);
        let input = container.querySelector("input.filter") as HTMLInputElement;
        await fireEvent.input(input, { target: { value: "smr" } });
        expect(container.textContent).toContain("main.rs");
        expect(container.textContent).not.toContain("readme.md");
    });
});
