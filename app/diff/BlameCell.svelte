<script lang="ts">
    import type { Blame } from "./annotate";
    import { revisionSelectEvent } from "../stores";

    export let blame: Blame | null;

    $: title = blame
        ? `${blame.origin.id.change.prefix} · ${blame.origin.author.name} · ${new Date(blame.origin.author.timestamp).toLocaleDateString()}\n${blame.origin.summary || "(no description)"}`
        : "";

    function onClick() {
        if (blame) revisionSelectEvent.set({ from: blame.origin.id, to: blame.origin.id });
    }
</script>

{#if blame}
    <button class="blame" class:first={blame.first} {title} on:click={onClick}>
        {#if blame.first}<span class="id">{blame.origin.id.change.prefix}</span>
            <span class="author">{blame.origin.author.name}</span>{/if}
    </button>
{:else}
    <span class="blame"></span>
{/if}

<style>
    .blame {
        flex: none;
        width: var(--blame-width);
        box-sizing: border-box;
        display: flex;
        gap: 1ch;
        overflow: hidden;
        padding: 0 6px;
        border: none;
        border-right: 1px solid var(--ju-colors-outline);
        background: var(--ju-colors-surfaceDeep);
        color: var(--ju-colors-foregroundMuted);
        font: inherit;
        font-size: var(--ju-text-sizeSm);
        line-height: var(--row-height);
        text-align: left;
        white-space: nowrap;
        user-select: none;
    }

    button.blame {
        cursor: pointer;

        &:hover {
            color: var(--ju-colors-foreground);
        }
    }

    /* a border would add a pixel to rows that must all be the same height */
    .first {
        box-shadow: inset 0 1px 0 var(--ju-colors-outline);
    }

    .id {
        flex: none;
        color: var(--ju-colors-accent);
    }

    .author {
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
