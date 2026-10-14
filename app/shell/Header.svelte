<script lang="ts">
    import ToolbarAction from "../controls/ToolbarAction.svelte";
    import { isTauri, mutate, query, trigger } from "../ipc";
    import type { GitFetch } from "../messages/GitFetch";
    import type { GitPush } from "../messages/GitPush";
    import type { RepoConfig } from "../messages/RepoConfig";
    import type { RepoStatus } from "../messages/RepoStatus";
    import { currentMutation, hasModal, lastFocus, progressEvent, repoConfigEvent, repoStatusEvent, sidebarCollapsed, filesCollapsed } from "../stores";
    import WorkspaceMutator from "../mutators/WorkspaceMutator";
    import Icon from "../controls/Icon.svelte";
    import { macOverlay, TITLE_ROW_HEIGHT } from "./chrome";

    export let config: RepoConfig;

    let busy: "push" | "fetch" | "refresh" | null = null;
    let recentWorkspaces: string[] = [];

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

<header
    class="header"
    class:mac-overlay={macOverlay}
    style="--title-row-height: {TITLE_ROW_HEIGHT}px"
    inert={$hasModal}
    data-tauri-drag-region="deep">
    {#if macOverlay}
        <div class="title-row">{repoName || "jjuicy"}</div>
    {/if}
    <div class="toolbar">
        {#if workspace}
            {#snippet pushRemotes({ close }: { close: () => void })}
                <span class="menu-heading">Push to</span>
                {#each remotes as remote}
                    <button on:click={() => { run("push", remote); close(); }}>
                        <Icon name="upload-cloud" /><span class="text">{remote}</span>
                    </button>
                {/each}
            {/snippet}

            {#snippet fetchRemotes({ close }: { close: () => void })}
                <span class="menu-heading">Fetch from</span>
                {#each remotes as remote}
                    <button on:click={() => { run("fetch", remote); close(); }}>
                        <Icon name="download-cloud" /><span class="text">{remote}</span>
                    </button>
                {/each}
            {/snippet}

            {#snippet workspaceMenu({ close }: { close: () => void })}
                <span class="menu-heading">Workspace {workspace?.workspace_name}</span>
                <button on:click={() => { close(); new WorkspaceMutator(workspace?.workspace_name ?? "").onRename(); }}>
                    <Icon name="edit-2" /><span class="text">Rename workspace...</span>
                </button>
                {#if recentWorkspaces.length > 0}
                    <hr />
                    <span class="menu-heading">Recent</span>
                    {#each recentWorkspaces as path}
                        <button title={path} on:click={() => { close(); openWorkspace(path); }}>
                            <Icon name="folder" /><span class="text">{path}</span>
                        </button>
                    {/each}
                {/if}
                {#if isTauri()}
                    <hr />
                    <button on:click={() => { close(); openOther(); }}>
                        <Icon name="folder-plus" /><span class="text">Open repository...</span>
                    </button>
                {/if}
            {/snippet}

            {#snippet workspacePill()}
                <span class="repo-name">{repoName}</span>
                {#if workspace?.workspace_name !== "default"}
                    <span class="crumb-separator">/</span>
                    <span class="crumb">{workspace?.workspace_name}</span>
                {/if}
            {/snippet}

            <div class="group">
                <ToolbarAction
                    stacked
                    icon="sidebar"
                    label="Sidebar"
                    tip={$sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                    pressed={!$sidebarCollapsed}
                    onClick={() => ($sidebarCollapsed = !$sidebarCollapsed)} />
                <ToolbarAction
                    stacked
                    icon="columns"
                    label="Files"
                    tip={$filesCollapsed ? "Show file list" : "Hide file list"}
                    pressed={!$filesCollapsed}
                    onClick={() => ($filesCollapsed = !$filesCollapsed)} />
                <nav class="breadcrumb" aria-label="workspace">
                    <ToolbarAction
                        stacked
                        icon="folder"
                        label="Workspace"
                        tip={workspace.absolute_path}
                        pill={workspacePill}
                        dropdown={workspaceMenu} />
                </nav>
            </div>

            <div class="group">
                <ToolbarAction stacked icon="refresh-cw" label="Refresh" tip="Refresh (snapshot working copy)" busy={busy === "refresh"} onClick={onRefresh} />
                {#if remotes.length > 0}
                    <ToolbarAction
                        stacked
                        icon="download-cloud"
                        label="Fetch"
                        tip="Fetch from {defaultRemote}"
                        busy={busy === "fetch"}
                        disabled={busy !== null}
                        onClick={() => run("fetch", defaultRemote)}
                        dropdown={remotes.length > 1 ? fetchRemotes : undefined} />
                    <ToolbarAction
                        stacked
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
                        stacked
                        icon="terminal"
                        label="Terminal"
                        tip="Open terminal here"
                        onClick={() => trigger("open_terminal", { path: workspace?.absolute_path })} />
                {/if}
                <ToolbarAction stacked icon="settings" label="Settings" tip="Edit settings (jj user config)" onClick={() => trigger("open_user_config")} />
            </div>
        {/if}
    </div>

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
        /* the shell is pointer-transparent; the header must be hit for the drag region to see clicks */
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        background: var(--ju-colors-surfaceDeep);
        border-bottom: 1px solid var(--ju-colors-surfaceStrong);
        font-family: var(--ju-text-familyUi);
        min-width: 0;
    }

    .title-row {
        flex: none;
        height: var(--title-row-height);
        line-height: var(--title-row-height);
        /* clear of the traffic lights on both sides so the title stays centred */
        padding: 0 78px;
        text-align: center;
        font-size: var(--ju-text-sizeMd);
        font-weight: var(--ju-text-weightHeavy);
        color: var(--ju-colors-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .toolbar {
        flex: 1;
        display: flex;
        align-items: stretch;
        gap: 16px;
        padding: 0 10px;
        min-width: 0;
    }

    .group {
        display: flex;
        align-items: stretch;
        gap: 4px;
        min-width: 0;
    }

    .breadcrumb {
        display: flex;
        align-items: stretch;
        min-width: 0;
        margin-left: 8px;
    }

    .repo-name {
        font-weight: var(--ju-text-weightMedium);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .crumb-separator {
        color: var(--ju-colors-foregroundFaint);
    }

    .crumb {
        color: var(--ju-colors-foregroundMuted);
        overflow: hidden;
        text-overflow: ellipsis;
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
