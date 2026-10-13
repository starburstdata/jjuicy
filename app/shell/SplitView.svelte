<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import { defaultState, gridTemplate, loadState, resizePair, saveState, windowStorageKey, type SplitState } from "./splitview";

    export let panes: Snippet[];
    export let minSizes: number[] = [];
    export let initialSizes: number[] | null = null;
    export let collapsed: boolean[] = [];
    export let storageKey: string | null = null;

    let elements: HTMLDivElement[] = [];
    let dragging = false;

    let n = panes.length;
    let key = storageKey ? windowStorageKey(storageKey) : null;
    let fallback = defaultState(n);
    if (initialSizes && initialSizes.length == n) {
        let total = initialSizes.reduce((a, b) => a + b, 0);
        fallback.sizes = initialSizes.map(s => s / total);
    }
    let sizes = (key ? loadState(key, n, fallback) : fallback).sizes;

    $: state = { sizes, collapsed: panes.map((_, i) => collapsed[i] ?? false) } as SplitState;
    $: visible = panes.map((_, i) => i).filter(i => !state.collapsed[i]);
    $: template = gridTemplate(state, minSizes);
    // grid column of each visible pane, with a separator column between neighbours
    $: columns = Object.fromEntries(visible.map((i, pos) => [i, pos * 2 + 1]));

    let drag: { a: number; b: number } | null = null;

    function startDrag(event: MouseEvent, a: number, b: number) {
        if (event.button !== 0) return;
        event.preventDefault();
        drag = { a, b };
        dragging = true;
        window.addEventListener("mousemove", onDrag);
        window.addEventListener("mouseup", endDrag);
    }

    function onDrag(event: MouseEvent) {
        if (!drag) return;
        let left = elements[drag.a]?.getBoundingClientRect();
        let right = elements[drag.b]?.getBoundingClientRect();
        if (!left || !right) return;
        sizes = resizePair(sizes, drag.a, drag.b, event.clientX - left.left, left.width + right.width, minSizes);
    }

    function endDrag() {
        drag = null;
        dragging = false;
        window.removeEventListener("mousemove", onDrag);
        window.removeEventListener("mouseup", endDrag);
        if (key) saveState(key, { sizes, collapsed: state.collapsed });
    }

    onMount(() => endDrag);
</script>

<div class="split-view" class:dragging style="grid-template-columns: {template}">
    {#each panes as pane, i}
        <div class="pane"
             class:collapsed={state.collapsed[i]}
             data-pane={i}
             bind:this={elements[i]}
             style={columns[i] ? `grid-column: ${columns[i]}` : ""}>
            {@render pane()}
        </div>
    {/each}
    {#each visible.slice(1) as b, pos}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="separator"
             role="separator"
             aria-orientation="vertical"
             data-separator={pos}
             style="grid-column: {pos * 2 + 2}"
             on:mousedown={e => startDrag(e, visible[pos], b)}>
            <div class="hit-area"></div>
        </div>
    {/each}
</div>

<style>
    .split-view {
        display: grid;
        grid-template-rows: 100%;
        height: 100%;
        overflow: hidden;
    }

    .split-view.dragging {
        cursor: col-resize;
        user-select: none;
    }

    .pane {
        grid-row: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }

    /* kept mounted so panes don't lose scroll position and query state */
    .pane.collapsed {
        display: none;
    }

    .separator {
        grid-row: 1;
        background: var(--ju-colors-surfaceAlt);
        cursor: col-resize;
        position: relative;
        /* global.css sets div { pointer-events: none } for drop-transparency */
        pointer-events: auto;
    }

    /* widens the hit target beyond the hairline without affecting layout */
    .hit-area {
        position: absolute;
        inset: 0 -3px;
        z-index: 1;
        cursor: col-resize;
        pointer-events: auto;
    }

    .separator:hover,
    .split-view.dragging .separator {
        background: var(--ju-colors-surfaceStrong);
    }
</style>
