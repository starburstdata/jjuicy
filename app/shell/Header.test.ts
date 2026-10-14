import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import type { RepoConfig } from "../messages/RepoConfig";
import { setupMocks, cleanupMocks } from "../mocks";

let calls: { cmd: string; args: Record<string, unknown> }[] = [];

function workspace(remotes: string[], name = "default"): RepoConfig {
    return {
        type: "Workspace",
        absolute_path: "/home/user/src/myrepo",
        workspace_name: name,
        git_remotes: remotes,
        query_choices: {},
        latest_query: "all()",
        status: {
            operation_description: "initial",
            working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0".repeat(33) },
        },
        mark_unpushed_bookmarks: false,
        track_recent_workspaces: true,
        ignore_immutable: false,
        has_external_diff_tool: false,
        has_external_merge_tool: false,
    };
}

describe("Header", () => {
    beforeAll(() => {
        setupMocks((cmd, args) => {
            calls.push({ cmd, args });
            if (cmd === "query_recent_workspaces") {
                return ["/home/user/src/myrepo", "/home/user/src/other"];
            }
            if (cmd === "mutate") {
                return { type: "Unchanged" };
            }
            return undefined;
        });
    });

    afterAll(async () => {
        await cleanupMocks();
    });

    beforeEach(() => {
        cleanup();
        calls = [];
    });

    it("shows the repo breadcrumb and hides the default workspace name", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { container } = render(Header, { props: { config: workspace(["origin"]) } });
        expect(container.querySelector(".breadcrumb")?.textContent).toContain("myrepo");
        expect(container.querySelector(".crumb")).toBeNull();
    });

    it("shows a non-default workspace name", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { container } = render(Header, { props: { config: workspace(["origin"], "second") } });
        expect(container.querySelector(".crumb")?.textContent).toBe("second");
    });

    it("hides fetch and push without remotes", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { queryByText } = render(Header, { props: { config: workspace([]) } });
        expect(queryByText("Push")).toBeNull();
        expect(queryByText("Fetch")).toBeNull();
    });

    it("pushes to origin by default", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { getByText } = render(Header, { props: { config: workspace(["upstream", "origin"]) } });
        await fireEvent.click(getByText("Push"));
        await waitFor(() => {
            let push = calls.find((c) => c.cmd === "git_push");
            expect((push?.args as any)?.mutation.refspec.remote_name).toBe("origin");
        });
    });

    it("toggles the sidebar", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { sidebarCollapsed } = await import("../stores");
        sidebarCollapsed.set(false);
        let { getByTitle } = render(Header, { props: { config: workspace([]) } });
        await fireEvent.click(getByTitle("Hide sidebar"));
        expect(get(sidebarCollapsed)).toBe(true);
    });

    it("lists other recent workspaces in the breadcrumb menu", async () => {
        let { default: Header } = await import("./Header.svelte");
        let { getByTitle, findByText, queryByText } = render(Header, { props: { config: workspace([]) } });
        await fireEvent.click(getByTitle("/home/user/src/myrepo"));
        await findByText("/home/user/src/other");
        expect(queryByText("Recent")).not.toBeNull();
    });
});
