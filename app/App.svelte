<script lang="ts">
    import { parseRoute } from "./route.js";
    import Shell from "./Shell.svelte";
    import LogPane from "./LogPane.svelte";
    import RevisionPane from "./RevisionPane.svelte";
    import BoundQuery from "./controls/BoundQuery.svelte";
    import Pane from "./shell/Pane.svelte";
    import SetSpan from "./controls/SetSpan.svelte";
    import SplitView from "./shell/SplitView.svelte";
    import { sidebarCollapsed } from "./stores";

    let route = parseRoute();

</script>

<Shell revsetOverride={route.type === "revision" ? route.revset : null}
       let:workspace let:selection>
    {#if route.type === "log"}
        {#key workspace.absolute_path}
            <LogPane query_choices={workspace.query_choices}
                     latest_query={route.revset ?? workspace.latest_query} />
        {/key}
    {:else if route.type === "revision"}
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
    {:else}
        {#snippet logColumn()}
            {#key workspace.absolute_path}
                <LogPane query_choices={workspace.query_choices}
                         latest_query={workspace.latest_query} />
            {/key}
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

        <SplitView panes={[logColumn, detailColumn]}
                   minSizes={[240, 320]}
                   collapsed={[$sidebarCollapsed, false]}
                   storageKey="jjuicy.split.main" />
    {/if}
</Shell>
