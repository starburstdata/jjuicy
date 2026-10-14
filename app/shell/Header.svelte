<script lang="ts">
    import ToolbarAction from "../controls/ToolbarAction.svelte";
    import { isTauri, mutate, query, trigger } from "../ipc";
    import type { GitFetch } from "../messages/GitFetch";
    import type { GitPush } from "../messages/GitPush";
    import type { RepoConfig } from "../messages/RepoConfig";
    import type { RepoStatus } from "../messages/RepoStatus";
    import { currentMutation, hasModal, lastFocus, progressEvent, repoConfigEvent, repoStatusEvent, sidebarCollapsed } from "../stores";
    import WorkspaceMutator from "../mutators/WorkspaceMutator";

    export let config: RepoConfig;

    let busy: "push" | "fetch" | "refresh" | null = null;
    let recentWorkspaces: string[] = [];

    // the overlay title bar puts the traffic lights over our left edge
    let macOverlay = isTauri() && navigator.userAgent.includes("Mac");

    $: workspace = config.type === "Workspace" ? config : null;
    $: remotes = workspace?.git_remotes ?? [];
    $: defaultRemote = remotes.includes("origin") ? "origin" : (remotes[0] ?? "");
    $: repoName = workspace ? basename(workspace.absolute_path) : "";
    $: progress = $currentMutation?.type === "wait" || busy ? $progressEvent : undefined;
    $: progressValue = progress?.type === "Progress" ? progress.overall_percent : undefined;
    $: showProgress = $currentMutation?.type === "wait" || busy !== null;

    function basename(path: string) {
        let parts = path.split(/[\\/]/).filter((p) => p.length > 0);
        return parts[parts.length - 1] ?? path;
    }

    async function run(kind: "push" | "fetch", remote_name: string) {
        busy = kind;
        try {
            if (kind === "push") {
                await mutate<GitPush>(
                    "git_push",
                    { refspec: { type: "AllBookmarks", remote_name }, input: null },
                    { operation: `Pushing to ${remote_name}...` },
                );
            } else {
                await mutate<GitFetch>(
                    "git_fetch",
                    { refspec: { type: "AllBookmarks", remote_name }, input: null },
                    { operation: `Fetching from ${remote_name}...` },
                );
            }
        } finally {
            busy = null;
        }
    }

    async function onRefresh() {
        busy = "refresh";
        try {
            let result = await query<RepoStatus | null>("query_snapshot", null);
            if (result.type === "data" && result.value) {
                repoStatusEvent.set(result.value);
            }
            lastFocus.set(Date.now());
        } finally {
            busy = null;
        }
    }

    async function loadRecent() {
        let result = await query<string[]>("query_recent_workspaces", null);
        let current = workspace?.absolute_path;
        recentWorkspaces = result.type === "data" ? result.value.filter((w) => w !== current) : [];
    }

    async function openWorkspace(path: string) {
        let result = await query<RepoConfig>("query_workspace", { path });
        if (result.type === "data") {
            repoConfigEvent.set(result.value);
        } else {
            repoConfigEvent.set({ type: "LoadError", absolute_path: path, message: result.message });
        }
    }

    function openOther() {
        trigger("forward_accelerator", { key: "o", ctrl: true, shift: false });
    }

    $: if (workspace) loadRecent();
</script>

