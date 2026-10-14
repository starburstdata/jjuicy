<script lang="ts" context="module">
    type Tab = "changes" | "history";
    // the pane remounts while a mutation re-queries the selection; the tab should survive that
    let remembered = { change: "", tab: "changes" as Tab };
    function remember(change: string, tab: Tab) {
        remembered = { change, tab };
    }
</script>

<script lang="ts">
    import type { RevsResult } from "../messages/RevsResult";
    import { ignoreToggled, selectedFile } from "../stores";
    import { mergeChanges, resolveSelection, toEntry } from "../files/files";
    import DiffViewer from "../diff/DiffViewer.svelte";
    import FileHeader from "../diff/FileHeader.svelte";
    import RevisionMutator from "../mutators/RevisionMutator";
    import Pane from "../shell/Pane.svelte";
    import { onEvent } from "../ipc";
    import RevisionHeader from "./RevisionHeader.svelte";
    import EvologView from "./EvologView.svelte";

    export let revs: Extract<RevsResult, { type: "Detail" }>;

    $: singleton = revs.set.from.commit.hex == revs.set.to.commit.hex;
    $: newest = revs.headers[0];
    $: mutator = new RevisionMutator(revs.headers, $ignoreToggled);

    $: syntheticChanges = mergeChanges(revs.changes, revs.conflicts);
    $: entries = syntheticChanges.map(toEntry);
    $: added = entries.reduce((n, e) => n + e.added, 0);
    $: removed = entries.reduce((n, e) => n + e.removed, 0);
    $: selectedPath = resolveSelection(
        $selectedFile,
        syntheticChanges.map((c) => c.path.repo_path),
    );
    $: shownChanges =
        selectedPath == null ? syntheticChanges : syntheticChanges.filter((c) => c.path.repo_path == selectedPath);

    // history is per-change, so ranges only have changes
    let tab: Tab = remembered.change == revs.set.from.change.hex ? remembered.tab : "changes";
    $: if (!singleton) tab = "changes";
    $: remember(revs.set.from.change.hex, tab);

    onEvent<string>("jjuicy://menu/revision", (event) => mutator.handle(event));
</script>

<Pane>
    <div slot="body" class="body">
        <RevisionHeader {revs} ignoreImmutable={$ignoreToggled} {added} {removed} />

        {#if singleton}
            <div class="tabs" role="tablist">
                <button role="tab" aria-selected={tab == "changes"} on:click={() => (tab = "changes")}>Changes</button>
                <button role="tab" aria-selected={tab == "history"} on:click={() => (tab = "history")}>History</button>
            </div>
        {/if}

        {#if tab == "history"}
            <EvologView header={newest} ignoreImmutable={$ignoreToggled} />
        {:else if syntheticChanges.length > 0}
            <div class="changes">
                {#each shownChanges as change (change.path.repo_path)}
                    <div class="change">
                        <FileHeader {change} header={singleton ? newest : null} />
                        <DiffViewer set={revs.set} {change} header={singleton ? newest : null} lazy={selectedPath == null} />
                    </div>
                {/each}
            </div>
        {:else}
            <div class="changes-header">
                <span>Changes: <span class="no-changes">(empty)</span></span>
            </div>
        {/if}
    </div>
</Pane>

<style>
    .body {
        height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        pointer-events: auto;
        scrollbar-color: var(--ctp-text) var(--ctp-crust);
        display: flex;
        flex-direction: column;
        margin: 0 -6px -3px -6px;
        padding: 0 6px 3px 6px;
        gap: 0;
    }

    .body::-webkit-scrollbar {
        width: 6px;
    }

    .body::-webkit-scrollbar-thumb {
        background-color: var(--ctp-text);
        border-radius: 6px;
    }

    .body::-webkit-scrollbar-track {
        background-color: var(--ctp-crust);
    }

    .tabs {
        display: flex;
        gap: 3px;
        padding: 3px 0;
        border-top: 1px solid var(--ju-colors-outline);
    }

    .tabs button {
        border: none;
        background: transparent;
        color: var(--ju-colors-foregroundMuted);
        font: inherit;
        font-size: 13px;
        padding: 2px 8px;
        border-radius: var(--ju-components-radiusSm);
        cursor: pointer;
    }

    .tabs button[aria-selected="true"] {
        color: inherit;
        background: var(--ju-colors-surfaceAlt);
    }

    .changes-header {
        border-top: 1px solid var(--ju-colors-outline);
        height: 30px;
        min-height: 30px;
        width: 100%;
        padding: 0 3px;
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--ju-colors-foregroundMuted);
        font-size: 13px;
    }

    .no-changes {
        color: var(--ju-colors-foregroundMuted);
    }

    .changes {
        border-top: 1px solid var(--ju-colors-outline);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
    }

    .change {
        font-size: small;
        margin: 0;
        pointer-events: auto;
    }
</style>
