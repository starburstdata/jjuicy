<script lang="ts">
    import type { DiffToken } from "../messages/DiffToken";
    import { splitSpans } from "./spans";

    export let text: string;
    export let tokens: DiffToken[];

    $: spans = splitSpans(text, tokens);
</script>

<span class="code">{#each spans as span}{#if span.changed}<span class="word">{span.text}</span>{:else}{span.text}{/if}{/each}</span>

<style>
    .code {
        white-space: pre;
        tab-size: 4;
    }

    .word {
        border-radius: 2px;
        background: var(--word-bg);
    }
</style>
