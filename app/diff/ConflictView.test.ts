import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { ConflictBlocks } from "../messages/ConflictBlocks";
import { setupMocks, cleanupMocks } from "../mocks";

let id = {
    change: { type: "ChangeId" as const, hex: "aaaa", prefix: "aa", rest: "aa", offset: null, is_divergent: false },
    commit: { type: "CommitId" as const, hex: "bbbb", prefix: "bb", rest: "bb" },
};

let header = {
    id,
    description: { lines: [] },
    author: { email: "", name: "", timestamp: "" },
    has_conflict: true,
    is_working_copy: false,
    working_copy_of: null,
    is_immutable: false,
    refs: [],
    parent_ids: [],
} as any;

let path = { repo_path: "b.txt", relative_path: "b.txt" };

let blocks: ConflictBlocks = {
    regions: [
        { type: "Resolved", lines: Array.from({ length: 12 }, (_, i) => `top ${i + 1}`) },
        {
            type: "Conflict",
            sides: [
                { label: "ours", lines: ["mine"] },
                { label: "theirs", lines: ["yours"] },
            ],
            bases: [{ label: "base", lines: ["original"] }],
        },
        { type: "Resolved", lines: ["bottom"] },
    ],
};

async function setMergeTool(has: boolean) {
    let { repoConfigEvent } = await import("../stores");
    repoConfigEvent.set({ type: "Workspace", has_external_merge_tool: has } as any);
}

describe("ConflictView", () => {
    let calls: { cmd: string; args: any }[];

    let ConflictView: any;

    beforeEach(async () => {
        calls = [];
        setupMocks((cmd, args: any) => {
            calls.push({ cmd, args });
            return { type: "Unchanged" };
        });
        await setMergeTool(false);
        ConflictView = (await import("./ConflictView.svelte")).default;
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("labels side and base blocks in jj order", () => {
        let { container } = render(ConflictView, { props: { blocks, path, header } });
        let labels = Array.from(container.querySelectorAll(".block .label")).map((el) => el.textContent?.trim());
        expect(labels).toEqual(["◆ ours", "◇ base", "◆ theirs"]);
        expect(container.querySelector(".block.base .line")?.textContent).toBe("original");
    });

    it("folds long resolved stretches and keeps the edge near the conflict", async () => {
        let { container, getByText } = render(ConflictView, { props: { blocks, path, header } });
        let resolved = () => Array.from(container.querySelectorAll(".conflict-view > .line")).map((el) => el.textContent);
        expect(resolved()).toEqual(["top 10", "top 11", "top 12", "bottom"]);
        await fireEvent.click(getByText(/9 resolved lines/));
        expect(resolved()).toHaveLength(13);
    });

    it("accepts a side", async () => {
        let { getByText } = render(ConflictView, { props: { blocks, path, header } });
        await fireEvent.click(getByText("Accept theirs"));
        await vi.waitFor(() =>
            expect(calls.find((c) => c.cmd == "resolve_conflict_side")?.args.mutation).toMatchObject({ id, path, side: 1 }),
        );
    });

    it("offers the merge tool only when configured", async () => {
        let { queryByText, getByText } = render(ConflictView, { props: { blocks, path, header } });
        expect(queryByText("Open in merge tool")).toBeNull();
        await setMergeTool(true);
        await tick();
        await fireEvent.click(getByText("Open in merge tool"));
        await vi.waitFor(() =>
            expect(calls.find((c) => c.cmd == "external_resolve")?.args.mutation).toMatchObject({ id, path }),
        );
    });

    it("hides actions without a single revision", () => {
        let { queryByText } = render(ConflictView, { props: { blocks, path, header: null } });
        expect(queryByText("Accept ours")).toBeNull();
    });
});
