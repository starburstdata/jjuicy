<script lang="ts">
    import type { RowPair } from "./pairing";
    import type { DiffRow } from "../messages/DiffRow";
    import type { SyntaxSpan } from "./highlight";
    import DiffCode from "./DiffCode.svelte";

    export let pair: RowPair;
    export let syntax: Map<DiffRow, SyntaxSpan[]> | null = null;

    $: marker = pair.left?.kind == "Marker";
    $: context = pair.left != null && pair.left === pair.right;
    $: leftClass = pair.left == null ? "empty" : context ? "context" : "remove";
    $: rightClass = pair.right == null ? "empty" : context ? "context" : "add";
</script>

{#if marker && pair.left}
    <div class="row marker">
        <span class="gutter"></span>
        <DiffCode text={pair.left.text} tokens={[]} />
    </div>
{:else}
    <div class="row">
        <div class="side {leftClass}">
            <span class="gutter">{pair.left?.old_line ?? ""}</span>
            {#if pair.left}<DiffCode text={pair.left.text} tokens={context ? [] : pair.left.tokens} syntax={syntax?.get(pair.left)} />{/if}
        </div>
        <div class="side {rightClass}">
            <span class="gutter">{pair.right?.new_line ?? ""}</span>
            {#if pair.right}<DiffCode text={pair.right.text} tokens={context ? [] : pair.right.tokens} syntax={syntax?.get(pair.right)} />{/if}
        </div>
    </div>
{/if}

<style>
    .row {
        height: var(--row-height);
        line-height: var(--row-height);
        display: grid;
        grid-template-columns: 1fr 1fr;
        white-space: pre;
    }

    .row.marker {
        display: flex;
        color: var(--ju-colors-foregroundMuted);
        font-style: italic;
    }

    .side {
        display: flex;
        min-width: 0;
        overflow: hidden;
    }

    .side + .side {
        border-left: 1px solid var(--ju-colors-outline);
    }

    .gutter {
        flex: none;
        width: var(--gutter-width);
        padding-right: 6px;
        margin-right: 1ch;
        text-align: right;
        color: var(--ju-colors-foregroundMuted);
        background: var(--ju-colors-surfaceDeep);
        user-select: none;
    }

    .add {
        background: var(--ju-colors-diffAddBg);
        --word-bg: var(--ju-colors-diffAddWordBg);
    }

    .remove {
        background: var(--ju-colors-diffDelBg);
        --word-bg: var(--ju-colors-diffDelWordBg);
    }

    .empty {
        background: repeating-linear-gradient(
            135deg,
            transparent 0 4px,
            color-mix(in srgb, var(--ju-colors-outline) 40%, transparent) 4px 5px
        );
    }
</style>
