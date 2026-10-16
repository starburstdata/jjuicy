import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, waitFor, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import type { RevHeader } from "../messages/RevHeader";
import { setupMocks, cleanupMocks } from "../mocks";
import { ENTRIES } from "./bookmarks.fixtures";

let mutations: { cmd: string; args: any }[] = [];
let loads = 0;

describe("BookmarkSection", () => {
    beforeAll(() => {
        setupMocks((cmd, args) => {
            if (cmd === "query_bookmarks") {
                loads++;
                return ENTRIES;
            }
            if (cmd === "delete_refs") {
                mutations.push({ cmd, args });
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
        localStorage.clear();
        mutations = [];
        loads = 0;
    });

    async function renderSection(visible: string[] = []) {
        let { default: BookmarkSection } = await import("./BookmarkSection.svelte");
        let revealed: RevHeader[] = [];
        let shown: RevHeader[] = [];
        let result = render(BookmarkSection, {
            props: {
                loaded: new Set(visible),
                onReveal: (h: RevHeader) => revealed.push(h),
                onShowInLog: (h: RevHeader) => shown.push(h),
            },
        });
        await waitFor(() => expect(result.container.querySelector("[data-bookmark=feature]")).not.toBeNull());
        return { ...result, revealed, shown };
    }

    it("renders groups with badges", async () => {
        let { container } = await renderSection();
        let headings = [...container.querySelectorAll("h4")].map(h => h.textContent);
        expect(headings).toEqual(["Local", "Tracked remote", "Untracked remote"]);
        expect(container.querySelector("[data-bookmark=feature] .badge")!.textContent).toBe("↑2");
        expect(container.querySelector("[data-bookmark='gone@origin'] .badge.absent")).not.toBeNull();
    });

    it("reveals visible targets and offers show in log for the rest", async () => {
        let { container, revealed, shown } = await renderSection(["aaaa1111"]);
        let feature = container.querySelector("[data-bookmark=feature]")!;
        expect(feature.querySelector(".link")).toBeNull();
        await fireEvent.click(feature.querySelector("button")!);
        expect(revealed.map(h => h.id.commit.hex)).toEqual(["aaaa1111"]);

        let landed = container.querySelector("[data-bookmark=landed]")!;
        await fireEvent.click(landed.querySelector(".link")!);
        expect(shown.map(h => h.id.commit.hex)).toEqual(["cccc3333"]);
    });

    it("confirms before deleting merged bookmarks in one mutation", async () => {
        let { currentConfirmation } = await import("../stores");
        let { getByText } = await renderSection();
        await fireEvent.click(getByText("Delete 1 merged"));

        let request = get(currentConfirmation)!;
        expect(request.items).toEqual(["landed"]);
        expect(mutations).toHaveLength(0);

        request.callback(true);
        await waitFor(() => expect(mutations).toHaveLength(1));
        expect(mutations[0].args.mutation.refs).toMatchObject([{ type: "LocalBookmark", bookmark_name: "landed" }]);
    });

    it("forgets absent remotes", async () => {
        let { currentConfirmation } = await import("../stores");
        let { getByText } = await renderSection();
        await fireEvent.click(getByText("Forget 1 absent"));

        let request = get(currentConfirmation)!;
        expect(request.items).toEqual(["gone@origin"]);
        request.callback(false);
        expect(mutations).toHaveLength(0);
    });

    it("defers reloading on status changes until opened", async () => {
        let { repoStatusEvent } = await import("../stores");
        let { default: BookmarkSection } = await import("./BookmarkSection.svelte");
        let status = (n: number) => ({
            operation_description: `op ${n}`,
            working_copy: { type: "CommitId" as const, hex: "0".repeat(40), prefix: "0000000", rest: "0".repeat(33) },
            summary: null,
        });
        repoStatusEvent.set(status(1));
        let result = render(BookmarkSection, {
            props: { loaded: new Set<string>(), onReveal: () => {}, onShowInLog: () => {}, open: false },
        });
        await waitFor(() => expect(loads).toBe(1));

        repoStatusEvent.set(status(2));
        repoStatusEvent.set(status(3));
        await new Promise(r => setTimeout(r, 20));
        expect(loads).toBe(1);

        await result.rerender({ open: true });
        await waitFor(() => expect(loads).toBe(2));

        repoStatusEvent.set(status(4));
        await waitFor(() => expect(loads).toBe(3));
    });
});
