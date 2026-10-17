<script lang="ts">
    import type { BookmarkEntry } from "../messages/BookmarkEntry";
    import type { DeleteRefs } from "../messages/DeleteRefs";
    import type { RevHeader } from "../messages/RevHeader";
    import { mutate, query } from "../ipc";
    import { currentConfirmation, repoStatusEvent } from "../stores";
    import BookmarkObject from "../objects/BookmarkObject.svelte";
    import {
        GROUP_TITLES,
        absentTargets,
        groupBookmarks,
        localCount,
        mergedTargets,
        refLabel,
        type BookmarkGroup,
        type BookmarkRef,
    } from "./bookmarks";

    // commit hexes currently loaded in the log; a closure wouldn't re-run when the log reloads
    export let loaded: ReadonlyMap<string, unknown> | ReadonlySet<string>;
    export let onReveal: (header: RevHeader) => void;
    export let onShowInLog: (header: RevHeader) => void;
    export let count = 0;
    // closed, status changes only mark the list stale: query_bookmarks shares the worker
    // with query_log and can take long enough on big repos to blank the log after every mutation
    export let open = true;
    // held off until the log's first load: queued ahead of query_log/query_revisions on
    // the worker, query_bookmarks delays the first paint and the detail pane
    export let ready = true;

    const GROUPS: BookmarkGroup[] = ["local", "tracked", "untracked"];

    let entries: BookmarkEntry[] = [];
    let error: string | null = null;

    $: groups = groupBookmarks(entries);
    $: count = localCount(entries);
    $: merged = mergedTargets(entries);
    $: absent = absentTargets(entries);

    let lastStatusKey: string | null = null;
    let stale = false;
    $: statusKey = JSON.stringify($repoStatusEvent ?? null);
    $: if (ready && statusKey !== lastStatusKey) {
        // with no count the toggle is hidden, so there'd be no way to open it
        let first = lastStatusKey === null;
        lastStatusKey = statusKey;
        if (first || open || count == 0) load();
        else stale = true;
    }
    $: if (open && stale) {
        stale = false;
        load();
    }

    let loadEpoch = 0;
    async function load() {
        let epoch = ++loadEpoch;
        let result = await query<BookmarkEntry[]>("query_bookmarks", null);
        if (epoch !== loadEpoch) return;
        if (result.type == "data") {
            entries = result.value;
            error = null;
        } else if (result.type == "error") {
            error = result.message;
        }
    }

    function confirmDelete(title: string, detail: string, action: string, refs: BookmarkRef[]) {
        $currentConfirmation = {
            title,
            detail,
            items: refs.map(refLabel),
            action,
            callback: (confirmed) => {
                if (confirmed) {
                    mutate<DeleteRefs>("delete_refs", { refs }, { operation: `${action}...` });
                }
            },
        };
    }

    function deleteMerged() {
        confirmDelete(
            "Delete Merged Bookmarks",
            "These local bookmarks point into trunk. Deleting them also deletes them on tracked remotes at the next push.",
            "Delete",
            merged,
        );
    }

    function forgetAbsent() {
        confirmDelete(
            "Forget Absent Remotes",
            "These remote bookmarks were deleted locally but not pushed. Forgetting them stops the deletion from being pushed.",
            "Forget",
            absent,
        );
    }
</script>

<section class="bookmarks" aria-label="Bookmarks">
    <div class="rows">
        {#if error}
            <p class="error">{error}</p>
        {:else if entries.length == 0}
            <p class="empty">No bookmarks</p>
        {/if}
        {#each GROUPS as group}
            {#if groups[group].length > 0}
                <h4>{GROUP_TITLES[group]}</h4>
                <ul aria-label="{GROUP_TITLES[group]} bookmarks">
                    {#each groups[group] as row (row.key)}
                        <li data-bookmark={row.key}>
                            {#if row.header}
                                <span class="chip">
                                    <BookmarkObject
                                        header={row.header}
                                        ref={row.ref}
                                        on:click={() => row.header && onReveal(row.header)} />
                                </span>
                            {:else}
                                <span class="label">{row.label}</span>
                            {/if}
                            {#each row.badges as badge}
                                <span class="badge {badge.kind}" title={badge.tip}>{badge.text}</span>
                            {/each}
                            {#if row.header && !loaded.has(row.header.id.commit.hex)}
                                <button
                                    class="link"
                                    title="add this revision to the log query"
                                    on:click={() => row.header && onShowInLog(row.header)}>show in log</button>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
        {/each}
    </div>
    {#if merged.length > 0 || absent.length > 0}
        <div class="cleanup">
            {#if merged.length > 0}
                <button class="link" on:click={deleteMerged}>Delete {merged.length} merged</button>
            {/if}
            {#if absent.length > 0}
                <button class="link" on:click={forgetAbsent}>Forget {absent.length} absent</button>
            {/if}
        </div>
    {/if}
</section>

<style>
    .bookmarks {
        display: flex;
        flex-direction: column;
        font-size: var(--ju-text-sizeSm);
    }

    .rows {
        max-height: 60vh;
        overflow-y: auto;
        pointer-events: auto;
        padding: 3px 3px 0 3px;
    }

    h4 {
        margin: 4px 0 2px 0;
        font-size: var(--ju-text-sizeXs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--ju-colors-foregroundSubtle);
    }

    ul {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    li {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
    }

    .chip {
        pointer-events: auto;
        min-width: 0;
    }

    .label {
        color: var(--ju-colors-foregroundSubtle);
    }

    .badge {
        font-family: var(--ju-text-familyCode);
        font-size: 11px;
        padding: 0 4px;
        border-radius: 3px;
        background: var(--ju-colors-surface);
        white-space: nowrap;
    }

    .ahead {
        color: var(--ju-colors-added);
    }

    .behind {
        color: var(--ju-colors-modified);
    }

    .diverged,
    .conflict {
        color: var(--ju-colors-error);
    }

    .absent {
        color: var(--ju-colors-removed);
    }

    .link {
        border: none;
        background: transparent;
        color: var(--ju-colors-accent);
        font: inherit;
        padding: 0 3px;
        cursor: pointer;
        white-space: nowrap;

        &:hover {
            text-decoration: underline;
        }
    }

    .cleanup {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        padding: 2px 3px;
    }

    .empty,
    .error {
        margin: 4px 0;
        color: var(--ju-colors-foregroundSubtle);
    }

    .error {
        color: var(--ju-colors-error);
    }
</style>
