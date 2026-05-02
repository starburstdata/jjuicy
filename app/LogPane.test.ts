import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, waitFor } from "@testing-library/svelte";
import type { LogPage } from "./messages/LogPage";
import { setupMocks, cleanupMocks } from "./mocks";

describe("LogPane", () => {
    beforeAll(() => {
        setupMocks((cmd, _args) => {
            if (cmd === "query_log") {
                let emptyPage: LogPage = { rows: [], has_more: false };
                return emptyPage;
            }
            return undefined;
        });
    });

    afterAll(async () => {
        await cleanupMocks();
    });

    it("renders loading state", async () => {
        const { default: LogPane } = await import("./LogPane.svelte");

        const { container } = render(LogPane, {
            props: {
                query_choices: { default: "all()" },
                latest_query: "all()",
            },
        });

        expect(container.textContent).toContain("Loading");
    });

    it("renders empty log with mocked IPC", async () => {
        const { default: LogPane } = await import("./LogPane.svelte");
        const { repoStatusEvent } = await import("./stores");

        const { container } = render(LogPane, {
            props: {
                query_choices: { default: "all()" },
                latest_query: "all()",
            },
        });

        repoStatusEvent.set({
            operation_description: "initial",
            working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0000000000000000000000000000000" },
        });

        await waitFor(() => {
            expect(container.textContent).not.toContain("Loading");
        });
    });
});
