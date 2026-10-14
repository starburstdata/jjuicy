<script lang="ts">
    import type { RevHeader } from "../messages/RevHeader";
    import RevisionMutator from "../mutators/RevisionMutator";
    import { revisionEnablement, type RevisionAction } from "../mutators/enablement";
    import { hasModal } from "../stores";
    import Icon from "../controls/Icon.svelte";

    export let headers: RevHeader[];
    export let ignoreImmutable: boolean;

    let actions: { id: RevisionAction; label: string; icon: string; tip: string }[] = [
        { id: "edit", label: "Edit", icon: "edit-2", tip: "make this the working copy" },
        { id: "new_child", label: "New child", icon: "plus-circle", tip: "create a new revision on top" },
        { id: "new_parent", label: "New before", icon: "plus-square", tip: "insert a new revision before this one" },
        { id: "squash", label: "Squash", icon: "chevrons-down", tip: "squash into parent" },
        { id: "restore", label: "Restore", icon: "rotate-ccw", tip: "restore from parent" },
        { id: "abandon", label: "Abandon", icon: "trash-2", tip: "abandon" },
        { id: "duplicate", label: "Duplicate", icon: "copy", tip: "duplicate" },
        { id: "revert", label: "Backout", icon: "corner-up-left", tip: "revert into the working copy" },
    ];

    $: mutator = new RevisionMutator(headers, ignoreImmutable);
    $: enabled = revisionEnablement(headers, ignoreImmutable);
</script>

<div class="actions" role="toolbar">
    {#each actions as action (action.id)}
        <button
            class="action"
            class:danger={action.id == "abandon"}
            disabled={!enabled[action.id] || $hasModal}
            title={action.tip}
            on:click={() => mutator.handle(action.id)}>
            <Icon name={action.icon} />
            <span>{action.label}</span>
        </button>
    {/each}
</div>

<style>
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .action {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 8px;
        border: 1px solid var(--ju-colors-outline);
        border-radius: 6px;
        background: var(--ju-colors-surface);
        color: var(--ju-colors-foreground);
        font-family: var(--ju-text-familyUi);
        font-size: var(--ju-text-sizeSm);
        cursor: pointer;
        transition: background var(--ju-components-transitionFast);

        & :global(.feather) {
            height: 13px;
            width: 13px;
            min-width: 13px;
        }

        &:hover:not(:disabled) {
            background: var(--ju-colors-surfaceAlt);
        }

        &.danger:hover:not(:disabled) {
            color: var(--ju-colors-removed);
        }

        &:disabled {
            cursor: default;
            opacity: 0.45;
        }
    }
</style>
