<script lang="ts">
    import type { RevsResult } from "../messages/RevsResult";
    import type { RevHeader } from "../messages/RevHeader";
    import type { ChangeId } from "../messages/ChangeId";
    import type { CommitId } from "../messages/CommitId";
    import RevisionMutator from "../mutators/RevisionMutator";
    import { dragOverWidget, revisionSelectEvent } from "../stores";
    import ActionWidget from "../controls/ActionWidget.svelte";
    import AuthorSpan from "../controls/AuthorSpan.svelte";
    import Avatar from "../controls/Avatar.svelte";
    import Chip from "../controls/Chip.svelte";
    import Icon from "../controls/Icon.svelte";
    import IdSpan from "../controls/IdSpan.svelte";
    import SetSpan from "../controls/SetSpan.svelte";
    import TimestampSpan from "../controls/TimestampSpan.svelte";
    import TimestampRangeSpan from "../controls/TimestampRangeSpan.svelte";
    import Object from "../objects/Object.svelte";
    import Zone from "../objects/Zone.svelte";
    import ActionRow from "./ActionRow.svelte";

    export let revs: Extract<RevsResult, { type: "Detail" }>;
    export let ignoreImmutable: boolean;
    export let added: number;
    export let removed: number;

    // headers are in descendant-first order
    $: singleton = revs.set.from.commit.hex == revs.set.to.commit.hex;
    $: newest = revs.headers[0];
    $: oldest = revs.headers[revs.headers.length - 1];
    $: locked = newest.is_immutable && !ignoreImmutable;
    $: mutator = new RevisionMutator(revs.headers, ignoreImmutable);

    $: lines = oldest.description.lines;
    $: title = lines[0] ?? "";
    $: body = trimBody(lines.slice(1));

    function trimBody(rest: string[]): string {
        let start = rest.findIndex((l) => l.trim() != "");
        return start == -1 ? "" : rest.slice(start).join("\n").trimEnd();
    }

    // reset editor state when the selection moves, not when the same revision is re-queried
    let selectionKey = "";
    let editing = false;
    let expanded = false;
    let editableDescription = "";
    let originalDescription = "";
    let resetAuthor = false;
    $: {
        let key = `${revs.set.from.commit.hex}::${revs.set.to.commit.hex}`;
        if (key != selectionKey) {
            selectionKey = key;
            editing = false;
            expanded = false;
            resetAuthor = false;
        }
    }
    $: if (!editing) {
        originalDescription = lines.join("\n");
        editableDescription = originalDescription;
    }
    $: descriptionChanged = originalDescription !== editableDescription;

    function describe() {
        mutator.onDescribe(editableDescription, resetAuthor);
        editing = false;
    }

    function onEditorKey(ev: KeyboardEvent) {
        if (ev.key == "Enter" && (ev.metaKey || ev.ctrlKey)) {
            if (descriptionChanged) describe();
        } else if (ev.key == "Escape") {
            editing = false;
        }
    }

    function focus(el: HTMLTextAreaElement) {
        el.focus();
    }

    function copy(id: ChangeId | CommitId) {
        navigator.clipboard?.writeText(id.type == "ChangeId" ? id.prefix + id.rest : id.hex);
    }

    function selectParent(parent: RevHeader) {
        revisionSelectEvent.set({ from: parent.id, to: parent.id });
    }

    // grouped authors for range mode
    $: firstTimestamp = new Date(
        Math.min(...revs.headers.map((h) => new Date(h.author.timestamp).getTime())),
    ).toISOString();
    $: lastTimestamp = new Date(
        Math.max(...revs.headers.map((h) => new Date(h.author.timestamp).getTime())),
    ).toISOString();
    $: authors = [...new Map(revs.headers.map((h) => [h.author.email, h.author])).values()];
</script>

