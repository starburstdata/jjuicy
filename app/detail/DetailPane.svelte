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

    onEvent<string>("jjuicy://menu/revision", (event) => mutator.handle(event));
</script>

<Pane>
    <div slot="body" class="body">
        <RevisionHeader {revs} ignoreImmutable={$ignoreToggled} {added} {removed} />

        {#if syntheticChanges.length > 0}
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
