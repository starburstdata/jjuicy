import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import type { FileDiff } from "../messages/FileDiff";
import type { RevChangeSummary } from "../messages/RevChangeSummary";
import { setupMocks, cleanupMocks } from "../mocks";
import { diffCache } from "./cache";
import { diffMode } from "../stores";

function mkId(hex: string) {
    return {
        change: { type: "ChangeId" as const, hex, prefix: hex.slice(0, 3), rest: hex.slice(3), offset: null, is_divergent: false },
        commit: { type: "CommitId" as const, hex, prefix: hex.slice(0, 4), rest: hex.slice(4) },
    };
}

let set = { from: mkId("aaaa1111"), to: mkId("aaaa1111") };

let change: RevChangeSummary = {
    kind: "Modified",
    path: { repo_path: "src/a.txt", relative_path: "src/a.txt" },
    old_path: null,
    has_conflict: false,
    added: 1,
    removed: 1,
    binary: false,
};

// line 50 of 100 changed, so there are gaps above and below
function mkDiff(): FileDiff {
    return {
        path: change.path,
        old_path: null,
        kind: { type: "Text" },
        hunks: [
            {
                header: {
                    location: { from_file: { start: 50, len: 1 }, to_file: { start: 50, len: 1 } },
                    lines: { lines: ["-old value", "+new value"] },
                },
                rows: [
                    { kind: "Removed", old_line: 50, new_line: null, text: "old value", tokens: [{ start: 0, end: 3 }] },
                    { kind: "Added", old_line: null, new_line: 50, text: "new value", tokens: [{ start: 0, end: 3 }] },
                ],
            },
        ],
        conflict: null,
        old_line_count: 100,
        new_line_count: 100,
    };
}

