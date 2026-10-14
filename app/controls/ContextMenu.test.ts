import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { setupMocks, cleanupMocks } from "../mocks";
import type { RevHeader } from "../messages/RevHeader";
import type { Operand } from "../messages/Operand";

let mockHeader: RevHeader = {
    id: {
        change: { type: "ChangeId", hex: "abc123", prefix: "abc", rest: "123", offset: null, is_divergent: false },
        commit: { type: "CommitId", hex: "def456", prefix: "def", rest: "456" },
    },
    description: { lines: ["test commit"] },
    author: { email: "test@test.com", name: "Test", timestamp: "2024-01-01T00:00:00Z" },
    has_conflict: false,
    is_working_copy: false,
    working_copy_of: null,
    is_immutable: false,
    refs: [],
    parent_ids: [{ type: "CommitId", hex: "parent1", prefix: "par", rest: "ent1" }],
};

describe("ContextMenu (revert)", () => {
    let mutationCalls: { cmd: string; args: Record<string, unknown> }[];

    beforeEach(() => {
        mutationCalls = [];
        setupMocks((cmd, args) => {
            if (cmd === "backout_revisions") {
                mutationCalls.push({ cmd, args });
                return {
                    type: "Updated",
                    new_status: {
                        operation_description: "back out",
                        working_copy: { type: "CommitId", hex: "new_wc", prefix: "new", rest: "_wc" },
                    },
                    new_selection: null,
                };
            }
            return undefined;
        });
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    it("clicking 'Revert into working copy' calls backout_revisions", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        const { selectionHeaders } = await import("../stores");
        selectionHeaders.set([mockHeader]);

        let onClose = vi.fn();
        let operand: Operand = { type: "Revision", header: mockHeader };

        const { container } = render(ContextMenu, {
            props: { operand, x: 100, y: 100, onClose },
        });

        let buttons = container.querySelectorAll("button");
        let revertButton = Array.from(buttons).find(
            (b) => b.textContent === "Revert into working copy",
        );

        expect(revertButton).toBeTruthy();
        expect(revertButton!.disabled).toBe(false);

        revertButton!.click();

        expect(onClose).toHaveBeenCalled();

        // wait for the async mutate() call to reach the IPC handler
        await vi.waitFor(() => {
            expect(mutationCalls).toHaveLength(1);
        });

        expect(mutationCalls[0].cmd).toBe("backout_revisions");
        let mutation = (mutationCalls[0].args as any).mutation;
        expect(mutation.set.from).toEqual(mockHeader.id);
        expect(mutation.set.to).toEqual(mockHeader.id);
    });

    it("revert is enabled for immutable revisions", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        const { selectionHeaders } = await import("../stores");

        let immutableHeader = { ...mockHeader, is_immutable: true };
        selectionHeaders.set([immutableHeader]);

        let operand: Operand = { type: "Revision", header: immutableHeader };

        const { container } = render(ContextMenu, {
            props: { operand, x: 100, y: 100, onClose: () => { } },
        });

        let buttons = container.querySelectorAll("button");
        let revertButton = Array.from(buttons).find(
            (b) => b.textContent === "Revert into working copy",
        );

        expect(revertButton).toBeTruthy();
        expect(revertButton!.disabled).toBe(false);
    });

    it("revert is enabled for multi-revision selection", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        const { selectionHeaders } = await import("../stores");

        let secondHeader = {
            ...mockHeader,
            id: {
                change: { type: "ChangeId" as const, hex: "xyz789", prefix: "xyz", rest: "789", offset: null, is_divergent: false },
                commit: { type: "CommitId" as const, hex: "uvw012", prefix: "uvw", rest: "012" },
            },
        };
        selectionHeaders.set([mockHeader, secondHeader]);

        let operand: Operand = { type: "Revisions", headers: [mockHeader, secondHeader] };

        const { container } = render(ContextMenu, {
            props: { operand, x: 100, y: 100, onClose: () => { } },
        });

        let buttons = container.querySelectorAll("button");
        let revertButton = Array.from(buttons).find(
            (b) => b.textContent === "Revert into working copy",
        );

        expect(revertButton).toBeTruthy();
        expect(revertButton!.disabled).toBe(false);
    });
});

describe("ContextMenu (hunk)", () => {
    let mutationCalls: { cmd: string; args: any }[];
    let hunk = {
        location: { from_file: { start: 1, len: 1 }, to_file: { start: 1, len: 1 } },
        lines: { lines: ["-a", "+b"] },
    };
    let path = { repo_path: "a.txt", relative_path: "a.txt" };

    beforeEach(() => {
        mutationCalls = [];
        setupMocks((cmd, args) => {
            if (cmd === "move_hunk") {
                mutationCalls.push({ cmd, args });
                return { type: "Updated", new_status: { operation_description: "move", working_copy: mockHeader.parent_ids[0] }, new_selection: null };
            }
            return undefined;
        });
    });

    afterEach(async () => {
        await cleanupMocks();
    });

    function find(container: HTMLElement, label: string) {
        return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement | undefined;
    }

    it("moves a hunk into the working copy", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        const { repoStatusEvent } = await import("../stores");
        let wc = { type: "CommitId" as const, hex: "wc0000", prefix: "wc0", rest: "000" };
        repoStatusEvent.set({ operation_description: "", working_copy: wc } as any);

        let operand: Operand = { type: "Change", headers: [mockHeader], path, hunk };
        const { container } = render(ContextMenu, { props: { operand, x: 0, y: 0, onClose: () => {} } });

        let button = find(container, "Move to working copy");
        expect(button?.disabled).toBe(false);
        button!.click();

        await vi.waitFor(() => expect(mutationCalls).toHaveLength(1));
        let mutation = mutationCalls[0].args.mutation;
        expect(mutation.from_id).toEqual(mockHeader.id);
        expect(mutation.to_id).toEqual(wc);
        expect(mutation.hunk).toEqual(hunk);
    });

    it("can't move a working copy hunk to itself", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        let operand: Operand = { type: "Change", headers: [{ ...mockHeader, is_working_copy: true }], path, hunk };
        const { container } = render(ContextMenu, { props: { operand, x: 0, y: 0, onClose: () => {} } });
        expect(find(container, "Move to working copy")?.disabled).toBe(true);
    });

    it("only offers the move for hunks", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        let operand: Operand = { type: "Change", headers: [mockHeader], path, hunk: null };
        const { container } = render(ContextMenu, { props: { operand, x: 0, y: 0, onClose: () => {} } });
        expect(find(container, "Move to working copy")).toBeUndefined();
    });

    it("shows a file's history", async () => {
        const { default: ContextMenu } = await import("./ContextMenu.svelte");
        const { logQueryRequest, selectedFile } = await import("../stores");
        const { get } = await import("svelte/store");
        let operand: Operand = { type: "Change", headers: [mockHeader], path, hunk: null };
        const { container } = render(ContextMenu, { props: { operand, x: 0, y: 0, onClose: () => {} } });

        find(container, "Show history")!.click();

        expect(get(logQueryRequest)).toBe(`files(root-file:"${path.repo_path}")`);
        expect(get(selectedFile)).toEqual({ path: path.repo_path });
    });
});

describe("fileHistoryRevset", () => {
    it("escapes quotes and backslashes", async () => {
        const { fileHistoryRevset } = await import("../mutators/ChangeMutator");
        expect(fileHistoryRevset('a "b"\\c.txt')).toBe('files(root-file:"a \\"b\\"\\\\c.txt")');
    });
});
