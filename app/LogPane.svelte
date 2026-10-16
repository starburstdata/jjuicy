<script lang="ts">
    import type { LogPage } from "./messages/LogPage.js";
    import type { LogRow } from "./messages/LogRow.js";
    import type { RevHeader } from "./messages/RevHeader";
    import type { RevSet } from "./messages/RevSet";
    import { query } from "./ipc.js";
    import { sameChange } from "./ids.js";
    import {
        ignoreToggled,
        logDensity,
        logQueryRequest,
        repoStatusEvent,
        revisionSelectEvent,
    } from "./stores.js";
    import { rowGeometry } from "./log/density.js";
    import { formatCount } from "./shell/statusbar.js";
    import Icon from "./controls/Icon.svelte";
    import RevisionMutator from "./mutators/RevisionMutator.js";
    import Pane from "./shell/Pane.svelte";
    import RevisionObject from "./objects/RevisionObject.svelte";
    import RevsetSection from "./log/RevsetSection.svelte";
    import BookmarkSection from "./log/BookmarkSection.svelte";
    import { viewOperation } from "./oplog/oplog.js";
    import { withRevision } from "./log/bookmarks.js";
    import ListWidget, { type List, type Selection } from "./controls/ListWidget.svelte";
    import { type EnhancedRow, default as GraphLog, type EnhancedLine } from "./GraphLog.svelte";

    export let query_choices: Record<string, string>;
    export let latest_query: string;

    let entered_query = latest_query;
    let queryError: string | null = null;
    let graphRows: EnhancedRow[] | undefined;

    let selectionAnchorIdx: number | undefined; // selection model is topologically ordered, selection view requires an anchor point

    let logHeight = 0;
    let logWidth = 0;
    let logScrollTop = 0;

    /**
     * Helper to set selection with proper topological ordering.
     * In the graph, higher indices are older (ancestors), so from should have the higher index.
     * @param anchorIdx - The anchor point (first clicked). Pass undefined to keep existing anchor.
     * @param extendIdx - The extension point (shift-clicked or arrow-extended to).
     */
    function setSelection(anchorIdx: number | undefined, extendIdx: number) {
        if (!graphRows) return;

        if (anchorIdx !== undefined) {
            selectionAnchorIdx = anchorIdx;
        }

        const effectiveAnchor = selectionAnchorIdx ?? extendIdx;
        const fromIdx = Math.max(effectiveAnchor, extendIdx);
        const toIdx = Math.min(effectiveAnchor, extendIdx);

        $revisionSelectEvent = {
            from: graphRows[fromIdx].revision.id,
            to: graphRows[toIdx].revision.id,
        };
    }

    // all these calculations are not efficient. probably doesn't matter
    let list: List = {
        getSize() {
            return graphRows?.length ?? 0;
        },
        getSelection(): Selection {
            if (!graphRows || selectionAnchorIdx === undefined || !$revisionSelectEvent) {
                return { from: -1, to: -1 };
            }

            // translate from toplogical from::to to listwidget's anchor::extension
            const revSetFromIdx = rowIdxByHex.get($revisionSelectEvent!.from.commit.hex) ?? -1;
            const revSetToIdx = rowIdxByHex.get($revisionSelectEvent!.to.commit.hex) ?? -1;

            const extensionIdx = revSetFromIdx === selectionAnchorIdx ? revSetToIdx : revSetFromIdx;

            return { from: selectionAnchorIdx, to: extensionIdx };
        },
        selectRow(row: number) {
            setSelection(row, row);
        },
        extendSelection(row: number) {
            if (!graphRows || selectionAnchorIdx === undefined) return;

            const limitIdx = findLinearLimit(selectionAnchorIdx, row);
            if (limitIdx === row) {
                setSelection(undefined, row); // Keep anchor, extend to new row
            }
        },
        editRow(row: number) {
            if (row != -1) {
                new RevisionMutator([graphRows![row].revision], $ignoreToggled).onEdit();
            }
        },
    };

    // dedupe repoStatusEvent — it fires multiple times during the startup handshake
    // with identical content. first change drives the initial fast-path load; later
    // genuine changes drive a full reload so we can relocate the previous selection.
    let lastStatusKey: string | null = null;
    $: if ($repoStatusEvent) {
        let key = JSON.stringify($repoStatusEvent);
        if (key !== lastStatusKey) {
            let isFirst = lastStatusKey === null;
            lastStatusKey = key;
            loadLog(isFirst);
        }
    }

    $: if ($logQueryRequest !== null) {
        entered_query = $logQueryRequest;
        $logQueryRequest = null;
        loadLog(true);
    }

    let bookmarkCount = 0;
    let bookmarksOpen = false;
    let bookmarksReady = false;
    let bookmarksAnchor: HTMLElement;

    function onWindowClick(event: MouseEvent) {
        if (bookmarksOpen && !bookmarksAnchor.contains(event.target as Node)) bookmarksOpen = false;
    }

    function onWindowKey(event: KeyboardEvent) {
        if (bookmarksOpen && event.key == "Escape") bookmarksOpen = false;
    }
    let listWidget: ListWidget;

    function revealBookmark(header: RevHeader) {
        bookmarksOpen = false;
        let idx = rowIdxByHex.get(header.id.commit.hex);
        if (idx === undefined) return;
        setSelection(idx, idx);
        listWidget?.revealRow(idx);
    }

    function showInLog(header: RevHeader) {
        bookmarksOpen = false;
        $logQueryRequest = withRevision(entered_query == "" ? "all()" : entered_query, header.id.commit.hex);
        pendingReveal = header.id.commit.hex;
    }

    // revealed once the widened query has loaded the row
    let pendingReveal: string | null = null;
    $: if (pendingReveal && graphRows && rowIdxByHex.has(pendingReveal)) {
        let idx = rowIdxByHex.get(pendingReveal)!;
        pendingReveal = null;
        setSelection(idx, idx);
        listWidget?.revealRow(idx);
    }

    // index rows by commit hex so selection and per-row lookups stay O(1) as the graph grows
    $: rowIdxByHex = (() => {
        let map = new Map<string, number>();
        if (graphRows) {
            for (let i = 0; i < graphRows.length; i++) {
                map.set(graphRows[i].revision.id.commit.hex, i);
            }
        }
        return map;
    })();

    $: selectionRange = (() => {
        if (!$revisionSelectEvent || !graphRows) return null;
        let a = rowIdxByHex.get($revisionSelectEvent.from.commit.hex);
        let b = rowIdxByHex.get($revisionSelectEvent.to.commit.hex);
        if (a === undefined || b === undefined) return null;
        return { min: Math.min(a, b), max: Math.max(a, b) };
    })();

    function isInSelectedRange(row: EnhancedRow, range: { min: number; max: number } | null): boolean {
        if (!range) return false;
        let idx = rowIdxByHex.get(row.revision.id.commit.hex);
        return idx !== undefined && idx >= range.min && idx <= range.max;
    }

    /**
     * Check if childRow's revision is a direct (non-elided) parent of parentRow's revision.
     * In the graph, lower indices are children (newer), higher indices are parents (older).
     */
    function isDirectParent(childRow: EnhancedRow, parentRow: EnhancedRow): boolean {
        const childCommitHex = childRow.revision.id.commit.hex;
        const parentCommitHex = parentRow.revision.id.commit.hex;

        const isParent = childRow.revision.parent_ids.some((p) => p.hex === parentCommitHex);
        if (!isParent) {
            return false;
        }

        // find a connecting line
        for (const line of childRow.passingLines) {
            if (line.child.id.commit.hex === childCommitHex && line.parent.id.commit.hex === parentCommitHex) {
                return !line.indirect && line.type !== "ToMissing";
            }
        }

        // elided sequences not supported for now - this is possible, but perhaps not useful
        return false;
    }

    /**
     * Find the farthest index from anchorIdx toward targetIdx that maintains linearity.
     */
    function findLinearLimit(anchorIdx: number, targetIdx: number): number {
        if (!graphRows) return anchorIdx;

        const direction = targetIdx > anchorIdx ? 1 : -1;
        let lastValidIdx = anchorIdx;

        for (let i = anchorIdx + direction; direction > 0 ? i <= targetIdx : i >= targetIdx; i += direction) {
            const checkStart = direction > 0 ? lastValidIdx : i;
            const checkEnd = direction > 0 ? i : lastValidIdx;
            if (isDirectParent(graphRows[checkStart], graphRows[checkEnd])) {
                lastValidIdx = i;
            } else {
                break;
            }
        }

        return lastValidIdx;
    }

    function handleClick(header: RevHeader) {
        if (!graphRows) return;

        const clickedIdx = rowIdxByHex.get(header.id.commit.hex) ?? -1;
        if (clickedIdx !== -1) {
            setSelection(clickedIdx, clickedIdx);
        }
    }

    function handleShiftClick(header: RevHeader) {
        if (!graphRows || selectionAnchorIdx === undefined) {
            handleClick(header); // initial selection
            return;
        }

        const clickedIdx = rowIdxByHex.get(header.id.commit.hex) ?? -1;
        if (clickedIdx === -1) {
            handleClick(header); // invalid selection
            return;
        }

        const limitIdx = findLinearLimit(selectionAnchorIdx, clickedIdx);
        setSelection(undefined, limitIdx); // keep anchor, extend to limit
    }

    // epoch-based cancellation: a new loadLog bumps the epoch, discarding any
    // in-flight page from a previous call. prevents startup races where repeated
    // repoStatusEvents would concurrently mutate graphRows and the shared
    // graph-building state (passNextRow, lineKey) below.
    let loadEpoch = 0;

    async function loadLog(selectFirst: boolean) {
        const epoch = ++loadEpoch;
        // passNextRow can carry stale lines from a cancelled load. lineKey must stay
        // monotonic so reload produces fresh keys — otherwise Svelte's keyed {#each}
        // reuses GraphLine components, whose path is computed in a non-reactive let
        // block and won't update to the new line's geometry.
        passNextRow = [];
        locationIdxMap.clear();
        let page = await query<LogPage>(
            "query_log",
            {
                revset: entered_query == "" ? "all()" : entered_query,
            },
            // a reload after a mutation keeps the old rows up rather than flashing a placeholder
            selectFirst ? () => (graphRows = undefined) : undefined,
        );
        if (epoch !== loadEpoch) return;

        queryError = page.type == "error" ? page.message : null;
        if (page.type == "data") {
            graphRows = [];
            graphRows = addPageToGraph(graphRows, page.value.rows);
            let hasMorePages = page.value.has_more;

            // fast initial paint: select row 0 before loading the rest so the user sees
            // the first page immediately. subsequent pages arrive asynchronously.
            if (selectFirst && page.value.rows.length > 0) {
                setSelection(0, 0);
            }

            // always drain remaining pages: a FromNode line can span page boundaries, and
            // its passingLines on earlier rows are only populated when the target row (on a
            // later page) is processed. stopping at page 1 leaves those lines unrendered.
            while (hasMorePages) {
                let next_page = await query<LogPage>("query_log_next_page", null);
                if (epoch !== loadEpoch) return;
                if (next_page.type == "data") {
                    graphRows = addPageToGraph(graphRows, next_page.value.rows);
                    hasMorePages = next_page.value.has_more;
                } else {
                    hasMorePages = false;
                    break;
                }
            }

            if (!selectFirst) {
                syncSelectionWithGraph();
            }
        }
        // a macrotask, so the detail pane's query for the selection is sent first
        if (!bookmarksReady) setTimeout(() => (bookmarksReady = true));
    }

    // policy: reselect by commit id if the original revisions are still around, update by change id if they aren't
    function syncSelectionWithGraph() {
        const selection = $revisionSelectEvent;
        if (!graphRows || graphRows.length === 0) {
            return;
        }
        if (!selection) {
            setSelection(0, 0);
            return;
        }

        let fromIdx = rowIdxByHex.get(selection.from.commit.hex) ?? -1;
        let toIdx = rowIdxByHex.get(selection.to.commit.hex) ?? -1;

        if (fromIdx === -1) {
            fromIdx = graphRows.findIndex((r) => sameChange(r.revision.id.change, selection.from.change));
        }
        if (toIdx === -1) {
            toIdx = graphRows.findIndex((r) => sameChange(r.revision.id.change, selection.to.change));
        }

        // reposition anchor, update ids if changed
        if (fromIdx !== -1 && toIdx !== -1) {
            selectionAnchorIdx = toIdx;

            const newFrom = graphRows[fromIdx].revision.id;
            const newTo = graphRows[toIdx].revision.id;
            if (newFrom.commit.hex !== selection.from.commit.hex || newTo.commit.hex !== selection.to.commit.hex) {
                $revisionSelectEvent = { from: newFrom, to: newTo };
            }
        } else {
            // selection no longer valid (e.g., revision was abandoned), select first row
            setSelection(0, 0);
        }
    }

    function reloadLog() {
        loadLog(false);
    }

    // augment rows with all lines that pass through them
    let lineKey = 0;
    let passNextRow: EnhancedLine[] = [];
    // map from backend location[1] (which skips slots for missing-parent terminators)
    // to graph array index — avoids an O(N) findIndex per line as the log grows.
    let locationIdxMap = new Map<number, number>();

    function addPageToGraph(graph: EnhancedRow[], page: LogRow[]): EnhancedRow[] {
        for (let row of page) {
            let enhancedRow = row as EnhancedRow;
            for (let passingRow of passNextRow) {
                passingRow.parent = row.revision;
            }
            enhancedRow.passingLines = passNextRow;
            passNextRow = [];

            let rowIdx = graph.length;
            graph.push(enhancedRow);
            locationIdxMap.set(enhancedRow.location[1], rowIdx);

            for (let line of enhancedRow.lines) {
                let enhancedLine = line as EnhancedLine;
                enhancedLine.key = lineKey++;

                if (line.type == "ToIntersection" || line.type == "ToMissing") {
                    // ToIntersection lines begin at their owning row, so they run from this row to the next one that we read (which may not be on the same page)
                    enhancedLine.child = row.revision;
                    enhancedRow.passingLines.push(enhancedLine);
                    passNextRow.push(enhancedLine);
                } else {
                    // other lines end at their owning row, so we need to add them to all previous rows and then this one.
                    enhancedLine.parent = row.revision;
                    let sourceIdx = locationIdxMap.get(line.source[1]);
                    if (sourceIdx === undefined) continue; // defensive: source row unknown
                    enhancedLine.child = graph[sourceIdx].revision;
                    for (let i = sourceIdx; i < rowIdx && graph[i].location[1] < line.target[1]; i++) {
                        graph[i].passingLines.push(enhancedLine);
                    }
                    enhancedRow.passingLines.push(enhancedLine);
                }
            }
        }

        return graph;
    }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />

