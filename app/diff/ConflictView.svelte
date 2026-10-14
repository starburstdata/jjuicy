<script lang="ts">
    import type { ConflictBlocks } from "../messages/ConflictBlocks";
    import type { ConflictSide } from "../messages/ConflictSide";
    import type { RevHeader } from "../messages/RevHeader";
    import type { TreePath } from "../messages/TreePath";
    import type { ExternalResolve } from "../messages/ExternalResolve";
    import type { ResolveConflictSide } from "../messages/ResolveConflictSide";
    import { mutate } from "../ipc";
    import { ignoreToggled, repoConfigEvent } from "../stores";

    export let blocks: ConflictBlocks;
    export let path: TreePath;
    // non-null only when the conflict belongs to a single revision that can be rewritten
    export let header: RevHeader | null;

    // resolved stretches longer than this are folded to their edges
    const FOLD_ABOVE = 8;
    const FOLD_EDGE = 3;

    type Block = { kind: "side" | "base"; side: ConflictSide; index: number };

    let unfolded = new Set<number>();

    $: hasMergeTool = $repoConfigEvent.type === "Workspace" && $repoConfigEvent.has_external_merge_tool;
    $: first = blocks.regions.find((r) => r.type == "Conflict");
    $: sideLabels = first?.type == "Conflict" ? first.sides.map((s) => s.label) : [];

    // jj's order: side, base, side, base, side...
    function interleave(sides: ConflictSide[], bases: ConflictSide[]): Block[] {
        let result: Block[] = [];
        sides.forEach((side, i) => {
            result.push({ kind: "side", side, index: i });
            if (bases[i]) result.push({ kind: "base", side: bases[i], index: i });
        });
        return result;
    }

    // context is only worth keeping on the edges that touch a conflict
    function foldEdges(r: number): [number, number] {
        return [r == 0 ? 0 : FOLD_EDGE, r == blocks.regions.length - 1 ? 0 : FOLD_EDGE];
    }

    function unfold(index: number) {
        unfolded = new Set(unfolded).add(index);
    }

    function accept(side: number) {
        if (!header) return;
        mutate<ResolveConflictSide>("resolve_conflict_side", { id: header.id, path, side }, { ignoreImmutable: $ignoreToggled });
    }

    function openResolver() {
        if (!header) return;
        mutate<ExternalResolve>("external_resolve", { id: header.id, path });
    }
</script>

<div class="conflict-view">
    {#if header}
        <div class="actions">
            {#if hasMergeTool}
                <button on:click={openResolver}>Open in merge tool</button>
            {/if}
            {#each sideLabels as label, i}
                <button title="resolve the whole file using this side" on:click={() => accept(i)}>Accept {label}</button>
            {/each}
        </div>
    {/if}
    {#each blocks.regions as region, r}
        {#if region.type == "Resolved"}
            {#if region.lines.length > FOLD_ABOVE && !unfolded.has(r)}
                {@const [head, tail] = foldEdges(r)}
                {#each region.lines.slice(0, head) as line}
                    <div class="line">{line}</div>
                {/each}
                <button class="fold" title="show all resolved lines" on:click={() => unfold(r)}>
                    ⋯ {region.lines.length - head - tail} resolved lines
                </button>
                {#each region.lines.slice(region.lines.length - tail) as line}
                    <div class="line">{line}</div>
                {/each}
            {:else}
                {#each region.lines as line}
                    <div class="line">{line}</div>
                {/each}
            {/if}
        {:else}
            <div class="conflict">
                {#each interleave(region.sides, region.bases) as block}
                    <div class="block {block.kind} side-{block.index % 2}">
                        <div class="label">{block.kind == "side" ? "◆" : "◇"} {block.side.label}</div>
                        {#each block.side.lines as line}
                            <div class="line">{line}</div>
                        {:else}
                            <div class="line empty">(empty)</div>
                        {/each}
                    </div>
                {/each}
            </div>
        {/if}
    {/each}
</div>

<style>
    .conflict-view {
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeMd);
        background: var(--ju-colors-background);
        user-select: text;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px;
        font-family: var(--ju-text-familyUi);
        border-bottom: 1px solid var(--ju-colors-outline);
    }

    .actions button {
        border: 1px solid var(--ju-colors-outline);
        border-radius: 4px;
        background: var(--ju-colors-surface);
        color: var(--ju-colors-foreground);
        font-size: var(--ju-text-sizeSm);
        padding: 2px 8px;
        cursor: pointer;
        max-width: 40ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover {
            border-color: var(--ju-colors-accent);
        }
    }

    .line {
        white-space: pre;
        tab-size: 4;
        min-height: 22px;
        line-height: 22px;
        padding-left: 1ch;
    }

    .empty {
        color: var(--ju-colors-foregroundMuted);
        font-style: italic;
    }

    .fold {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        border-top: 1px solid var(--ju-colors-outline);
        border-bottom: 1px solid var(--ju-colors-outline);
        background: color-mix(in srgb, var(--ju-colors-accent) 6%, var(--ju-colors-background));
        color: var(--ju-colors-foregroundMuted);
        font: inherit;
        font-size: var(--ju-text-sizeSm);
        height: 22px;
        cursor: pointer;
    }

    .conflict {
        margin: 4px 0;
        border-left: 3px solid var(--ju-colors-conflict);
    }

    .label {
        font-size: var(--ju-text-sizeSm);
        padding: 1px 1ch;
        color: var(--ju-colors-foregroundMuted);
        border-bottom: 1px solid var(--ju-colors-outline);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .side.side-0 {
        background: var(--ju-colors-diffAddBg);
    }

    .side.side-1 {
        background: color-mix(in srgb, var(--ju-colors-accent) 12%, var(--ju-colors-background));
    }

    .base {
        background: var(--ju-colors-surface);
        color: var(--ju-colors-foregroundMuted);
    }
</style>
