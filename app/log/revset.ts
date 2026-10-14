export type Preset = { label: string; value: string; separator?: boolean };

function toTitleCase(kebab: string): string {
    return kebab
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function toKebabCase(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

// revsets.log first, followed by the presets
export function presetList(query_choices: Record<string, string>): Preset[] {
    let result: Preset[] = [];

    if (query_choices["default"] !== undefined) {
        result.push({ label: "Default", value: query_choices["default"] });
    }

    let others = Object.entries(query_choices)
        .filter(([key]) => key !== "default")
        .map(([key, value]) => ({ label: toTitleCase(key), value }))
        .sort((a, b) => a.label.localeCompare(b.label));

    if (others.length > 0) {
        result.push({ label: "", value: "", separator: true });
        result.push(...others);
    }

    return result;
}

export function withCustom(query: string, presets: Preset[]): Preset[] {
    if (presets.some((p) => query == p.value)) {
        return presets;
    }
    return [{ label: "Custom", value: query }, ...presets];
}
