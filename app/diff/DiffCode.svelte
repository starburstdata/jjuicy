<script lang="ts">
    import type { DiffToken } from "../messages/DiffToken";
    import type { SyntaxSpan } from "./highlight";
    import { splitSpans, syntaxParts } from "./spans";

    export let text: string;
    export let tokens: DiffToken[];
    export let syntax: SyntaxSpan[] = [];

    $: spans = splitSpans(text, tokens);
    $: parts = syntaxParts(spans, syntax);
</script>

<span class="code"
    >{#each spans as span, i}{#if span.changed}<span class="word"
                >{#each parts[i] as part}{#if part.cls}<span class={part.cls}>{part.text}</span>{:else}{part.text}{/if}{/each}</span
            >{:else}{#each parts[i] as part}{#if part.cls}<span class={part.cls}>{part.text}</span>{:else}{part.text}{/if}{/each}{/if}{/each}</span>

<style>
    .code {
        white-space: pre;
        tab-size: 4;
    }

    .word {
        border-radius: 2px;
        background: var(--word-bg);
    }

    .code :global(.syn-keyword) {
        color: var(--ju-syntax-keyword);
    }

    .code :global(.syn-string) {
        color: var(--ju-syntax-string);
    }

    .code :global(.syn-comment) {
        color: var(--ju-syntax-comment);
        font-style: italic;
    }

    .code :global(.syn-number) {
        color: var(--ju-syntax-number);
    }

    .code :global(.syn-type) {
        color: var(--ju-syntax-type);
    }

    .code :global(.syn-function) {
        color: var(--ju-syntax-function);
    }

    .code :global(.syn-punctuation) {
        color: var(--ju-syntax-punctuation);
    }

    .code :global(.syn-variable) {
        color: var(--ju-syntax-variable);
    }
</style>
