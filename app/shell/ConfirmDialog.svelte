<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import ActionWidget from "../controls/ActionWidget.svelte";
    import ModalDialog from "./ModalDialog.svelte";

    interface $$Events {
        response: CustomEvent<boolean>;
    }

    export let title: string;
    export let detail: string;
    export let items: string[];
    export let action: string;

    let dispatch = createEventDispatcher();
</script>

<ModalDialog {title} on:cancel={() => dispatch("response", false)} on:default={() => dispatch("response", true)}>
    <p>{detail}</p>
    <ul class="items">
        {#each items as item}
            <li><code>{item}</code></li>
        {/each}
    </ul>
    <svelte:fragment slot="commands">
        <ActionWidget modal secondary onClick={() => dispatch("response", false)}>Cancel</ActionWidget>
        <ActionWidget modal primary onClick={() => dispatch("response", true)}>{action}</ActionWidget>
    </svelte:fragment>
</ModalDialog>

<style>
    p {
        grid-column: 1/3;
        margin: 0;
    }

    .items {
        grid-column: 1/3;
        margin: 0;
        padding-left: 18px;
        max-height: 240px;
        overflow-y: auto;
        user-select: text;
    }
</style>
