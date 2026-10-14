<script lang="ts">
    import { getInput, trigger } from "../ipc.js";
    import ActionWidget from "../controls/ActionWidget.svelte";
    import Icon from "../controls/Icon.svelte";
    import SelectWidget from "../controls/SelectWidget.svelte";
    import { presetList, withCustom, toKebabCase } from "./revset";

    export let query_choices: Record<string, string>;
    export let value: string;
    export let error: string | null = null;
    export let onSubmit: () => void;

    const COLLAPSED_KEY = "jjuicy.revset.collapsed";

    let collapsed = localStorage.getItem(COLLAPSED_KEY) == "true";
    let textarea: HTMLTextAreaElement;
    // blur after enter would otherwise submit twice
    let submitted = value;

    $: presets = presetList(query_choices);
    $: choices = withCustom(value, presets);
    $: isCustom = !presets.some((p) => !p.separator && p.value === value);
    $: isDeletable = !isCustom && presets.some((p) => !p.separator && p.value === value && p.label !== "Default");
    $: summary = presets.find((p) => !p.separator && p.value === value)?.label ?? value;
    $: if (textarea) autosize(value);

    function autosize(_: string) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function submit() {
        submitted = value;
        onSubmit();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key == "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    }

    function onBlur() {
        if (value !== submitted) submit();
    }

    function toggleCollapsed() {
        collapsed = !collapsed;
        localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    }

    async function handleSavePreset() {
        let response = await getInput("Save Revset", "code:" + value, [
            { label: "Preset Name", choices: [] },
            { label: "Save globally", choices: ["false", "true"] },
        ]);
        if (!response) return;

        let name = toKebabCase(response["Preset Name"]);
        if (!name || name === "default") return;

        let scope = response["Save globally"] === "true" ? "user" : "repo";
        query_choices[name] = value;
        query_choices = query_choices;
        trigger("write_config_entry", { scope, key: ["gg", "presets", name], value });
    }

    function handleDeletePreset() {
        let keyToDelete = Object.entries(query_choices).find(([key, v]) => key !== "default" && v === value)?.[0];
        if (!keyToDelete) return;

        delete query_choices[keyToDelete];
        query_choices = query_choices;
        value = query_choices["default"] ?? "";
        // attempt deletion from both scopes; one will be a no-op
        trigger("delete_config_entry", { scope: "repo", key: ["gg", "presets", keyToDelete] });
        trigger("delete_config_entry", { scope: "user", key: ["gg", "presets", keyToDelete] });
        submit();
    }
</script>

<div class="log-selector" class:collapsed>
    <button
        class="title"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand revset" : "Collapse revset"}
        on:click={toggleCollapsed}>
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
        <span>Revset</span>
        {#if collapsed}
            <span class="summary">{summary}</span>
        {/if}
    </button>
    {#if !collapsed}
        <div class="selector-row">
            <SelectWidget options={choices} bind:value on:change={submit}>
                <svelte:fragment let:option>{option.label}</svelte:fragment>
            </SelectWidget>
            {#if isCustom}
                <ActionWidget secondary tip="Save revset" onClick={handleSavePreset}>
                    <Icon name="save" /> Save
                </ActionWidget>
            {:else if isDeletable}
                <ActionWidget secondary tip="Delete revset" onClick={handleDeletePreset}>
                    <Icon name="trash-2" state="remove" /> <span class="delete">Delete</span>
                </ActionWidget>
            {/if}
        </div>
        <textarea
            rows="1"
            bind:this={textarea}
            bind:value
            class:invalid={error}
            on:keydown={onKeyDown}
            on:blur={onBlur}
            autocapitalize="none"
            spellcheck="false"></textarea>
    {/if}
    {#if error}
        <div class="error" role="alert">{error}</div>
    {/if}
</div>

<style>
    .log-selector {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .selector-row {
        display: flex;
        gap: 4px;

        & :global(.wrapper) {
            flex: 1;
        }
    }

    .delete {
        color: var(--ju-colors-error);
    }

    .title {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
        font-family: var(--ju-text-familyUi);
        font-size: 0.8em;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--ju-colors-foregroundSubtle);
        padding: 2px 3px;

        & :global(.feather) {
            height: 12px;
            width: 12px;
            min-width: 12px;
        }
    }

    .summary {
        text-transform: none;
        font-weight: normal;
        font-family: var(--ju-text-familyCode);
        color: var(--ju-colors-foregroundMuted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    textarea {
        font-family: var(--ju-text-familyCode);
        font-size: 14px;
        width: 100%;
        box-sizing: border-box;
        margin: 3px 0;
        resize: none;
        overflow-y: auto;
        /* three lines, then scroll */
        max-height: calc(3lh + 8px);
    }

    textarea.invalid {
        border-color: var(--ju-colors-error);
    }

    .error {
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeSm);
        color: var(--ju-colors-error);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 6em;
        overflow-y: auto;
        padding: 0 3px;
    }
</style>
