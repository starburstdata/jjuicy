<script lang="ts">
    import type { EvologEntry } from "../messages/EvologEntry";
    import type { RestoreFromEvolog } from "../messages/RestoreFromEvolog";
    import type { RevHeader } from "../messages/RevHeader";
    import type { RevsResult } from "../messages/RevsResult";
    import { mutate, query } from "../ipc";
    import { mergeChanges } from "../files/files";
    import DiffViewer from "../diff/DiffViewer.svelte";
    import FileHeader from "../diff/FileHeader.svelte";
    import TimestampSpan from "../controls/TimestampSpan.svelte";

    export let header: RevHeader;
    export let ignoreImmutable: boolean;

    let versions: EvologEntry[] = [];
    let error: string | null = null;
    let selected: EvologEntry | null = null;
    let detail: Extract<RevsResult, { type: "Detail" }> | null = null;

    // the header is re-queried after every mutation, which is also when the evolog grows
    let loadedFor = "";
    $: if (header.id.commit.hex != loadedFor) {
        loadedFor = header.id.commit.hex;
        load(header);
    }

    let loadEpoch = 0;
    async function load(header: RevHeader) {
        let epoch = ++loadEpoch;
        let result = await query<EvologEntry[]>("query_evolog", { id: header.id });
        if (epoch != loadEpoch) return;
        if (result.type == "data") {
            versions = result.value;
            error = null;
            select(versions[0] ?? null);
        } else if (result.type == "error") {
            error = result.message;
        }
    }

    let selectEpoch = 0;
    async function select(version: EvologEntry | null) {
        let epoch = ++selectEpoch;
        selected = version;
        detail = null;
        if (!version) return;
        let id = version.commit.id;
        let result = await query<RevsResult>("query_revisions", { set: { from: id, to: id } });
        if (epoch != selectEpoch) return;
        if (result.type == "data" && result.value.type == "Detail") {
            detail = result.value;
        } else if (result.type == "error") {
            error = result.message;
        }
    }

    function restore(version: EvologEntry) {
        mutate<RestoreFromEvolog>(
            "restore_from_evolog",
            { id: header.id, from: version.commit.id.commit },
            { operation: "Restoring...", ignoreImmutable },
        );
    }

    $: locked = header.is_immutable && !ignoreImmutable;
    $: changes = detail ? mergeChanges(detail.changes, detail.conflicts) : [];
</script>

<div class="evolog">
    {#if error}
        <p class="error">{error}</p>
    {/if}
    <ol class="versions" aria-label="Versions">
        {#each versions as version, i (version.commit.id.commit.hex)}
            <li class:selected={selected?.commit.id.commit.hex == version.commit.id.commit.hex}>
                <button class="version" on:click={() => select(version)}>
                    <code>{version.commit.id.commit.prefix}</code>
                    <span class="description">{version.commit.description.lines[0] || "(no description set)"}</span>
                    <span class="meta">
                        {#if version.operation}<span class="operation" title={version.operation}>{version.operation}</span>{/if}
                        <TimestampSpan timestamp={version.commit.author.timestamp} />
                    </span>
                </button>
                {#if i > 0}
                    <button class="link restore" disabled={locked} on:click={() => restore(version)}>restore</button>
                {/if}
            </li>
        {/each}
    </ol>
    {#if detail}
        {#if changes.length > 0}
            <div class="changes">
                {#each changes as change (change.path.repo_path)}
                    <div class="change">
                        <FileHeader {change} header={null} />
                        <DiffViewer set={detail.set} {change} header={null} lazy />
                    </div>
                {/each}
            </div>
        {:else}
            <p class="empty">This version has no changes.</p>
        {/if}
    {/if}
</div>

<style>
    .evolog {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--ju-colors-outline);
        font-size: 13px;
    }

    .versions {
        list-style: none;
        margin: 0;
        padding: 3px 0;
        border-bottom: 1px solid var(--ju-colors-outline);
    }

    li {
        display: flex;
        align-items: center;
        gap: 6px;
        border-radius: var(--ju-components-radiusSm);
    }

    li.selected {
        background: var(--ju-colors-surfaceAlt);
    }

    .version {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 3px 6px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .description,
    .operation {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .description {
        flex: 1;
    }

    .meta {
        display: flex;
        gap: 6px;
        min-width: 0;
        max-width: 50%;
        color: var(--ju-colors-foregroundMuted);
    }

    .link {
        border: none;
        background: transparent;
        font: inherit;
        cursor: pointer;
        padding: 1px 4px;
        color: var(--ju-colors-accent);
        border-radius: var(--ju-components-radiusSm);
    }

    .link:disabled {
        color: var(--ju-colors-foregroundMuted);
        cursor: default;
    }

    .error {
        color: var(--ju-colors-error);
        margin: 6px;
    }

    .empty {
        margin: 6px;
        color: var(--ju-colors-foregroundMuted);
    }

    .changes {
        display: flex;
        flex-direction: column;
    }

    .change {
        font-size: small;
    }
</style>