<div class="header">
    {#if singleton}
        <div class="title-row">
            <h2 class="title" class:indescribable={title == ""}>{title == "" ? "(no description set)" : title}</h2>
            <button
                class="tool"
                class:active={editing}
                title={locked ? "immutable revisions can't be described" : "edit description"}
                aria-pressed={editing}
                disabled={locked}
                on:click={() => (editing = !editing)}>
                <Icon name="edit-3" />
                <span>Edit</span>
            </button>
        </div>

        {#if editing}
            <textarea
                class="description"
                spellcheck="false"
                bind:value={editableDescription}
                use:focus
                on:dragenter={dragOverWidget}
                on:dragover={dragOverWidget}
                on:keydown={onEditorKey}></textarea>
            <div class="describe-commands">
                <label class="reset-author-label">
                    <input type="checkbox" bind:checked={resetAuthor} />
                    Reset author
                </label>
                <ActionWidget secondary tip="discard changes" onClick={() => (editing = false)}>Cancel</ActionWidget>
                <ActionWidget tip="set commit message (⌘↩)" onClick={describe} disabled={!descriptionChanged}>
                    Describe
                </ActionWidget>
            </div>
        {:else if body != ""}
            <div class="body" class:clamped={!expanded}>{body}</div>
            {#if body.split("\n").length > 3}
                <button class="more" on:click={() => (expanded = !expanded)}>
                    {expanded ? "show less" : "show more"}
                </button>
            {/if}
        {/if}

        <div class="meta">
            <span class="meta-item">
                <Avatar author={newest.author} size={18} />
                <AuthorSpan author={newest.author} />
            </span>
            <span class="meta-item">
                <IdSpan selectable id={newest.id.change} />
                <button class="copy" title="copy change id" on:click={() => copy(newest.id.change)}>
                    <Icon name="copy" />
                </button>
            </span>
            <span class="meta-item">
                <IdSpan selectable id={newest.id.commit} />
                <button class="copy" title="copy commit id" on:click={() => copy(newest.id.commit)}>
                    <Icon name="copy" />
                </button>
            </span>
            <span class="meta-item muted"><TimestampSpan timestamp={newest.author.timestamp} /></span>
            <span class="stat">
                <span class="added">+{added}</span>
                <span class="removed">−{removed}</span>
            </span>
        </div>

        {#if newest.is_working_copy || newest.is_immutable || newest.has_conflict || newest.id.change.is_divergent}
            <div class="flags">
                {#if newest.is_working_copy}
                    <Chip context={false} target={false} variant="wc">Working copy</Chip>
                {/if}
                {#if newest.is_immutable}
                    <Chip context={false} target={false} variant="immutable">Immutable</Chip>
                {/if}
                {#if newest.has_conflict}
                    <Chip context={false} target={false} variant="conflict">Conflict</Chip>
                {/if}
                {#if newest.id.change.is_divergent}
                    <Chip context={false} target={false} variant="divergent">Divergent</Chip>
                {/if}
            </div>
        {/if}
    {:else}
        <div class="title-row">
            <h2 class="title">{revs.headers.length} revisions</h2>
        </div>
        <div class="meta">
            <span class="meta-item"><SetSpan selectable set={revs.set} /></span>
            <span class="meta-item">
                {#each authors as author, ix}
                    <!-- prettier-ignore -->
                    <AuthorSpan {author} />{#if ix < authors.length - 1},&nbsp;{/if}
                {/each}
            </span>
            <span class="meta-item muted"><TimestampRangeSpan from={firstTimestamp} to={lastTimestamp} /></span>
            <span class="stat">
                <span class="added">+{added}</span>
                <span class="removed">−{removed}</span>
            </span>
        </div>
        <!-- prettier-ignore -->
        <div class="description-list">{#each revs.headers as header, i}{#if i > 0}<hr class="description-divider" />{/if}<div class="description-row">{header.description.lines.join("\n")}</div>{/each}</div>
    {/if}

    {#if revs.parents.length > 0}
        <Zone operand={{ type: "Merge", header: oldest }} let:target>
            <div class="parents" class:target>
                <span class="parents-label">{revs.parents.length == 1 ? "Parent" : "Parents"}</span>
                {#each revs.parents as parent (parent.id.commit.hex)}
                    <Object
                        operand={{ type: "Parent", header: parent, child: oldest }}
                        label={parent.description.lines[0]}
                        conflicted={parent.has_conflict}
                        on:click={() => selectParent(parent)}
                        let:context
                        let:hint>
                        <Chip {context} target={false} tip={parent.description.lines[0]}>
                            <IdSpan id={parent.id.change} pronoun={context} />
                            <span class="parent-desc">
                                {hint ?? (parent.description.lines[0] || "(no description set)")}
                            </span>
                        </Chip>
                    </Object>
                {/each}
            </div>
        </Zone>
    {/if}

    <ActionRow headers={revs.headers} {ignoreImmutable} />
</div>

<style>
    .header {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px 0;
        font-family: var(--ju-text-familyUi);
    }

    .title-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }

    .title {
        flex: 1;
        margin: 0;
        font-size: 17px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--ju-colors-foreground);
        user-select: text;
        pointer-events: auto;
        overflow-wrap: anywhere;
    }

    .indescribable {
        color: var(--ju-colors-foregroundSubtle);
        font-style: italic;
        font-weight: 400;
    }

    .tool,
    .more,
    .copy {
        pointer-events: auto;
        border: none;
        background: transparent;
        color: var(--ju-colors-foregroundSubtle);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ju-text-sizeSm);
        border-radius: 4px;
    }

    .tool {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;

        &:hover:not(:disabled),
        &.active {
            background: var(--ju-colors-surface);
            color: var(--ju-colors-foreground);
        }

        &:disabled {
            cursor: default;
            opacity: 0.45;
        }

        & :global(.feather) {
            height: 13px;
            width: 13px;
            min-width: 13px;
        }
    }

    .more {
        align-self: flex-start;
        padding: 0;
        color: var(--ju-colors-accent);
    }

    .copy {
        display: flex;
        padding: 1px;

        &:hover {
            color: var(--ju-colors-foreground);
        }

        & :global(.feather) {
            height: 12px;
            width: 12px;
            min-width: 12px;
        }
    }

    .body {
        white-space: pre-wrap;
        user-select: text;
        pointer-events: auto;
        font-size: var(--ju-text-sizeMd);
        color: var(--ju-colors-foregroundMuted);
        overflow-wrap: anywhere;
    }

    .clamped {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .description {
        resize: vertical;
        min-height: 90px;
        font-size: var(--ju-text-sizeMd);
    }

    .describe-commands {
        display: flex;
        align-items: center;
        justify-content: end;
        gap: 6px;
    }

    .reset-author-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--ju-colors-foregroundMuted);
        cursor: pointer;
        user-select: none;
        pointer-events: auto;
        margin-right: auto;
    }

    .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        font-size: var(--ju-text-sizeSm);
    }

    .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        pointer-events: auto;
        user-select: text;
    }

    .muted {
        color: var(--ju-colors-foregroundSubtle);
    }

    .stat {
        margin-left: auto;
        display: flex;
        gap: 6px;
        font-family: var(--ju-text-familyCode);
    }

    .added {
        color: var(--ju-colors-added);
    }

    .removed {
        color: var(--ju-colors-removed);
    }

    .flags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .parents {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 2px;
        border-radius: 6px;
        font-size: var(--ju-text-sizeSm);
    }

    .parents > :global(button) {
        width: auto;
    }

    .parents-label {
        color: var(--ju-colors-foregroundSubtle);
        margin-right: 2px;
    }

    .parent-desc {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--ju-text-familyUi);
    }

    .description-list {
        max-height: 150px;
        overflow: auto;
        pointer-events: auto;
        white-space: pre-wrap;
        user-select: text;
        font-size: var(--ju-text-sizeMd);
        color: var(--ju-colors-foregroundMuted);
    }

    .description-divider {
        border: none;
        border-top: 1px dashed var(--ju-colors-outline);
        margin: 4px 1px;
    }

    .target {
        color: var(--ju-colors-primaryContent);
        background: var(--ju-colors-primary);
    }
</style>