describe("DiffViewer", () => {
    let calls: { cmd: string; args: any }[];

    beforeEach(() => {
        localStorage.clear();
        diffCache.clear();
        diffMode.set("unified");
        calls = [];
        setupMocks((cmd, args: any) => {
            calls.push({ cmd, args });
            if (cmd == "query_file_diff") return mkDiff();
            if (cmd == "query_file_lines") {
                let out = [];
                for (let n = args.start; n <= args.end; n++) out.push(`line ${n}`);
                return out;
            }
            return { type: "Unchanged" };
        });
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("renders gutters and word-level highlights", async () => {
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let { container } = render(DiffViewer, { props: { set, change, header: null } });

        await vi.waitFor(() => expect(container.querySelector(".add")).not.toBeNull());
        let add = container.querySelector(".add")!;
        expect(Array.from(add.querySelectorAll(".gutter")).map((g) => g.textContent)).toEqual(["", "50"]);
        expect(add.querySelector(".word")?.textContent).toBe("new");
        expect(container.querySelector(".remove .word")?.textContent).toBe("old");
    });

    it("shows collapsed context and expands it", async () => {
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let { container, getByText } = render(DiffViewer, { props: { set, change, header: null } });

        await vi.waitFor(() => expect(container.textContent).toContain("49 unchanged lines"));
        expect(container.textContent).toContain("50 unchanged lines");

        await fireEvent.click(getByText(/49 unchanged lines/));
        await vi.waitFor(() => expect(container.textContent).not.toContain("49 unchanged lines"));
        let request = calls.find((c) => c.cmd == "query_file_lines")!.args;
        expect(request).toMatchObject({ side: "New", start: 1, end: 49 });
        expect(container.textContent).toContain("line 49");
    });

    it("expands a trailing gap by a step", async () => {
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let { container } = render(DiffViewer, { props: { set, change, header: null } });

        await vi.waitFor(() => expect(container.textContent).toContain("50 unchanged lines"));
        let separators = container.querySelectorAll(".separator");
        let trailing = separators[separators.length - 1];
        await fireEvent.click(trailing.querySelector('button[title="show 20 more lines"]')!);
        await vi.waitFor(() => expect(container.textContent).toContain("30 unchanged lines"));
        expect(container.textContent).toContain("line 70");
    });

    it("pairs rows in split mode", async () => {
        diffMode.set("split");
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let { container } = render(DiffViewer, { props: { set, change, header: null } });

        await vi.waitFor(() => expect(container.querySelector(".diff.split")).not.toBeNull());
        let row = container.querySelector(".side.remove")!.parentElement!;
        expect(row.querySelector(".side.add")?.textContent).toContain("new value");
    });

    it("caches diffs by commit and path", async () => {
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let first = render(DiffViewer, { props: { set, change, header: null } });
        await vi.waitFor(() => expect(first.container.querySelector(".add")).not.toBeNull());
        first.unmount();

        let second = render(DiffViewer, { props: { set, change, header: null } });
        await vi.waitFor(() => expect(second.container.querySelector(".add")).not.toBeNull());
        expect(calls.filter((c) => c.cmd == "query_file_diff").length).toBe(1);
    });

    it("virtualizes long diffs", async () => {
        let rows = [];
        for (let n = 1; n <= 5000; n++) rows.push({ kind: "Added" as const, old_line: null, new_line: n, text: `l${n}`, tokens: [] });
        setupMocks((cmd) =>
            cmd == "query_file_diff"
                ? {
                      ...mkDiff(),
                      hunks: [
                          {
                              header: { location: { from_file: { start: 1, len: 0 }, to_file: { start: 1, len: 5000 } }, lines: { lines: [] } },
                              rows,
                          },
                      ],
                      old_line_count: 0,
                      new_line_count: 5000,
                  }
                : { type: "Unchanged" },
        );
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let { container } = render(DiffViewer, { props: { set, change, header: null } });

        await vi.waitFor(() => expect(container.querySelector(".add")).not.toBeNull());
        expect(container.querySelectorAll(".add").length).toBeLessThan(500);
    });

    it("defers lazy diffs until scrolled near", async () => {
        let { default: DiffViewer } = await import("./DiffViewer.svelte");
        let scroller = document.createElement("div");
        scroller.style.cssText = "height: 200px; overflow-y: auto";
        let spacer = document.createElement("div");
        spacer.style.height = "5000px";
        let target = document.createElement("div");
        scroller.append(spacer, target);
        document.body.append(scroller);
        try {
            render(DiffViewer, { target, props: { set, change, header: null, lazy: true } });
            await new Promise((r) => setTimeout(r, 50));
            expect(calls.filter((c) => c.cmd == "query_file_diff")).toHaveLength(0);

            scroller.scrollTop = 5000;
            await vi.waitFor(() => expect(calls.filter((c) => c.cmd == "query_file_diff")).toHaveLength(1));
        } finally {
            scroller.remove();
        }
    });
});

describe("FileHeader", () => {
    beforeEach(() => {
        localStorage.clear();
        diffMode.set("unified");
        setupMocks(() => ({ type: "Unchanged" }));
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("shows the path, counts and persists the diff mode", async () => {
        let { default: FileHeader } = await import("./FileHeader.svelte");
        let { container, getByTitle } = render(FileHeader, { props: { change, header: null } });

        expect(container.querySelector(".dir")?.textContent).toBe("src/");
        expect(container.querySelector(".name")?.textContent).toBe("a.txt");
        expect(container.querySelector(".added")?.textContent).toBe("+1");
        expect(getByTitle("unified diff").getAttribute("aria-pressed")).toBe("true");

        await fireEvent.click(getByTitle("split diff"));
        expect(get(diffMode)).toBe("split");
        expect(JSON.parse(localStorage.getItem("jjuicy.diffMode")!)).toBe("split");
        expect(getByTitle("split diff").getAttribute("aria-pressed")).toBe("true");
    });

    it("shows the old path of a rename", async () => {
        let { default: FileHeader } = await import("./FileHeader.svelte");
        let { container } = render(FileHeader, {
            props: { change: { ...change, old_path: { repo_path: "b.txt", relative_path: "b.txt" } }, header: null },
        });
        expect(container.textContent).toContain("b.txt →");
    });
});
