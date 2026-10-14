<script lang="ts">
    import type { RevsResult } from "../messages/RevsResult";
    import ChangeObject from "../objects/ChangeObject.svelte";
    import Icon from "../controls/Icon.svelte";
    import Pane from "../shell/Pane.svelte";
    import { filesView, selectedFile, dragOverWidget } from "../stores";
    import { fuzzyMatch, listRows, mergeChanges, resolveSelection, toEntry, treeRows } from "./files";

    export let revs: Extract<RevsResult, { type: "Detail" }>;

    let filter = "";
    let filtering = false;
    let filterEl: HTMLInputElement;
    let collapsedDirs = new Set<string>();

    $: entries = mergeChanges(revs.changes, revs.conflicts).map(toEntry);
    $: paths = entries.map((e) => e.change.path.repo_path);
    $: selectedPath = resolveSelection($selectedFile, paths);
    $: visible = entries.filter((e) => fuzzyMatch(filter, e.change.path.relative_path));
    $: rows = $filesView == "tree" ? treeRows(visible, collapsedDirs) : listRows(visible);
    $: totalAdded = entries.reduce((n, e) => n + e.added, 0);
    $: totalRemoved = entries.reduce((n, e) => n + e.removed, 0);

    function toggleDir(path: string) {
        if (collapsedDirs.has(path)) collapsedDirs.delete(path);
        else collapsedDirs.add(path);
        collapsedDirs = collapsedDirs;
    }

    async function toggleFilter() {
        filtering = !filtering;
        if (filtering) {
            await Promise.resolve();
            filterEl?.focus();
        } else {
            filter = "";
        }
    }

    function onFilterKey(event: KeyboardEvent) {
        if (event.key == "Escape") {
            filtering = false;
            filter = "";
        }
    }
</script>

<Pane>
    <div slot="header" class="header">
        <div class="title">
            <span class="count">{entries.length} {entries.length == 1 ? "file" : "files"}</span>
            <span class="tools">
                <button
                    class="tool"
                    class:active={filtering}
                    title="filter files"
                    aria-pressed={filtering}
                    on:click={toggleFilter}>
                    <Icon name="search" />
                </button>
                <button
                    class="tool"
                    class:active={$filesView == "tree"}
                    title={$filesView == "tree" ? "show as list" : "show as tree"}
                    aria-pressed={$filesView == "tree"}
                    on:click={() => ($filesView = $filesView == "tree" ? "list" : "tree")}>
                    <Icon name={$filesView == "tree" ? "folder" : "list"} />
                </button>
            </span>
        </div>
        {#if filtering}
            <input
                class="filter"
                type="text"
                placeholder="Filter files"
                spellcheck="false"
                bind:this={filterEl}
                bind:value={filter}
                on:keydown={onFilterKey}
                on:dragenter={dragOverWidget}
                on:dragover={dragOverWidget} />
        {/if}
    </div>
    <div slot="body" class="body">
        {#if entries.length == 0}
            <div class="empty">No changes</div>
        {:else}
            <button
                class="all-files"
                class:selected={selectedPath == null}
                aria-pressed={selectedPath == null}
                on:click={() => selectedFile.set({ path: null })}>
                <Icon name="layers" />
                <span class="all-label">All files</span>
                {#if totalAdded > 0}<span class="added">+{totalAdded}</span>{/if}
                {#if totalRemoved > 0}<span class="removed">−{totalRemoved}</span>{/if}
            </button>
            {#each rows as row (row.type == "dir" ? `dir:${row.path}` : `file:${row.entry.change.path.repo_path}`)}
                {#if row.type == "dir"}
                    <button
                        class="dir-row"
                        style="padding-left: {6 + row.depth * 14}px"
                        aria-expanded={!row.collapsed}
                        on:click={() => toggleDir(row.path)}>
                        <span class="chevron" class:expanded={!row.collapsed}><Icon name="chevron-right" /></span>
                        <Icon name="folder" />
                        <span class="dir-name">{row.name}</span>
                        {#if row.added > 0}<span class="added">+{row.added}</span>{/if}
                        {#if row.removed > 0}<span class="removed">−{row.removed}</span>{/if}
                    </button>
                {:else}
                    <ChangeObject
                        entry={row.entry}
                        headers={revs.headers}
                        depth={row.depth}
                        showDir={$filesView == "list"}
                        selected={selectedPath == row.entry.change.path.repo_path} />
                {/if}
            {:else}
                <div class="empty">No matching files</div>
            {/each}
        {/if}
    </div>
</Pane>

<style>
    .header {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .title {
        display: flex;
        align-items: center;
        min-height: 22px;
        font-size: var(--ju-text-sizeSm);
        color: var(--ju-colors-foregroundSubtle);
    }

    .count {
        flex: 1;
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
        &.active {
            background: var(--ju-colors-surface);
            color: var(--ju-colors-foreground);
        }

        & :global(.feather) {
            height: 14px;
            width: 14px;
            min-width: 14px;
        }
    }

    .filter {
        pointer-events: auto;
        font-size: var(--ju-text-sizeSm);
    }

    .body {
        height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
    }

    .empty {
        padding: 12px 6px;
        color: var(--ju-colors-foregroundMuted);
        font-size: var(--ju-text-sizeSm);
    }

    .all-files,
    .dir-row {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 28px;
        width: 100%;
        border: none;
        margin: 0;
        padding: 0 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--ju-text-sizeSm);
        text-align: left;
        cursor: pointer;

        &:hover {
            background: var(--ju-colors-surface);
        }
    }

    .all-files {
        border-bottom: 1px solid var(--ju-colors-surface);

        &.selected {
            background: var(--ju-colors-selectionTint);
            box-shadow: inset 3px 0 0 var(--ju-colors-selectionBar);
        }
    }

    .all-label,
    .dir-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dir-row {
        color: var(--ju-colors-foregroundMuted);
    }

    .chevron {
        display: flex;
        transition: transform 150ms ease;

        &.expanded {
            transform: rotate(90deg);
        }

        & :global(.feather) {
            height: 12px;
            width: 12px;
            min-width: 12px;
        }
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
</style>
