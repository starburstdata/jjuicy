<script lang="ts">
    import type { RevsResult } from "../messages/RevsResult";
    import { ignoreToggled, selectedFile } from "../stores";
    import { mergeChanges, resolveSelection, toEntry } from "../files/files";
    import HunkObject from "../objects/HunkObject.svelte";
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

    function lineColour(line: string): string | null {
        if (line.startsWith("+")) {
            return "add";
        } else if (line.startsWith("-")) {
            return "remove";
        } else {
            return null;
        }
    }

    interface DiffSegment {
        conflict: boolean;
        lines: string[];
    }

    function segmentHunk(hunkLines: string[]): DiffSegment[] {
        let segments: DiffSegment[] = [];
        let current: DiffSegment = { conflict: false, lines: [] };

        for (let line of hunkLines) {
            if (line.startsWith(" <<<<<<< ")) {
                if (current.lines.length > 0) segments.push(current);
                current = { conflict: true, lines: [line] };
            } else if (line.startsWith(" >>>>>>> ")) {
                current.lines.push(line);
                segments.push(current);
                current = { conflict: false, lines: [] };
            } else {
                current.lines.push(line);
            }
        }
        if (current.lines.length > 0) segments.push(current);
        return segments;
    }

    function isConflictMarker(line: string): boolean {
        return (
            line.startsWith(" <<<<<<< ") ||
            line.startsWith(" >>>>>>> ") ||
            line.startsWith(" +++++++ ")
        );
    }
</script>

<Pane>
    <div slot="body" class="body">
        <RevisionHeader {revs} ignoreImmutable={$ignoreToggled} {added} {removed} />

        {#if syntheticChanges.length > 0}
            <div class="changes">
                {#each shownChanges as change (change.path.repo_path)}
                    <div class="change">
                        <div class="change-path">{change.path.relative_path}</div>
                        {#each change.hunks as hunk}
                            <div class="hunk">
                                <HunkObject
                                    header={!change.has_conflict && singleton ? newest : null}
                                    path={change.path}
                                    {hunk} />
                            </div>
                            <pre class="diff">{#each segmentHunk(hunk.lines.lines) as segment}{#if segment.conflict}<span class="conflict-region">{#each segment.lines as line}{#if isConflictMarker(line)}<span class="conflict-marker">{line}</span>{:else}<span class={lineColour(line)}
                                        >{line}</span
                                    >{/if}{/each}</span>{:else}{#each segment.lines as line}<span class={lineColour(line)}
                                        >{line}</span
                                    >{/each}{/if}{/each}</pre>
                        {/each}
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

    .change-path {
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeMd);
        color: var(--ju-colors-foregroundMuted);
        padding: 3px 6px;
        user-select: text;
        background: var(--ju-colors-surface);
        border-bottom: 1px solid var(--ju-colors-outline);
        word-break: break-all;
    }

    .hunk {
        margin: 0;
        text-align: center;
        background: var(--ju-colors-surface);
    }

    .diff {
        margin: 0;
        background: var(--ju-colors-background);
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeMd);
        user-select: text;
    }

    .add {
        color: var(--ju-colors-added);
    }

    .remove {
        color: var(--ju-colors-removed);
    }

    .conflict-region {
        display: block;
        background: repeating-linear-gradient(
            120deg,
            transparent 0px,
            transparent 12px,
            var(--ctp-surface0) 12px,
            var(--ctp-surface0) 15px
        );
    }

    .conflict-marker {
        color: var(--ctp-overlay0);
    }
</style>
