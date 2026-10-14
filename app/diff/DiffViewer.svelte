<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { RevHeader } from "../messages/RevHeader";
    import type { RevSet } from "../messages/RevSet";
    import type { RevChangeSummary } from "../messages/RevChangeSummary";
    import type { FileDiff } from "../messages/FileDiff";
    import HunkObject from "../objects/HunkObject.svelte";
    import { query } from "../ipc";
    import { diffMode } from "../stores";
    import { diffCache, diffKey } from "./cache";
    import { computeGaps } from "./gaps";
    import { buildItems, expandReveal, maxColumns, revealRanges, type Reveal } from "./items";
    import BinaryCard from "./BinaryCard.svelte";
    import ContextSeparator from "./ContextSeparator.svelte";
    import UnifiedRow from "./UnifiedRow.svelte";
    import SplitRow from "./SplitRow.svelte";

    export let set: RevSet;
    export let change: RevChangeSummary;
    // non-null only when hunks can be dragged
    export let header: RevHeader | null;

    // every item is the same height, so the visible window is a division away
    const ITEM_HEIGHT = 22;
    const VIRTUALIZE_ABOVE = 2000;
    const OVERSCAN = 40;

    let diff: FileDiff | null = null;
    let error: string | null = null;
    let reveals = new Map<number, Reveal>();
    let lines = new Map<number, string>();

    $: load(set, change);

    async function load(forSet: RevSet, forChange: RevChangeSummary) {
        let key = diffKey(forSet, forChange.path.repo_path);
        let cached = diffCache.get(key);
        if (cached) {
            show(cached);
            return;
        }
        let result = await query<FileDiff>("query_file_diff", { set: forSet, path: forChange.path, context: 3 });
        // a newer selection may have started while this one was in flight
        if (forSet != set || forChange != change) return;
        if (result.type == "data") {
            diffCache.set(key, result.value);
            show(result.value);
        } else {
            diff = null;
            error = result.message;
        }
    }

    function show(value: FileDiff) {
        if (value !== diff) {
            reveals = new Map();
            lines = new Map();
        }
        diff = value;
        error = null;
    }

    $: gaps = diff ? computeGaps(diff.hunks, diff.new_line_count) : [];
    $: items = diff ? buildItems(diff.hunks, gaps, reveals, lines, $diffMode) : [];
    $: digits = String(Math.max(diff?.old_line_count ?? 0, diff?.new_line_count ?? 0, 1)).length;
    $: columns = maxColumns(items);
    $: minWidth =
        $diffMode == "unified"
            ? `calc(2 * (${digits}ch + 6px) + ${columns + 3}ch)`
            : `calc(2 * (${digits}ch + 6px + ${columns + 2}ch))`;

    async function onExpand(index: number, all: boolean) {
        let gap = gaps[index];
        if (!gap || !diff) return;
        let forDiff = diff;
        let reveal = expandReveal(gap, reveals.get(index), index == 0, index == forDiff.hunks.length, all);
        for (let [start, end] of revealRanges(gap, reveal)) {
            let missing = false;
            for (let n = start; n <= end && !missing; n++) missing = !lines.has(n);
            if (!missing) continue;
            let result = await query<string[]>("query_file_lines", {
                set,
                path: change.path,
                side: "New",
                start,
                end,
            });
            if (diff !== forDiff) return;
            if (result.type != "data") {
                error = result.message;
                return;
            }
            result.value.forEach((text, i) => lines.set(start + i, text));
        }
        lines = lines;
        reveals = new Map(reveals).set(index, reveal);
    }

    let host: HTMLElement;
    let scroller: HTMLElement | null = null;
    let first = 0;
    let last = 0;
    let observer: ResizeObserver | null = null;

    $: virtual = items.length > VIRTUALIZE_ABOVE;
    $: if (!virtual) {
        first = 0;
        last = items.length;
    } else {
        items;
        tick().then(updateWindow);
    }

    function scrollParent(node: HTMLElement | null): HTMLElement | null {
        for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
            let overflow = getComputedStyle(el).overflowY;
            if (overflow == "auto" || overflow == "scroll") return el;
        }
        return null;
    }

    function updateWindow() {
        if (!virtual || !host) return;
        let viewTop = 0;
        let viewHeight = window.innerHeight;
        if (scroller) {
            viewTop = scroller.getBoundingClientRect().top - host.getBoundingClientRect().top;
            viewHeight = scroller.clientHeight;
        } else {
            viewTop = -host.getBoundingClientRect().top;
        }
        first = Math.max(0, Math.floor(viewTop / ITEM_HEIGHT) - OVERSCAN);
        last = Math.min(items.length, Math.ceil((viewTop + viewHeight) / ITEM_HEIGHT) + OVERSCAN);
    }

    onMount(() => {
        scroller = scrollParent(host);
        (scroller ?? window).addEventListener("scroll", updateWindow, { passive: true });
        if (scroller) {
            observer = new ResizeObserver(updateWindow);
            observer.observe(scroller);
        }
        updateWindow();
    });

    onDestroy(() => {
        (scroller ?? window).removeEventListener("scroll", updateWindow);
        observer?.disconnect();
    });

    $: visible = items.slice(first, last);
</script>

<div class="viewer" bind:this={host}>
    {#if error}
        <div class="placeholder">{error}</div>
    {:else if diff && (diff.kind.type == "Binary" || diff.kind.type == "TooLarge")}
        <BinaryCard kind={diff.kind} />
    {:else if diff && diff.hunks.length == 0}
        <div class="placeholder">No content changes</div>
    {:else if diff}
        <div class="scroll">
            <div
                class="diff {$diffMode}"
                style="--row-height: {ITEM_HEIGHT}px; --separator-height: {ITEM_HEIGHT}px; --gutter-width: calc({digits}ch + 6px); min-width: {minWidth}; height: {items.length *
                    ITEM_HEIGHT}px">
                <div class="window" style="transform: translateY({first * ITEM_HEIGHT}px)">
                    {#each visible as item, i (i)}
                        {#if item.type == "hunk"}
                            <div class="hunk">
                                <HunkObject
                                    header={diff.kind.type == "Conflict" ? null : header}
                                    path={change.path}
                                    hunk={item.hunk.header} />
                            </div>
                        {:else if item.type == "gap"}
                            <ContextSeparator
                                hidden={item.hidden}
                                leading={item.leading}
                                trailing={item.trailing}
                                on:expand={(e) => item.type == "gap" && onExpand(item.index, e.detail.all)} />
                        {:else if item.type == "row"}
                            <UnifiedRow row={item.row} />
                        {:else}
                            <SplitRow pair={item.pair} />
                        {/if}
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .scroll {
        overflow-x: auto;
        overflow-y: hidden;
    }

    .diff {
        position: relative;
        background: var(--ju-colors-background);
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeMd);
        user-select: text;
    }

    .window {
        will-change: transform;
    }

    .hunk {
        height: var(--row-height);
        overflow: hidden;
        font-size: var(--ju-text-sizeSm);
        color: var(--ju-colors-foregroundMuted);
    }

    .hunk :global(.hunk) {
        padding: 2px 6px;
        text-align: left;
        height: 100%;
        box-sizing: border-box;
    }

    .placeholder {
        padding: 6px;
        color: var(--ju-colors-foregroundMuted);
        font-size: var(--ju-text-sizeMd);
    }
</style>
