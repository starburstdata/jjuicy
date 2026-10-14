<script lang="ts" context="module">
    export type ChipVariant = "bookmark" | "wc" | "conflict" | "divergent" | "tag" | "remote" | "immutable" | "neutral";
</script>

<script lang="ts">
    export let context: boolean;
    export let target: boolean;
    export let disconnected: boolean = false;
    export let immobile: boolean = false;
    export let tip: string = "";
    export let variant: ChipVariant = "neutral";
</script>

<div class="chip {variant}" class:context class:target class:disconnected class:immobile title={tip}>
    <slot />
</div>

<style>
    .chip {
        pointer-events: auto;

        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeSm);

        height: 20px;
        line-height: 16px;

        display: flex;
        align-items: center;
        border: 1px solid transparent;
        border-radius: 10px;
        transition: background var(--ju-components-transitionFast);
        padding: 0 7px;
        white-space: nowrap;
        gap: 3px;

        --chip-bg: var(--ju-colors-surface);
        --chip-fg: var(--ju-colors-foreground);
        background: var(--chip-bg);
        color: var(--chip-fg);
    }

    .chip :global(.feather) {
        height: 12px;
        width: 12px;
        min-width: 12px;
    }

    .bookmark {
        --chip-bg: var(--ju-colors-chipBookmarkBg);
        --chip-fg: var(--ju-colors-chipBookmarkFg);
    }

    .wc {
        --chip-bg: var(--ju-colors-chipWcBg);
        --chip-fg: var(--ju-colors-chipWcFg);
    }

    .conflict {
        --chip-bg: var(--ju-colors-chipConflictBg);
        --chip-fg: var(--ju-colors-chipConflictFg);
    }

    .divergent {
        --chip-bg: var(--ju-colors-chipDivergentBg);
        --chip-fg: var(--ju-colors-chipDivergentFg);
    }

    .tag {
        --chip-bg: var(--ju-colors-chipTagBg);
        --chip-fg: var(--ju-colors-chipTagFg);
    }

    .remote {
        --chip-bg: var(--ju-colors-chipRemoteBg);
        --chip-fg: var(--ju-colors-chipRemoteFg);
        border-color: currentColor;
    }

    .immutable {
        --chip-bg: var(--ju-colors-chipImmutableBg);
        --chip-fg: var(--ju-colors-chipImmutableFg);
    }

    .context {
        color: inherit;
        border-color: currentColor;
    }

    .target {
        background: var(--ju-colors-selectionBackground);
        color: var(--ju-colors-selectionForeground);
    }

    .disconnected {
        border-color: currentColor;
        border-style: dashed;
    }
</style>
