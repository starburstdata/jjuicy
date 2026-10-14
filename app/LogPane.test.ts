import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, waitFor, cleanup, fireEvent } from "@testing-library/svelte";
import type { LogPage } from "./messages/LogPage";
import { setupMocks, cleanupMocks } from "./mocks";

let revsets: string[] = [];

const choices = { default: "all()", mine: "mine()" };

describe("LogPane", () => {
    beforeAll(() => {
        setupMocks((cmd, args) => {
            if (cmd === "query_log") {
                let revset = (args as { revset: string }).revset;
                revsets.push(revset);
                if (revset === "bad(") {
                    throw "Failed to parse revset: Syntax error";
                }
                let emptyPage: LogPage = { rows: [], has_more: false };
                return emptyPage;
            }
            return undefined;
        });
    });

    afterAll(async () => {
        await cleanupMocks();
    });

    beforeEach(() => {
        cleanup();
        localStorage.clear();
        revsets = [];
    });

    it("renders loading state", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");

        let { container } = render(LogPane, {
            props: {
                query_choices: choices,
                latest_query: "all()",
            },
        });

        expect(container.textContent).toContain("Loading");
    });

    it("renders empty log with mocked IPC", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");
        let { repoStatusEvent } = await import("./stores");

        let { container } = render(LogPane, {
            props: {
                query_choices: choices,
                latest_query: "all()",
            },
        });

        repoStatusEvent.set({
            operation_description: "initial",
            working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0000000000000000000000000000000" },
            summary: null,
        });

        await waitFor(() => {
            expect(container.textContent).not.toContain("Loading");
        });
    });

    it("sets the input when a preset is chosen", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");
        let { container } = render(LogPane, { props: { query_choices: choices, latest_query: "all()" } });

        let select = container.querySelector("select")!;
        select.value = "mine()";
        await fireEvent.change(select);

        expect(container.querySelector("textarea")!.value).toBe("mine()");
        await waitFor(() => expect(revsets).toContain("mine()"));
    });

    it("queries on enter but not shift+enter", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");
        let { container } = render(LogPane, { props: { query_choices: choices, latest_query: "all()" } });

        let textarea = container.querySelector("textarea")!;
        await fireEvent.input(textarea, { target: { value: "@-" } });
        await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
        expect(revsets).not.toContain("@-");

        await fireEvent.keyDown(textarea, { key: "Enter" });
        await waitFor(() => expect(revsets).toContain("@-"));
        expect(container.textContent).toContain("Save");
    });

    it("shows revset errors inline", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");
        let { container, findByRole } = render(LogPane, { props: { query_choices: choices, latest_query: "all()" } });

        let textarea = container.querySelector("textarea")!;
        await fireEvent.input(textarea, { target: { value: "bad(" } });
        await fireEvent.keyDown(textarea, { key: "Enter" });

        let alert = await findByRole("alert");
        expect(alert.textContent).toContain("Syntax error");

        await fireEvent.input(textarea, { target: { value: "all()" } });
        await fireEvent.keyDown(textarea, { key: "Enter" });
        await waitFor(() => expect(container.querySelector("[role=alert]")).toBeNull());
    });

    it("persists the collapsed state", async () => {
        let { default: LogPane } = await import("./LogPane.svelte");
        let first = render(LogPane, { props: { query_choices: choices, latest_query: "mine()" } });

        await fireEvent.click(first.getByTitle("Collapse revset"));
        expect(first.container.querySelector("textarea")).toBeNull();
        expect(first.container.querySelector(".summary")?.textContent).toBe("Mine");

        cleanup();
        let second = render(LogPane, { props: { query_choices: choices, latest_query: "all()" } });
        expect(second.container.querySelector("textarea")).toBeNull();
        expect(second.getByTitle("Expand revset")).toBeTruthy();
    });
});
