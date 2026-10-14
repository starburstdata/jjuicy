import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import type { RepoSummary } from "../messages/RepoSummary";
import { setupMocks, cleanupMocks } from "../mocks";
import { logQueryRequest, repoConfigEvent, repoStatusEvent } from "../stores";
import { formatCount } from "./statusbar";

let calls: { cmd: string; args: Record<string, unknown> }[] = [];

function status(summary: RepoSummary | null) {
    repoStatusEvent.set({
        operation_description: "snapshot working copy",
        working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0".repeat(33) },
        summary,
    });
}

describe("formatCount", () => {
    it("caps at the backend count limit", () => {
        expect(formatCount(0)).toBe("0");
        expect(formatCount(99)).toBe("99");
        expect(formatCount(100)).toBe("99+");
    });
});

describe("StatusBar", () => {
    beforeAll(() => {
        setupMocks((cmd, args) => {
            calls.push({ cmd, args });
            if (cmd === "undo_operation") {
                return { type: "Unchanged" };
            }
            return undefined;
        });
        repoConfigEvent.set({
            type: "Workspace",
            absolute_path: "/home/user/src/myrepo",
            workspace_name: "default",
            git_remotes: [],
            query_choices: {},
            latest_query: "all()",
            status: {
                operation_description: "initial",
                working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0".repeat(33) },
                summary: null,
            },
            mark_unpushed_bookmarks: false,
            track_recent_workspaces: true,
            ignore_immutable: false,
            has_external_diff_tool: false,
            has_external_merge_tool: false,
        } as any);
    });

    afterAll(async () => {
        await cleanupMocks();
    });

    beforeEach(() => {
        cleanup();
        calls = [];
        logQueryRequest.set(null);
    });

    it("shows the latest operation", async () => {
        status(null);
        let { default: StatusBar } = await import("./StatusBar.svelte");
        let { container } = render(StatusBar, { props: { target: false } });
        expect(container.querySelector(".operation")?.textContent?.trim()).toBe("snapshot working copy");
        expect(container.querySelector(".counter")).toBeNull();
    });

    it("hides zero counters", async () => {
        status({ wc_files: 2, wc_added: 5, wc_removed: 0, conflicted: 0, divergent: 0 });
        let { default: StatusBar } = await import("./StatusBar.svelte");
        let { container, queryByText } = render(StatusBar, { props: { target: false } });
        expect(container.querySelector(".added")?.textContent).toBe("+5");
        expect(container.querySelector(".removed")).toBeNull();
        expect(queryByText(/divergent/)).toBeNull();
        expect(queryByText(/conflicted/)).toBeNull();
    });

    it("filters the log when a counter is clicked", async () => {
        status({ wc_files: 1, wc_added: 1, wc_removed: 1, conflicted: 120, divergent: 1 });
        let { default: StatusBar } = await import("./StatusBar.svelte");
        let { getByText } = render(StatusBar, { props: { target: false } });
        await fireEvent.click(getByText("99+ conflicted"));
        expect(get(logQueryRequest)).toBe("conflicts()");
        await fireEvent.click(getByText("1 divergent"));
        expect(get(logQueryRequest)).toBe("divergent()");
        await fireEvent.click(getByText("1 file"));
        expect(get(logQueryRequest)).toBe("@");
    });

    it("undoes the latest operation", async () => {
        status(null);
        let { default: StatusBar } = await import("./StatusBar.svelte");
        let { getByTitle } = render(StatusBar, { props: { target: false } });
        await fireEvent.click(getByTitle("Undo latest operation"));
        await waitFor(() => expect(calls.some((c) => c.cmd === "undo_operation")).toBe(true));
    });
});
