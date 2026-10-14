import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { RevsResult } from "../messages/RevsResult";
import type { RevHeader } from "../messages/RevHeader";
import { setupMocks, cleanupMocks } from "../mocks";

type Detail = Extract<RevsResult, { type: "Detail" }>;

function mkId(change: string, commit: string) {
    return {
        change: {
            type: "ChangeId" as const,
            hex: change,
            prefix: change.slice(0, 3),
            rest: change.slice(3),
            offset: null,
            is_divergent: false,
        },
        commit: { type: "CommitId" as const, hex: commit, prefix: commit.slice(0, 4), rest: commit.slice(4) },
    };
}

function mkHeader(overrides: Partial<RevHeader> = {}): RevHeader {
    return {
        id: mkId("abc123def456", "deadbeef1234"),
        description: { lines: ["Test commit message", "", "a longer body"] },
        author: { email: "test@example.com", name: "Test User", timestamp: "2024-01-15T12:00:00Z" },
        has_conflict: false,
        is_working_copy: false,
        working_copy_of: null,
        is_immutable: false,
        refs: [],
        parent_ids: [mkId("par123par123", "feedface0000").commit],
        ...overrides,
    };
}

function mkRevs(header: RevHeader = mkHeader()): Detail {
    let parent = mkHeader({
        id: mkId("par123par123", "feedface0000"),
        description: { lines: ["the parent"] },
        parent_ids: [],
    });
    return {
        type: "Detail",
        set: { from: header.id, to: header.id },
        headers: [header],
        parents: [parent],
        changes: [],
        conflicts: [],
    };
}

function button(container: HTMLElement, label: string) {
    return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() == label) as
        | HTMLButtonElement
        | undefined;
}

describe("DetailPane", () => {
    let calls: { cmd: string; args: any }[];

    beforeEach(() => {
        calls = [];
        setupMocks((cmd, args) => {
            calls.push({ cmd, args });
            return { type: "Unchanged" };
        });
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("renders the header", async () => {
        let { default: DetailPane } = await import("./DetailPane.svelte");
        let { container } = render(DetailPane, { props: { revs: mkRevs() } });

        expect(container.querySelector("h2")?.textContent).toBe("Test commit message");
        expect(container.textContent).toContain("a longer body");
        expect(container.textContent).toContain("abc123de");
        expect(container.textContent).toContain("deadbeef");
        expect(container.textContent).toContain("Test User");
    });

    it("describes through the inline editor", async () => {
        let { default: DetailPane } = await import("./DetailPane.svelte");
        let { container } = render(DetailPane, { props: { revs: mkRevs() } });

        expect(container.querySelector("textarea")).toBeNull();
        await fireEvent.click(button(container, "Edit")!);

        let textarea = container.querySelector("textarea")!;
        expect(textarea.value).toBe("Test commit message\n\na longer body");
        expect(button(container, "Describe")!.disabled).toBe(true);

        await fireEvent.input(textarea, { target: { value: "new message" } });
        expect(button(container, "Describe")!.disabled).toBe(false);
        await fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

        await vi.waitFor(() => expect(calls.some((c) => c.cmd == "describe_revision")).toBe(true));
        let mutation = calls.find((c) => c.cmd == "describe_revision")!.args.mutation;
        expect(mutation.new_description).toBe("new message");
        expect(container.querySelector("textarea")).toBeNull();
    });

    it("renders parents in a merge zone", async () => {
        let { default: DetailPane } = await import("./DetailPane.svelte");
        let { container } = render(DetailPane, { props: { revs: mkRevs() } });

        let parents = container.querySelector(".parents");
        expect(parents).not.toBeNull();
        expect(parents!.closest(".zone")).not.toBeNull();
        expect(parents!.textContent).toContain("the parent");
    });

    it("disables mutating actions for immutable revisions", async () => {
        let { default: DetailPane } = await import("./DetailPane.svelte");
        let { container } = render(DetailPane, { props: { revs: mkRevs(mkHeader({ is_immutable: true })) } });

        for (let label of ["Edit", "New before", "Squash", "Restore", "Abandon"]) {
            let found = Array.from(container.querySelectorAll(".actions button")).find(
                (b) => b.textContent?.trim() == label,
            ) as HTMLButtonElement;
            expect(found, label).toBeTruthy();
            expect(found.disabled, label).toBe(true);
        }
        for (let label of ["New child", "Duplicate", "Backout"]) {
            expect(button(container, label)!.disabled, label).toBe(false);
        }
        expect(container.querySelector(".title-row button")!.hasAttribute("disabled")).toBe(true);
        expect(container.textContent).toContain("Immutable");
    });

    it("runs actions through the revision mutator", async () => {
        let { default: DetailPane } = await import("./DetailPane.svelte");
        let { container } = render(DetailPane, { props: { revs: mkRevs() } });

        await fireEvent.click(button(container, "New child")!);
        await vi.waitFor(() => expect(calls.some((c) => c.cmd == "create_revision")).toBe(true));
    });
});
