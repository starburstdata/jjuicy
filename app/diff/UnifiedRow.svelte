<script lang="ts">
    import type { DiffRow } from "../messages/DiffRow";
    import type { SyntaxSpan } from "./highlight";
    import DiffCode from "./DiffCode.svelte";

    export let row: DiffRow;
    export let syntax: SyntaxSpan[] | undefined = undefined;

    $: cls = row.kind == "Added" ? "add" : row.kind == "Removed" ? "remove" : row.kind == "Marker" ? "marker" : "context";
    $: prefix = row.kind == "Added" ? "+" : row.kind == "Removed" ? "−" : " ";
</script>

<div class="row {cls}">
    <span class="gutter">{row.old_line ?? ""}</span>
    <span class="gutter">{row.new_line ?? ""}</span>
    <span class="prefix">{row.kind == "Marker" ? "" : prefix}</span>
    <DiffCode text={row.text} tokens={row.tokens} {syntax} />
</div>

<style>
    .row {
        height: var(--row-height);
        line-height: var(--row-height);
        display: flex;
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
</style>
