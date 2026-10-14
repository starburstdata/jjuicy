<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { EXPAND_STEP } from "./items";

    export let hidden: number;
    export let leading: boolean;
    export let trailing: boolean;

    let dispatch = createEventDispatcher<{ expand: { all: boolean } }>();

    $: icon = leading ? "↑" : trailing ? "↓" : "↕";
    $: step = leading || trailing ? EXPAND_STEP : EXPAND_STEP * 2;
</script>

<div class="separator">
    {#if hidden > step}
        <button title="show {EXPAND_STEP} more lines" on:click={() => dispatch("expand", { all: false })}>{icon}</button>
    {/if}
    <button class="label" title="show all hidden lines" on:click={() => dispatch("expand", { all: true })}>
        ⋯ {hidden} unchanged {hidden == 1 ? "line" : "lines"}
    </button>
</div>

<style>
    .separator {
        height: var(--separator-height);
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: calc(var(--gutter-width) - 2ch);
        background: color-mix(in srgb, var(--ju-colors-accent) 6%, var(--ju-colors-background));
        color: var(--ju-colors-foregroundMuted);
        font-size: var(--ju-text-sizeSm);
        border-top: 1px solid var(--ju-colors-outline);
        border-bottom: 1px solid var(--ju-colors-outline);
        box-sizing: border-box;
        position: sticky;
        left: 0;
    }

    button {
        pointer-events: auto;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        padding: 0 4px;
        border-radius: 4px;

        &:hover {
            background: var(--ju-colors-surface);
            color: var(--ju-colors-foreground);
        }
    }
</style>
