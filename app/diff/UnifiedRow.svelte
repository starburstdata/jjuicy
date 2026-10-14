<script lang="ts">
    import type { DiffRow } from "../messages/DiffRow";
    import type { SyntaxSpan } from "./highlight";
    import DiffCode from "./DiffCode.svelte";
    import BlameCell from "./BlameCell.svelte";
    import type { BlameLookup } from "./annotate";

    export let row: DiffRow;
    export let syntax: SyntaxSpan[] | undefined = undefined;
    export let blame: BlameLookup | null = null;

    $: cls = row.kind == "Added" ? "add" : row.kind == "Removed" ? "remove" : row.kind == "Marker" ? "marker" : "context";
    $: prefix = row.kind == "Added" ? "+" : row.kind == "Removed" ? "−" : " ";
</script>

<div class="row {cls}">
    {#if blame}<BlameCell blame={blame(row.new_line)} />{/if}
    <span class="gutter">{row.old_line ?? ""}</span>
    <span class="gutter">{row.new_line ?? ""}</span>
    <span class="prefix">{row.kind == "Marker" ? "" : prefix}</span>
    <span class="clip"><DiffCode text={row.text} tokens={row.tokens} {syntax} /></span>
</div>

<style>
    .row {
        height: var(--row-height);
        line-height: var(--row-height);
        display: flex;
        overflow: hidden;
        white-space: pre;
    }

    .gutter {
        flex: none;
        width: var(--gutter-width);
        padding-right: 6px;
        text-align: right;
        color: var(--ju-colors-foregroundMuted);
        background: var(--ju-colors-surfaceDeep);
        user-select: none;
    }

    .prefix {
        flex: none;
        width: 2ch;
        text-align: center;
        user-select: none;
    }

    .add {
        background: var(--ju-colors-diffAddBg);
        --word-bg: var(--ju-colors-diffAddWordBg);
    }

    .add .prefix {
        color: var(--ju-colors-added);
    }

    .remove {
        background: var(--ju-colors-diffDelBg);
        --word-bg: var(--ju-colors-diffDelWordBg);
    }

    .remove .prefix {
        color: var(--ju-colors-removed);
    }

    .marker {
        color: var(--ju-colors-foregroundMuted);
        font-style: italic;
    }

    /* gutters stay in place; the viewer's scrollbar moves only the code */
    .clip {
        flex: 1;
        min-width: 0;
        overflow: hidden;
    }

    .clip :global(.code) {
        display: inline-block;
        transform: translateX(calc(-1 * var(--scroll-x, 0px)));
    }
</style>
