<script lang="ts">
    import type { FileDiffKind } from "../messages/FileDiffKind";
    import Icon from "../controls/Icon.svelte";
    import { formatSize } from "./items";

    export let kind: Extract<FileDiffKind, { type: "Binary" | "TooLarge" }>;
</script>

<div class="card">
    <Icon name={kind.type == "Binary" ? "file" : "alert-triangle"} />
    <div class="text">
        <div class="title">
            {kind.type == "Binary"
                ? `Binary file (${kind.old_size} → ${kind.new_size} bytes)`
                : `File too large to diff (${kind.old_size} → ${kind.new_size} bytes)`}
        </div>
        <div class="sizes">{formatSize(kind.old_size)} → {formatSize(kind.new_size)}</div>
    </div>
</div>

<style>
    .card {
        margin: 12px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px dashed var(--ju-colors-outline);
        border-radius: 6px;
        color: var(--ju-colors-foregroundMuted);
        font-size: var(--ju-text-sizeMd);
    }

    .title {
        color: var(--ju-colors-foreground);
    }

    .sizes {
        font-family: var(--ju-text-familyCode);
        font-size: var(--ju-text-sizeSm);
    }
</style>
