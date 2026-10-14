<script lang="ts">
    import type { RevHeader } from "../messages/RevHeader";
    import type { RevChangeSummary } from "../messages/RevChangeSummary";
    import type { ExternalDiff } from "../messages/ExternalDiff";
    import { badge, splitPath } from "../files/files";
    import Icon from "../controls/Icon.svelte";
    import { annotateOn, diffMode, repoConfigEvent } from "../stores";
    import { mutate } from "../ipc";

    export let change: RevChangeSummary;
    // the revision to open in an external diff tool, if any
    export let header: RevHeader | null;

    $: status = badge(change);
    $: [dir, name] = splitPath(change.path.relative_path);
    $: hasDiffTool = $repoConfigEvent.type === "Workspace" && $repoConfigEvent.has_external_diff_tool;

    let copied = false;

    function onCopy() {
        navigator.clipboard?.writeText(change.path.relative_path);
        copied = true;
        setTimeout(() => (copied = false), 1200);
    }

    function onExternalDiff() {
        if (!header) return;
        mutate<ExternalDiff>("external_diff", { id: header.id, path: change.path });
    }
</script>

<div class="file-header">
    <span class="badge {status.state}">{status.symbol}</span>
    <span class="path" title={change.path.relative_path}>
        {#if change.old_path}
            <span class="dir">{change.old_path.relative_path} →</span>
        {/if}
        {#if dir}<span class="dir">{dir}/</span>{/if}<span class="name">{name}</span>
    </span>
    <button class="tool" title={copied ? "copied" : "copy path"} on:click={onCopy}>
        <Icon name={copied ? "check" : "copy"} />
    </button>
    <span class="spacer"></span>
    {#if change.added > 0}<span class="added">+{change.added}</span>{/if}
    {#if change.removed > 0}<span class="removed">−{change.removed}</span>{/if}
    <span class="tools">
        <button
            class="tool"
            title="unified diff"
            aria-pressed={$diffMode == "unified"}
            on:click={() => diffMode.set("unified")}>
            <Icon name="align-justify" />
        </button>
        <button class="tool" title="split diff" aria-pressed={$diffMode == "split"} on:click={() => diffMode.set("split")}>
            <Icon name="columns" />
        </button>
        {#if header && change.kind != "Deleted" && !change.binary}
            <button
                class="tool annotate"
                title="annotate lines with the change that introduced them"
                aria-pressed={$annotateOn}
                on:click={() => annotateOn.update((on) => !on)}>
                <Icon name="user" />
            </button>
        {/if}
        {#if hasDiffTool && header}
            <button class="tool" title="open in diff tool" on:click={onExternalDiff}>
                <Icon name="external-link" />
            </button>
        {/if}
    </span>
</div>

<style>
    .file-header {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        min-height: 30px;
        box-sizing: border-box;
        background: var(--ju-colors-surface);
        border-bottom: 1px solid var(--ju-colors-outline);
        font-size: var(--ju-text-sizeSm);
    }

    .badge {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--ju-text-familyCode);
        font-weight: bold;
        font-size: 11px;
    }

    .badge.add {
        color: var(--ju-colors-added);
        background: color-mix(in srgb, var(--ju-colors-added) 18%, transparent);
    }

    .badge.remove {
        color: var(--ju-colors-removed);
        background: color-mix(in srgb, var(--ju-colors-removed) 18%, transparent);
    }

    .badge.change {
        color: var(--ju-colors-modified);
        background: color-mix(in srgb, var(--ju-colors-modified) 18%, transparent);
    }

    .badge.conflict {
        color: var(--ju-colors-conflict);
        background: color-mix(in srgb, var(--ju-colors-conflict) 18%, transparent);
    }

    .path {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--ju-text-familyCode);
        user-select: text;
    }

    .dir {
        color: var(--ju-colors-foregroundMuted);
    }

    .name {
        font-weight: 600;
    }

    .spacer {
        flex: 1;
    }

    .added,
    .removed {
        flex: none;
        font-family: var(--ju-text-familyCode);
        font-size: 11px;
    }

    .added {
        color: var(--ju-colors-added);
    }

    .removed {
        color: var(--ju-colors-removed);
    }

    .tools {
        display: flex;
        gap: 2px;
    }

    .tool {
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: inherit;
        padding: 2px;
        border-radius: 4px;
        cursor: pointer;

        &:hover,
        &[aria-pressed="true"] {
            background: var(--ju-colors-background);
        }

        :global(.feather) {
            width: 14px;
            height: 14px;
            min-width: 14px;
        }
    }
</style>
