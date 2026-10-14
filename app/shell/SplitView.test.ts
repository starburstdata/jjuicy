import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import SplitView from "./SplitView.svelte";
import { defaultState, gridTemplate, loadState, resizePair, saveState } from "./splitview";

function pane(text: string) {
    return createRawSnippet(() => ({ render: () => `<span class="content">${text}</span>` }));
}

describe("resizePair", () => {
    it("moves the boundary and preserves the pair's share", () => {
        let next = resizePair([0.25, 0.25, 0.5], 0, 1, 150, 200, [50, 50, 50]);
        expect(next[0]).toBeCloseTo(0.375);
        expect(next[1]).toBeCloseTo(0.125);
        expect(next[2]).toBe(0.5);
    });

    it("clamps to minimum sizes", () => {
        let next = resizePair([0.5, 0.5], 0, 1, 10, 400, [100, 120]);
        expect(next[0]).toBeCloseTo(0.25);
        next = resizePair([0.5, 0.5], 0, 1, 399, 400, [100, 120]);
        expect(next[0]).toBeCloseTo(0.7);
    });

    it("ignores drags when minimums don't fit", () => {
        let sizes = [0.5, 0.5];
        expect(resizePair(sizes, 0, 1, 50, 100, [80, 80])).toBe(sizes);
    });
});

describe("persistence", () => {
    beforeEach(() => localStorage.clear());

    it("round-trips sizes and collapse state", () => {
        saveState("test-split", { sizes: [0.2, 0.3, 0.5], collapsed: [true, false, false] });
        let state = loadState("test-split", 3, defaultState(3));
        expect(state.sizes).toEqual([0.2, 0.3, 0.5]);
        expect(state.collapsed).toEqual([true, false, false]);
    });

    it("falls back on mismatched or corrupt data", () => {
        let fallback = defaultState(2);
        saveState("test-split", { sizes: [0.2, 0.3, 0.5], collapsed: [false, false, false] });
        expect(loadState("test-split", 2, fallback)).toBe(fallback);
        localStorage.setItem("test-split", "{not json");
        expect(loadState("test-split", 2, fallback)).toBe(fallback);
        localStorage.setItem("test-split", JSON.stringify({ sizes: [0, -1], collapsed: [false, false] }));
        expect(loadState("test-split", 2, fallback)).toBe(fallback);
    });

    it("normalises stored sizes", () => {
        localStorage.setItem("test-split", JSON.stringify({ sizes: [1, 3], collapsed: [false, false] }));
        expect(loadState("test-split", 2, defaultState(2)).sizes).toEqual([0.25, 0.75]);
    });
});

describe("gridTemplate", () => {
    it("omits collapsed columns and their separators", () => {
        let template = gridTemplate({ sizes: [0.5, 0.25, 0.25], collapsed: [true, false, false] }, [100, 100, 100]);
        expect(template).toBe("minmax(100px, 0.5fr) var(--ju-components-separatorWidth) minmax(100px, 0.5fr)");
    });

    it("gives a lone visible pane the full width", () => {
        let template = gridTemplate({ sizes: [0.25, 0.25, 0.5], collapsed: [true, true, false] }, [100, 100, 100]);
        expect(template).toBe("minmax(100px, 1fr)");
    });
});

describe("SplitView", () => {
    beforeEach(() => localStorage.clear());

    it("renders a separator between each visible pane", () => {
        let { container } = render(SplitView, {
            props: { panes: [pane("a"), pane("b"), pane("c")], minSizes: [10, 10, 10] },
        });
        expect(container.querySelectorAll(".pane").length).toBe(3);
        expect(container.querySelectorAll(".separator").length).toBe(2);
        expect(container.textContent).toContain("abc");
    });

    it("hides collapsed panes but keeps them mounted", () => {
        let { container } = render(SplitView, {
            props: { panes: [pane("a"), pane("b"), pane("c")], collapsed: [true, false, false] },
        });
        expect(container.querySelectorAll(".separator").length).toBe(1);
        let first = container.querySelector('[data-pane="0"]') as HTMLElement;
        expect(first.classList.contains("collapsed")).toBe(true);
        expect(first.textContent).toBe("a");
    });

    it("persists sizes after a drag", async () => {
        let { container } = render(SplitView, {
            props: { panes: [pane("a"), pane("b")], minSizes: [10, 10], storageKey: "drag-split" },
        });
        let root = container.querySelector(".split-view") as HTMLElement;
        root.style.width = "400px";
        let separator = container.querySelector(".separator") as HTMLElement;
        let left = (container.querySelector('[data-pane="0"]') as HTMLElement).getBoundingClientRect().left;
        await fireEvent.mouseDown(separator, { button: 0, clientX: left + 200 });
        await fireEvent.mouseMove(window, { clientX: left + 100 });
        await fireEvent.mouseUp(window);
        let saved = JSON.parse(localStorage.getItem("drag-split")!);
        expect(saved.sizes[0]).toBeLessThan(saved.sizes[1]);
        expect(saved.sizes[0] + saved.sizes[1]).toBeCloseTo(1);
    });
});
