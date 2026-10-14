<script lang="ts">
    import { parseRoute } from "./route.js";
    import Shell from "./Shell.svelte";
    import LogPane from "./LogPane.svelte";
    import RevisionPane from "./RevisionPane.svelte";
    import FilesPane from "./files/FilesPane.svelte";
    import BoundQuery from "./controls/BoundQuery.svelte";
    import Pane from "./shell/Pane.svelte";
    import SetSpan from "./controls/SetSpan.svelte";
    import SplitView from "./shell/SplitView.svelte";
    import { sidebarCollapsed } from "./stores";

    let route = parseRoute();
</script>

<Shell revsetOverride={route.type === "revision" ? route.revset : null}
       let:workspace let:selection>
    <!-- snippets at the top level of slot content would become props of Shell, so they live inside the key -->
    {#key workspace.absolute_path}
        <!-- files and detail each bind the same selection query, so there's no extra ipc -->
        {#snippet filesColumn()}
            <BoundQuery query={selection} let:data>
                {#if data.type == "Detail"}
                    <FilesPane revs={data} />
                {:else}
                    <Pane>
                        <span slot="header">0 files</span>
                    </Pane>
                {/if}
                <Pane slot="error">
                    <span slot="header">Files</span>
                </Pane>
                <Pane slot="wait">
                    <span slot="header">Files</span>
                </Pane>
            </BoundQuery>
        {/snippet}

        {#snippet detailColumn()}
            <BoundQuery query={selection} let:data>
                {#if data.type == "Detail"}
                    <RevisionPane revs={data} />
                {:else}
                    <Pane>
                        <h2 slot="header">Not Found</h2>
                        <p slot="body">
                            Empty revision set <SetSpan set={data.set} />.
                        </p>
                    </Pane>
                {/if}
                <Pane slot="error" let:message>
                    <h2 slot="header">Error</h2>
                    <p slot="body">{message}</p>
                </Pane>
                <Pane slot="wait">
                    <h2 slot="header">Loading...</h2>
                </Pane>
            </BoundQuery>
        {/snippet}

        {#if route.type === "log"}
            <LogPane query_choices={workspace.query_choices}
                     latest_query={route.revset ?? workspace.latest_query} />
        {:else if route.type === "revision"}
            <SplitView panes={[filesColumn, detailColumn]}
                       minSizes={[180, 320]}
                       initialSizes={[1, 3]}
                       storageKey="jjuicy.split.revision" />
        {:else}
            {#snippet logColumn()}
                <LogPane query_choices={workspace.query_choices}
                         latest_query={workspace.latest_query} />
            {/snippet}

            <SplitView panes={[logColumn, filesColumn, detailColumn]}
                       minSizes={[240, 180, 320]}
                       initialSizes={[2, 1, 3]}
                       collapsed={[$sidebarCollapsed, false, false]}
                       storageKey="jjuicy.split.main" />
        {/if}
    {/key}
</Shell>