<header class="header" class:mac-overlay={macOverlay} inert={$hasModal} data-tauri-drag-region>
    {#if workspace}
        {#snippet pushRemotes({ close }: { close: () => void })}
            {#each remotes as remote}
                <button on:click={() => { run("push", remote); close(); }}>Push to {remote}</button>
            {/each}
        {/snippet}

        {#snippet fetchRemotes({ close }: { close: () => void })}
            {#each remotes as remote}
                <button on:click={() => { run("fetch", remote); close(); }}>Fetch from {remote}</button>
            {/each}
        {/snippet}

        {#snippet workspaceMenu({ close }: { close: () => void })}
            <span class="menu-heading">Workspace {workspace?.workspace_name}</span>
            <button on:click={() => { close(); new WorkspaceMutator(workspace?.workspace_name ?? "").onRename(); }}>
                Rename workspace...
            </button>
            {#if recentWorkspaces.length > 0}
                <hr />
                <span class="menu-heading">Recent</span>
                {#each recentWorkspaces as path}
                    <button title={path} on:click={() => { close(); openWorkspace(path); }}>{path}</button>
                {/each}
            {/if}
            {#if isTauri()}
                <hr />
                <button on:click={() => { close(); openOther(); }}>Open repository...</button>
            {/if}
        {/snippet}

        <div class="group">
            <ToolbarAction
                icon="sidebar"
                tip={$sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                pressed={!$sidebarCollapsed}
                onClick={() => ($sidebarCollapsed = !$sidebarCollapsed)} />
            <ToolbarAction icon="refresh-cw" tip="Refresh (snapshot working copy)" busy={busy === "refresh"} onClick={onRefresh} />
        </div>

        <nav class="breadcrumb" aria-label="workspace">
            <ToolbarAction icon="folder" label={repoName} tip={workspace.absolute_path} dropdown={workspaceMenu} />
            {#if workspace.workspace_name !== "default"}
                <span class="crumb-separator">/</span>
                <span class="crumb">{workspace.workspace_name}</span>
            {/if}
        </nav>

        <div class="spacer" data-tauri-drag-region></div>

        <div class="group">
            {#if remotes.length > 0}
                <ToolbarAction
                    icon="download-cloud"
                    label="Fetch"
                    tip="Fetch from {defaultRemote}"
                    busy={busy === "fetch"}
                    disabled={busy !== null}
                    onClick={() => run("fetch", defaultRemote)}
                    dropdown={remotes.length > 1 ? fetchRemotes : undefined} />
                <ToolbarAction
                    icon="upload-cloud"
                    label="Push"
                    tip="Push to {defaultRemote}"
                    busy={busy === "push"}
                    disabled={busy !== null}
                    onClick={() => run("push", defaultRemote)}
                    dropdown={remotes.length > 1 ? pushRemotes : undefined} />
            {/if}
        </div>

        <div class="group">
            {#if isTauri()}
                <ToolbarAction
                    icon="terminal"
                    tip="Open terminal here"
                    onClick={() => trigger("open_terminal", { path: workspace?.absolute_path })} />
            {/if}
            <ToolbarAction icon="settings" tip="Edit settings (jj user config)" onClick={() => trigger("open_user_config")} />
        </div>
    {/if}

    {#if showProgress}
        <div
            class="progress"
            role="progressbar"
            aria-label={progress?.type === "Message" ? progress.text : "Working"}
            aria-valuenow={progressValue}>
            {#if progressValue !== undefined}
                <div class="fill" style="width: {progressValue}%"></div>
            {:else}
                <div class="fill indeterminate"></div>
            {/if}
        </div>
    {/if}
</header>

<style>
    .header {
        grid-area: header;
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 8px;
        background: var(--ju-colors-surfaceDeep);
        border-bottom: 1px solid var(--ju-colors-surfaceAlt);
        font-family: var(--ju-text-familyUi);
        min-width: 0;
    }

    .header.mac-overlay {
        padding-left: 78px;
    }

    .group {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .breadcrumb {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        font-size: var(--ju-text-sizeMd);
    }

    .breadcrumb :global(.body .label) {
        font-weight: 600;
    }

    .crumb-separator {
        color: var(--ju-colors-foregroundFaint);
    }

    .crumb {
        color: var(--ju-colors-foregroundMuted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .spacer {
        flex: 1;
        align-self: stretch;
    }

    .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: -1px;
        height: 2px;
        overflow: hidden;
    }

    .fill {
        height: 100%;
        background: var(--ju-colors-primary);
        transition: width 0.2s ease;
    }

    .fill.indeterminate {
        width: 30%;
        animation: indeterminate 1.4s infinite ease-in-out;
    }

    @keyframes indeterminate {
        0% {
            transform: translateX(-100%);
        }
        100% {
            transform: translateX(400%);
        }
    }
</style>
