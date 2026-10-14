<script lang="ts">
    import type { RevAuthor } from "../messages/RevAuthor";
    import { avatarMode } from "../stores";
    import { gravatarUrl, hue, initials } from "./avatar";

    export let author: RevAuthor;
    export let size: number = 16;

    $: text = initials(author.name, author.email);
    $: colour = hue(author.email);

    let src: string | null = null;
    let failed = false;
    $: loadGravatar($avatarMode, author.email);

    async function loadGravatar(mode: string, email: string) {
        src = null;
        failed = false;
        if (mode != "gravatar" || email == "") return;
        let url = await gravatarUrl(email, size);
        // a later author may have arrived while hashing - virtualised rows are reused
        if (email == author.email) src = url;
    }
</script>

{#if $avatarMode != "none"}
    <span
        class="avatar"
        style:width="{size}px"
        style:height="{size}px"
        style:font-size="{Math.round(size * 0.5)}px"
        style:--hue={colour}
        title={author.email}>
        {#if src && !failed}
            <img {src} alt="" on:error={() => (failed = true)} />
        {:else}
            {text}
        {/if}
    </span>
{/if}

<style>
    .avatar {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        overflow: hidden;
        background: hsl(var(--hue) 55% 45%);
        color: white;
        font-family: var(--ju-text-familyUi);
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.02em;
        pointer-events: auto;
    }

    img {
        width: 100%;
        height: 100%;
    }
</style>
