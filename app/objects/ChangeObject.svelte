<script lang="ts">
    import type { RevHeader } from "../messages/RevHeader";
    import type { Operand } from "../messages/Operand";
    import type { ExternalDiff } from "../messages/ExternalDiff";
    import type { ExternalResolve } from "../messages/ExternalResolve";
    import type { FileEntry } from "../files/files";
    import { badge } from "../files/files";
    import Icon from "../controls/Icon.svelte";
    import ActionWidget from "../controls/ActionWidget.svelte";
    import Object from "./Object.svelte";
    import Zone from "./Zone.svelte";
    import { repoConfigEvent, selectedFile } from "../stores";
    import { mutate } from "../ipc";
    import ActionLink from "../controls/ActionLink.svelte";

    export let headers: RevHeader[] | null;
    export let entry: FileEntry;
    export let selected: boolean;
    export let showDir: boolean = true;
    export let depth: number = 0;

    $: change = entry.change;
    $: operand = (headers ? { type: "Change", headers, path: change.path, hunk: null } : null) as Operand | null;
    $: status = badge(change);

    $: hasDiffTool = $repoConfigEvent.type === "Workspace" && $repoConfigEvent.has_external_diff_tool;
    $: hasMergeTool = $repoConfigEvent.type === "Workspace" && $repoConfigEvent.has_external_merge_tool;

    function onSelect() {
        selectedFile.set({ path: change.path.repo_path });
    }

    function onExternalDiff() {
        if (!headers) return;
        mutate<ExternalDiff>("external_diff", {
            id: headers[0].id,
            path: change.path,
        });
    }

    function onExternalResolve() {
        if (!headers) return;
        mutate<ExternalResolve>("external_resolve", {
            id: headers[0].id,
            path: change.path,
        });
    }
</script>

<Object
    {operand}
    {selected}
    suffix={change.path.repo_path}
    conflicted={change.has_conflict}
    label={change.path.relative_path}
    on:click={onSelect}
    let:hint>
    <Zone {operand} let:target>
        <div class="layout" class:target style="padding-left: {6 + depth * 14}px">
            <span class="badge {status.state}">{status.symbol}</span>
            <span class="names">
                {#if hint}
                    <span class="name">{hint}</span>
                {:else}
                    <span class="name">{entry.name}</span>
                    {#if showDir && entry.dir}
                        <span class="dir">{entry.dir}</span>
                    {/if}
                {/if}
            </span>
            {#if entry.added > 0}<span class="added">+{entry.added}</span>{/if}
            {#if entry.removed > 0}<span class="removed">−{entry.removed}</span>{/if}
            {#if hasMergeTool && change.has_conflict && operand}
                <ActionWidget tip="resolve in merge tool" onClick={onExternalResolve}>
                    <Icon name="external-link" /> Resolve
                </ActionWidget>
            {:else if hasDiffTool && operand}
                <ActionLink tip="open in diff tool" onClick={onExternalDiff}>
                    <Icon name="external-link" />
                </ActionLink>
            {/if}
        </div>
    </Zone>
</Object>

<style>
    .layout {
        min-height: 30px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px 3px 6px;
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

    .names {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.25;
    }

    .name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dir {
        color: var(--ju-colors-foregroundMuted);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

    .layout.target {
        background: var(--ju-colors-accent);
        color: var(--ju-colors-foreground);
    }
</style>
