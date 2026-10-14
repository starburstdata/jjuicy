import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, waitFor, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import type { OpLogEntry } from "../messages/OpLogEntry";
import type { RepoStatus } from "../messages/RepoStatus";
import { setupMocks, cleanupMocks } from "../mocks";
import { currentConfirmation, opLogOpen, repoStatusEvent } from "../stores";

const HEAD = "a".repeat(128);
const PAST = "b".repeat(128);

const ENTRIES: OpLogEntry[] = [
    { id: HEAD, description: "describe commit", time: "2026-01-02T00:00:00Z", user: "me", host: "box", is_current: true },
    { id: PAST, description: "new empty commit", time: "2026-01-01T00:00:00Z", user: "me", host: "box", is_current: false },
];

function status(at_operation?: string): RepoStatus {
    return {
        operation_description: "describe commit",
        working_copy: { type: "CommitId", hex: "0".repeat(40), prefix: "0000000", rest: "0".repeat(33) },
        summary: null,
        ...(at_operation ? { at_operation } : {}),
    };
}

let calls: { cmd: string; args: any }[] = [];

describe("OpLogPanel", () => {
    beforeAll(() => {
        setupMocks((cmd, raw) => {
            let args = raw as any;
            calls.push({ cmd, args });
            if (cmd === "query_op_log") {
                let entries = get(repoStatusEvent)?.at_operation
                    ? ENTRIES.map((e) => ({ ...e, is_current: e.id == PAST }))
                    : ENTRIES;
                return entries.slice(args.offset, args.offset + args.limit);
            }
            if (cmd === "view_operation") return status(args.id ?? undefined);
            if (cmd === "restore_operation") return { type: "Unchanged" };
            return undefined;
        });
    });

    afterAll(async () => {
        await cleanupMocks();
    });

    beforeEach(() => {
        cleanup();
        calls = [];
        repoStatusEvent.set(status());
        currentConfirmation.set(null);
        opLogOpen.set(true);
    });

    async function renderPanel() {
        let { default: OpLogPanel } = await import("./OpLogPanel.svelte");
        let result = render(OpLogPanel);
        await waitFor(() => expect(result.container.querySelectorAll("li").length).toBe(2));
        return result;
    }

    it("lists operations newest first", async () => {
        let { container } = await renderPanel();
        let items = [...container.querySelectorAll("li")];
        expect(items.map((li) => li.querySelector(".description")!.textContent)).toEqual([
            "describe commit",
            "new empty commit",
        ]);
        expect(items[0].classList.contains("current")).toBe(true);
        expect(items[0].querySelector(".restore")).toBeNull();
        expect(items[1].querySelector(".who")!.textContent).toBe("me@box");
        // fewer than a page came back, so there is nothing more to load
        expect(container.querySelector(".more")).toBeNull();
    });

    it("views a past operation and returns", async () => {
        let { container } = await renderPanel();
        await fireEvent.click(container.querySelectorAll("li")[1].querySelector(".view")!);
        await waitFor(() => expect(get(repoStatusEvent)?.at_operation).toBe(PAST));
        expect(calls.find((c) => c.cmd === "view_operation")!.args).toEqual({ id: PAST });
        await waitFor(() => expect(container.querySelectorAll("li")[1].classList.contains("viewed")).toBe(true));

        await fireEvent.click(container.querySelectorAll("li")[0].querySelector(".view")!);
        await waitFor(() => expect(get(repoStatusEvent)?.at_operation).toBeUndefined());
        expect(calls.filter((c) => c.cmd === "view_operation").at(-1)!.args).toEqual({ id: null });
    });

    it("restores after confirmation", async () => {
        let { container } = await renderPanel();
        await fireEvent.click(container.querySelectorAll("li")[1].querySelector(".restore")!);
        let request = get(currentConfirmation)!;
        expect(request.items[0]).toContain("new empty commit");
        request.callback(true);
        await waitFor(() => expect(calls.some((c) => c.cmd === "restore_operation")).toBe(true));
        expect(calls.find((c) => c.cmd === "restore_operation")!.args.mutation).toEqual({ id: PAST });
    });

    it("closes on escape", async () => {
        await renderPanel();
        await fireEvent.keyDown(document, { key: "Escape" });
        expect(get(opLogOpen)).toBe(false);
    });

    it("leaves escape to an open dialog", async () => {
        let { hasModal } = await import("../stores");
        await renderPanel();
        hasModal.set(true);
        await fireEvent.keyDown(document, { key: "Escape" });
        expect(get(opLogOpen)).toBe(true);
        hasModal.set(false);
    });
});
