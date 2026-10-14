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
    // icon above a small label, filling the toolbar's height
    export let stacked: boolean = false;
    // replaces the icon with a rounded value box, like a macos toolbar popup
    export let pill: Snippet | undefined = undefined;

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

<div class="toolbar-action" class:split={dropdown && !menuOnly} class:stacked bind:this={root}>
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
        {#if pill}
            <span class="pill">
                <Icon name={icon} />
                <span class="pill-value">{@render pill()}</span>
                {#if menuOnly}
                    <span class="inline-chevron"><Icon name="chevron-down" /></span>
                {/if}
            </span>
        {:else}
            <span class="icon-slot"><Icon name={busy ? "loader" : icon} /></span>
        {/if}
        {#if label}
            <span class="label">{label}</span>
        {/if}
        {#if menuOnly && !pill}
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
            <span class="chevron-slot"><Icon name="chevron-down" /></span>
        </button>
    {/if}
    {#if open && dropdown}
        <!-- the header is a window drag region; menu padding and headings shouldn't drag -->
        <div class="dropdown" role="menu" data-tauri-drag-region="false">
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

    /* a tint rather than a surface token, which can match the toolbar's own background */
    button:not(:disabled):hover,
    button[aria-expanded="true"] {
        background: color-mix(in srgb, currentColor 7%, transparent);
    }

    button[aria-pressed="true"] {
        background: color-mix(in srgb, currentColor 11%, transparent);
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

    .stacked {
        align-self: stretch;
    }

    /* like a macos toolbar, only the icon gets a highlight; the label stays plain */
    .stacked > button {
        flex-direction: column;
        justify-content: flex-start;
        gap: 2px;
        height: auto;
        padding: 2px 0 0;
        color: var(--ju-colors-foregroundMuted);
        background: transparent !important;
    }

    .stacked .body {
        min-width: 52px;
    }

    .stacked .icon-slot,
    .stacked .chevron-slot,
    .stacked .pill {
        height: 24px;
        border-radius: var(--ju-components-radiusSm);
        transition: background var(--ju-components-transitionFast);
    }

    .stacked .icon-slot {
        justify-content: center;
        align-self: stretch;
        min-width: 48px;
        margin: 0 2px;
    }

    .stacked .chevron-slot {
        display: flex;
        align-items: center;
        padding: 0 3px;
    }

    .stacked .body :global(svg.feather) {
        width: 18px;
        height: 18px;
        min-width: 18px;
        stroke-width: 1.6;
    }

    .stacked .label {
        padding: 0 4px;
        font-size: var(--ju-text-sizeXs);
        line-height: var(--ju-text-lineHeightTight);
    }

    .stacked > button:not(:disabled):hover > span:first-child,
    .stacked > button[aria-expanded="true"] > span:first-child {
        background: color-mix(in srgb, currentColor 10%, transparent);
    }

    .stacked > button[aria-pressed="true"] .icon-slot {
        background: color-mix(in srgb, currentColor 14%, transparent);
    }

    .stacked > button[aria-pressed="true"]:not(:disabled):hover .icon-slot {
        background: color-mix(in srgb, currentColor 18%, transparent);
    }

    .stacked > button:disabled {
        color: var(--ju-colors-foregroundFaint);
    }

    /* the icon and chevron read as one split control */
    .stacked.split .body {
        padding-right: 0;
    }

    .stacked.split .icon-slot {
        margin-right: 0;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
    }

    .stacked .chevron {
        padding-right: 2px;
    }

    .stacked .chevron-slot {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
    }

    .pill {
        display: flex;
        align-items: center;
        gap: 5px;
        max-width: 240px;
        padding: 0 6px 0 8px;
        border-radius: var(--ju-components-radiusSm);
        background: color-mix(in srgb, currentColor 7%, transparent);
        color: var(--ju-colors-foreground);
        font-size: var(--ju-text-sizeSm);
    }

    .stacked .pill :global(svg.feather) {
        width: 14px;
        height: 14px;
        min-width: 14px;
        stroke-width: 2;
    }

    .body:not(:disabled):hover .pill,
    .body[aria-expanded="true"] .pill {
        background: color-mix(in srgb, currentColor 13%, transparent) !important;
    }

    .pill-value {
        display: flex;
        gap: 4px;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
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

    /* the svg rather than the slot, which carries the highlight */
    .busy .icon-slot :global(svg) {
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

    /* matches the bookmarks dropdown in the log column */
    .dropdown {
        position: absolute;
        top: calc(100% + 2px);
        left: 0;
        z-index: 100;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        min-width: 200px;
        max-width: 480px;
        max-height: 60vh;
        overflow-y: auto;
        padding: 3px 4px;
        background: var(--ju-colors-background);
        border: 1px solid var(--ju-colors-surfaceStrong);
        border-radius: var(--ju-components-radiusSm);
        box-shadow: var(--ju-shadows-shadowMd);
        color: var(--ju-colors-foreground);
        font-size: var(--ju-text-sizeSm);
    }

    .dropdown :global(button) {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        height: auto;
        min-height: 24px;
        padding: 0 6px;
        /* items come from the caller's snippet, so they miss this component's button reset */
        background: transparent;
        border: none;
        border-radius: 4px;
        box-shadow: none;
        color: var(--ju-colors-foreground);
        font-family: var(--ju-text-familyUi);
        font-size: var(--ju-text-sizeSm);
        text-align: left;
        cursor: pointer;
    }

    .dropdown :global(button svg.feather) {
        width: 14px;
        height: 14px;
        min-width: 14px;
        color: var(--ju-colors-foregroundSubtle);
    }

    .dropdown :global(button .text) {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dropdown :global(button:hover) {
        background: color-mix(in srgb, currentColor 8%, transparent);
    }

    .dropdown :global(hr) {
        margin: 3px 2px;
        border: none;
        border-top: 1px solid var(--ju-colors-surfaceAlt);
    }

    .dropdown :global(.menu-heading) {
        display: block;
        margin: 4px 6px 2px;
        font-size: var(--ju-text-sizeXs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--ju-colors-foregroundSubtle);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