<Pane>
    <div slot="header">
        {#if $repoStatusEvent?.at_operation}
            <div class="readonly-banner" role="status">
                <Icon name="eye" />
                <span>Viewing operation <code>{$repoStatusEvent.at_operation.slice(0, 12)}</code> (read-only)</span>
                <button on:click={() => viewOperation(null)}>Return to current</button>
            </div>
        {/if}
        <RevsetSection {query_choices} bind:value={entered_query} error={queryError} onSubmit={reloadLog} />
        <div class="column-header" bind:this={bookmarksAnchor}>
            {#if bookmarkCount > 0}
                <button
                    class="bookmarks-toggle"
                    aria-haspopup="dialog"
                    aria-expanded={bookmarksOpen}
                    on:click={() => (bookmarksOpen = !bookmarksOpen)}>
                    <Icon name="bookmark" />
                    <span>Bookmarks {formatCount(bookmarkCount)}</span>
                    <Icon name="chevron-down" />
                </button>
            {/if}
            {#if graphRows}
                <span class="row-count">{formatCount(graphRows.length)} {graphRows.length == 1 ? "change" : "changes"}</span>
            {/if}
            <!-- kept mounted while closed so the toggle has a count; it refreshes on open -->
            <div class="bookmarks-dropdown" class:collapsed={!bookmarksOpen} role="dialog" aria-label="Bookmarks">
                <BookmarkSection
                    bind:count={bookmarkCount}
                    open={bookmarksOpen}
                    ready={bookmarksReady}
                    loaded={rowIdxByHex}
                    onReveal={revealBookmark}
                    onShowInLog={showInLog} />
            </div>
        </div>
    </div>

    <ListWidget
        slot="body"
        bind:this={listWidget}
        type="Revision"
        descendant={$revisionSelectEvent?.to.commit.prefix}
        {list}
        bind:clientHeight={logHeight}
        bind:clientWidth={logWidth}
        bind:scrollTop={logScrollTop}
        rowHeight={rowGeometry($logDensity).rowHeight}>
        {#if graphRows}
            <GraphLog
                containerHeight={logHeight}
                containerWidth={logWidth}
                scrollTop={logScrollTop}
                rows={graphRows}
                let:row>
                {#if row}
                    <div class="log-entry">
                        <RevisionObject
                            header={row.revision}
                            hiddenForks={row.hidden_forks}
                            selected={isInSelectedRange(row, selectionRange)}
                            onClick={handleClick}
                            onShiftClick={handleShiftClick} />
                    </div>
                {/if}
            </GraphLog>
        {:else}
            <div>Loading changes...</div>
        {/if}
    </ListWidget>
</Pane>

<style>
    .log-entry {
        padding-left: 24px;
    }

    .column-header {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        padding: 2px 3px 0 3px;
        font-size: var(--ju-text-sizeSm);
        color: var(--ju-colors-foregroundSubtle);
    }

    .bookmarks-toggle {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        padding: 1px 3px;
        border-radius: 4px;
        cursor: pointer;

        &:hover {
            background: var(--ju-colors-surface);
            color: var(--ju-colors-foreground);
        }

        & :global(.feather) {
            height: 12px;
            width: 12px;
            min-width: 12px;
        }
    }

    .bookmarks-toggle[aria-expanded="true"] {
        background: var(--ju-colors-surface);
        color: var(--ju-colors-foreground);
    }

    .bookmarks-dropdown {
        position: absolute;
        top: calc(100% + 2px);
        left: 0;
        right: 0;
        z-index: 100;
        pointer-events: auto;
        padding: 2px 4px;
        background: var(--ju-colors-background);
        border: 1px solid var(--ju-colors-surfaceStrong);
        border-radius: var(--ju-components-radiusSm);
        box-shadow: var(--ju-shadows-shadowMd);
        color: var(--ju-colors-foreground);
    }

    .readonly-banner {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 3px 3px 0 3px;
        padding: 4px 6px;
        border-radius: var(--ju-components-radiusSm);
        background: var(--ju-colors-surfaceAlt);
        color: var(--ju-colors-warning);
        font-size: var(--ju-text-sizeSm);

        & span {
            flex: 1;
        }

        & button {
            pointer-events: auto;
            border: none;
            background: transparent;
            color: var(--ju-colors-accent);
            font: inherit;
            cursor: pointer;
        }
    }

    .row-count {
        margin-left: auto;
    }

    .collapsed {
        display: none;
    }
</style>
