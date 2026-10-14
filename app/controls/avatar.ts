export type AvatarMode = "initials" | "gravatar" | "none";

export function parseAvatarMode(value: string | undefined): AvatarMode {
    return value == "gravatar" || value == "none" ? value : "initials";
}

export function initials(name: string, email: string): string {
    let words = name.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    if (words.length == 1) {
        return words[0].substring(0, 2).toUpperCase();
    }
    return email.substring(0, 1).toUpperCase() || "?";
}

// fnv-1a: stable across sessions so an author keeps their colour
export function hue(email: string): number {
    let h = 0x811c9dc5;
    let key = email.trim().toLowerCase();
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) % 360;
}

// gravatar accepts sha-256 as well as md5, and webcrypto saves bundling an md5 implementation
export async function gravatarUrl(email: string, size: number): Promise<string | null> {
    if (!globalThis.crypto?.subtle) return null;
    let bytes = new TextEncoder().encode(email.trim().toLowerCase());
    let digest = await crypto.subtle.digest("SHA-256", bytes);
    let hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return `https://gravatar.com/avatar/${hex}?s=${size * 2}&d=404`;
}
