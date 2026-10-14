<script lang="ts">
    import Icon from "./Icon.svelte";
    import type { Snippet } from "svelte";

    export let icon: string;
    export let label: string = "";
    export let tip: string = "";
    // without onClick, the body opens the dropdown
    export let onClick: ((e: MouseEvent) => void) | undefined = undefined;
    export let disabled: boolean = false;
    export let busy: boolean = false;
    export let pressed: boolean | undefined = undefined;
    export let dropdown: Snippet<[{ close: () => void }]> | undefined = undefined;

    let root: HTMLElement;
    let open = false;

    $: menuOnly = !onClick && !!dropdown;

    function onWindowClick(event: MouseEvent) {
        if (open && !root.contains(event.target as Node)) {
            open = false;
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (open && event.key === "Escape") {
            open = false;
        }
    }

    function close() {
        open = false;
    }

    function onBody(event: MouseEvent) {
        if (disabled) return;
        if (menuOnly) {
            open = !open;
        } else {
            onClick?.(event);
        }
    }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKeyDown} />

<div class="toolbar-action" class:split={dropdown && !menuOnly} bind:this={root}>
    <button
        class="body"
        class:busy
        class:icon-only={!label}
        disabled={disabled || busy}
        title={tip || label}
        aria-label={label || tip}
        aria-pressed={pressed}
        aria-haspopup={menuOnly ? "menu" : undefined}
        aria-expanded={menuOnly ? open : undefined}
        on:click|stopPropagation={onBody}>
        <span class="icon-slot"><Icon name={busy ? "loader" : icon} /></span>
        {#if label}
            <span class="label">{label}</span>
        {/if}
        {#if menuOnly}
            <span class="inline-chevron"><Icon name="chevron-down" /></span>
        {/if}
    </button>
    {#if dropdown && !menuOnly}
        <button
            class="chevron"
            aria-label="more {label || tip} options"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled || busy}
            on:click|stopPropagation={() => (open = !open)}>
            <Icon name="chevron-down" />
        </button>
    {/if}
    {#if open && dropdown}
        <div class="dropdown" role="menu">
            {@render dropdown({ close })}
        </div>
    {/if}
</div>

<style>
    .toolbar-action {
        position: relative;
        display: flex;
        align-items: center;
        pointer-events: auto;
    }

    button {
        display: flex;
        align-items: center;
        gap: 6px;
        height: var(--ju-components-buttonHeight);
        padding: 0 8px;

        background: transparent;
        border: none;
        border-radius: var(--ju-components-radiusSm);
        box-shadow: none;
        color: var(--ju-colors-foreground);
        font-family: var(--ju-text-familyUi);
        font-size: var(--ju-text-sizeMd);
        white-space: nowrap;
        cursor: pointer;
        transition: background var(--ju-components-transitionFast);
    }

    button:not(:disabled):hover,
    button[aria-expanded="true"],
    button[aria-pressed="true"] {
        background: var(--ju-colors-surfaceAlt);
    }

    button:disabled {
        color: var(--ju-colors-outlineStrong);
        cursor: default;
    }

    .body.busy {
        color: var(--ju-colors-foregroundMuted);
    }

    .body.icon-only {
        padding: 0 6px;
    }

    .split .body {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        padding-right: 4px;
    }

    .chevron {
        padding: 0 3px;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
    }

    .icon-slot {
        display: flex;
        align-items: center;
    }

    .busy .icon-slot {
        animation: spin 1.2s linear infinite;
    }

    .chevron :global(svg.feather),
    .inline-chevron :global(svg.feather) {
        width: 12px;
        height: 12px;
        min-width: 12px;
    }

    .inline-chevron {
        display: flex;
        color: var(--ju-colors-foregroundMuted);
    }

    .dropdown {
        position: absolute;
        top: calc(100% + 2px);
        left: 0;
        z-index: 100;
        pointer-events: auto;
        background: var(--ju-colors-background);
        border: 1px solid var(--ju-colors-surfaceStrong);
        border-radius: var(--ju-components-radiusSm);
        box-shadow: var(--ju-shadows-shadowMd);
        min-width: 160px;
        max-width: 480px;
        padding: 2px 0;
    }

    .dropdown :global(button) {
        width: 100%;
        height: auto;
        padding: 6px 12px;
        border-radius: 0;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dropdown :global(button:hover) {
        background: var(--ju-colors-surface);
    }

    .dropdown :global(hr) {
        margin: 2px 0;
        border: none;
        border-top: 1px solid var(--ju-colors-surfaceStrong);
    }

    .dropdown :global(.menu-heading) {
        display: block;
        padding: 4px 12px 2px;
        font-size: var(--ju-text-sizeXs);
        color: var(--ju-colors-foregroundMuted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
