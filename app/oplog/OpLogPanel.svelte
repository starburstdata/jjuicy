<script lang="ts">
    import type { OpLogEntry } from "../messages/OpLogEntry";
    import type { RestoreOperation } from "../messages/RestoreOperation";
    import { mutate, query } from "../ipc";
    import { currentConfirmation, hasModal, opLogOpen, repoStatusEvent } from "../stores";
    import Icon from "../controls/Icon.svelte";
    import TimestampSpan from "../controls/TimestampSpan.svelte";
    import { OP_LOG_PAGE, shortOpId, viewOperation } from "./oplog";

    let entries: OpLogEntry[] = [];
    let error: string | null = null;
    let exhausted = false;

    $: viewing = $repoStatusEvent?.at_operation ?? null;

    let lastStatusKey: string | null = null;
    $: {
        let key = JSON.stringify($repoStatusEvent ?? null);
        if (key !== lastStatusKey) {
            lastStatusKey = key;
            load(Math.max(entries.length, OP_LOG_PAGE), true);
        }
    }

    let loadEpoch = 0;
    async function load(limit: number, replace: boolean) {
        let epoch = ++loadEpoch;
        let offset = replace ? 0 : entries.length;
        let result = await query<OpLogEntry[]>("query_op_log", { limit, offset });
        if (epoch !== loadEpoch) return;
        if (result.type == "data") {
            entries = replace ? result.value : [...entries, ...result.value];
            exhausted = result.value.length < limit;
            error = null;
        } else if (result.type == "error") {
            error = result.message;
        }
    }

    async function view(entry: OpLogEntry) {
        // the head entry is also how you leave a pinned view
        let target = entry.id == entries[0]?.id ? null : entry.id;
        error = await viewOperation(target);
    }

    function restore(entry: OpLogEntry) {
        $currentConfirmation = {
            title: "Restore Operation",
            detail: "The repository will be restored to its state after this operation. Later operations stay in the log, so this can be undone.",
            items: [`${shortOpId(entry.id)} ${entry.description}`],
            action: "Restore",
            callback: async (confirmed) => {
                if (!confirmed) return;
                // mutations are refused while pinned
                if (viewing) {
                    error = await viewOperation(null);
                    if (error) return;
                }
                mutate<RestoreOperation>("restore_operation", { id: entry.id }, { operation: "Restoring..." });
            },
        };
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key == "Escape" && !$hasModal) {
            $opLogOpen = false;
        }
    }
</script>

<!-- capture, so an escape that dismisses a dialog is seen while the dialog is still up -->
<svelte:document on:keydown|capture={onKeydown} />

<aside id="op-log" aria-label="Operation log" inert={$hasModal}>
    <header>
        <Icon name="clock" />
        <h2>Operation Log</h2>
        <button class="icon-button" title="Close" on:click={() => ($opLogOpen = false)}>
            <Icon name="x" />
        </button>
    </header>
    {#if error}
        <p class="error">{error}</p>
    {/if}
    <ol>
        {#each entries as entry, i (entry.id)}
            {@const isViewed = viewing ? entry.id == viewing : i == 0}
            <li class:current={entry.is_current} class:viewed={isViewed}>
                <div class="summary">
                    <span class="description" title={entry.description}>{entry.description}</span>
                    <span class="meta">
                        <code>{shortOpId(entry.id)}</code>
                        <TimestampSpan timestamp={entry.time} />
                        <span class="who">{entry.user}@{entry.host}</span>
                    </span>
                </div>
                <div class="actions">
                    {#if !isViewed}
                        <button class="link view" on:click={() => view(entry)}>{i == 0 ? "current" : "view"}</button>
                    {/if}
                    {#if i > 0}
                        <button class="link restore" on:click={() => restore(entry)}>restore</button>
                    {/if}
                </div>
            </li>
        {/each}
    </ol>
    {#if !exhausted && entries.length > 0}
        <button class="link more" on:click={() => load(OP_LOG_PAGE, false)}>Load more</button>
    {/if}
</aside>

<style>
    #op-log {
        z-index: 1;
        position: absolute;
        top: var(--shell-header-height, var(--ju-components-toolbarHeight));
        right: 0;
        bottom: 33px;
        width: min(420px, 90vw);

        display: flex;
        flex-direction: column;
        overflow: hidden;

        background: var(--ju-colors-background);
        border-left: var(--ju-components-borderDialog);
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
        pointer-events: auto;
        font-size: var(--ju-text-sizeMd);
    }

    header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 9px;
        border-bottom: var(--ju-components-borderSubtle);
    }

    h2 {
        flex: 1;
        margin: 0;
        font-size: inherit;
        font-weight: 600;
    }

    ol {
        flex: 1;
        overflow-y: auto;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    li {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px;
        border-bottom: var(--ju-components-borderSubtle);
    }

    li.viewed {
        background: var(--ju-colors-selectionTint);
        box-shadow: inset 3px 0 0 var(--ju-colors-selectionBar);
    }

    .summary {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .description {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        user-select: text;
    }

    li.current .description {
        font-weight: 600;
    }

    .meta {
        display: flex;
        gap: 6px;
        font-size: var(--ju-text-sizeSm);
        color: var(--ju-colors-foregroundMuted);
        white-space: nowrap;
        overflow: hidden;
    }

    .who {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .actions {
        display: flex;
        gap: 6px;
    }

    .icon-button,
    .link {
        pointer-events: auto;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        border-radius: var(--ju-components-radiusSm);
    }

    .icon-button {
        display: flex;
        padding: 2px;
    }

    .link {
        padding: 1px 4px;
        color: var(--ju-colors-accent);
    }

    .icon-button:hover,
    .link:hover {
        background: var(--ju-colors-surfaceAlt);
    }

    .more {
        margin: 6px auto;
    }

    .error {
        margin: 6px 9px;
        color: var(--ju-colors-error);
        user-select: text;
    }
</style>
