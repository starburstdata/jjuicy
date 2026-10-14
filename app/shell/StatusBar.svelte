<script lang="ts">
    import IdSpan from "../controls/IdSpan.svelte";
    import { mutate } from "../ipc";
    import type { Operand } from "../messages/Operand";
    import type { UndoOperation } from "../messages/UndoOperation";
    import type { RichHint } from "../mutators/BinaryMutator";
    import BinaryMutator from "../mutators/BinaryMutator";
    import {
        ignoreToggled,
        currentSource,
        currentTarget,
        hasModal,
        logQueryRequest,
        repoConfigEvent,
        repoStatusEvent,
    } from "../stores";
    import { isTauri, trigger } from "../ipc";
    import ToggleWidget from "../controls/ToggleWidget.svelte";
    import BookmarkSpan from "../controls/BookmarkSpan.svelte";
    import Icon from "../controls/Icon.svelte";
    import { formatCount } from "./statusbar";

    export let target: boolean;

    let dropHint: RichHint | null = null;
    let maybe = false;

    $: setDropHint($currentSource, $currentTarget);
    $: if (isTauri()) trigger("set_modifier_state", { alt: $ignoreToggled });

    function setDropHint(source: Operand | null, target: Operand | null) {
        maybe = false;
        if (source) {
            let mutator = new BinaryMutator(source, target, $ignoreToggled);
            if (target) {
                let canDrop = mutator.canDrop();
                if (canDrop.type == "yes") {
                    dropHint = canDrop.hint;
                    return;
                } else if (canDrop.type == "maybe") {
                    dropHint = [canDrop.hint];
                    maybe = true;
                    return;
                }
            }

            let canDrag = mutator.canDrag();
            if (canDrag.type == "yes") {
                dropHint = canDrag.hint;
                return;
            }
        }

        dropHint = null;
    }

    $: summary = $repoStatusEvent?.summary ?? null;

    function onUndo() {
        mutate<UndoOperation>("undo_operation", null);
    }
</script>

{#if !dropHint}
    <div id="status-bar" class="repo-bar" inert={$hasModal}>
        <div class="substatus">
            <ToggleWidget tip="ignore immutability" bind:checked={$ignoreToggled} on="shield-off" off="shield" />
            <span id="status-workspace">
                {$repoConfigEvent?.type == "Workspace" ? $repoConfigEvent.absolute_path : "No workspace"}
            </span>
        </div>
        <div id="status-operation" class="substatus">
            {#if $repoConfigEvent?.type == "Workspace"}
                <!-- the operation log arrives in phase 4 -->
                <span class="operation" title="Last operation">
                    {$repoStatusEvent?.operation_description ?? "none"}
                </span>
                <button class="status-button" title="Undo latest operation" on:click={onUndo}>
                    <Icon name="rotate-ccw" />
                </button>
                {#if summary}
                    <button
                        class="status-button counter"
                        title="Working copy changes"
                        on:click={() => ($logQueryRequest = "@")}>
                        <Icon name="file-text" />
                        <span>{summary.wc_files} {summary.wc_files == 1 ? "file" : "files"}</span>
                        {#if summary.wc_added > 0}<span class="added">+{summary.wc_added}</span>{/if}
                        {#if summary.wc_removed > 0}<span class="removed">−{summary.wc_removed}</span>{/if}
                    </button>
                    {#if summary.divergent > 0}
                        <button
                            class="status-button counter warning"
                            title="Divergent changes"
                            on:click={() => ($logQueryRequest = "divergent()")}>
                            <Icon name="git-branch" />
                            <span>{formatCount(summary.divergent)} divergent</span>
                        </button>
                    {/if}
                    {#if summary.conflicted > 0}
                        <button
                            class="status-button counter conflict"
                            title="Conflicted revisions"
                            on:click={() => ($logQueryRequest = "conflicts()")}>
                            <Icon name="alert-triangle" />
                            <span>{formatCount(summary.conflicted)} conflicted</span>
                        </button>
                    {/if}
                {/if}
            {/if}
        </div>
    </div>
{:else}
    <div id="status-bar" class="drag-bar" class:target class:maybe>
        <div>
            {#each dropHint as run, i}
                {#if typeof run == "string"}
                    <span>{run}{i == dropHint.length - 1 ? "." : ""}</span>
                {:else if run.type == "LocalBookmark" || run.type == "RemoteBookmark"}
                    <span><BookmarkSpan ref={run} /></span>
                {:else}
                    <span><IdSpan id={run} />{i == dropHint.length - 1 ? "." : ""}</span>
                {/if}
            {/each}
        </div>
    </div>
{/if}

<style>
    #status-bar {
        grid-area: footer;
        padding: 0 6px;
        font-family: var(--ju-text-familyUi);
        font-size: var(--ju-text-sizeMd);
        gap: 6px;
        align-items: center;
    }

    .repo-bar {
        display: grid;
        grid-template-columns: 1fr auto;
    }

    .drag-bar {
        display: flex;
        justify-content: center;
    }

    .substatus {
        height: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }

    #status-operation {
        height: 100%;
        padding: 0 3px;
        justify-content: end;
        min-width: 0;
    }

    .operation {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 40vw;
        color: var(--ju-colors-foregroundMuted);
    }

    .status-button {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 6px;
        border: none;
        border-radius: var(--ju-components-radiusSm);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .status-button:hover {
        background: var(--ju-colors-surfaceAlt);
    }

    .added {
        color: var(--ju-colors-added);
    }

    .removed {
        color: var(--ju-colors-removed);
    }

    .warning {
        color: var(--ju-colors-warning);
    }

    .conflict {
        color: var(--ju-colors-conflict);
    }

    #status-workspace {
        white-space: nowrap;
    }

    .target {
        background: var(--ju-colors-accent);
        color: black;
    }

    .maybe {
        background: transparent;
        color: var(--ju-colors-highlight);
    }
</style>
