import type { MutationResult } from "./messages/MutationResult";
import type { ProgressEvent } from "./messages/ProgressEvent";
import type { RepoConfig } from "./messages/RepoConfig";
import type { RepoStatus } from "./messages/RepoStatus";
import type { RevHeader } from "./messages/RevHeader";
import type { RevSet } from "./messages/RevSet";
import type { Operand } from "./messages/Operand";
import { writable } from "svelte/store";
import { event, type Query } from "./events";
import type { InputRequest } from "./messages/InputRequest";
import type { InputResponse } from "./messages/InputResponse";
import type { FileSelection } from "./files/files";
import type { Density } from "./log/density";
import type { AvatarMode } from "./controls/avatar";

export const repoConfigEvent = await event<RepoConfig>("jjuicy://repo/config", { type: "Initial" });
export const repoStatusEvent = await event<RepoStatus | undefined>("jjuicy://repo/status", undefined);
export const revisionSelectEvent = await event<RevSet | undefined>("jjuicy://revision/select", undefined);
export const progressEvent = await event<ProgressEvent | undefined>("jjuicy://progress", undefined);

export const currentMutation = writable<Query<MutationResult> | null>(null);
export const currentContext = writable<Operand | null>();
export const currentSource = writable<Operand | null>();
export const currentTarget = writable<Operand | null>();
export const currentInput = writable<InputRequest & { callback: (response: InputResponse | null) => void } | null>();

export const hasModal = writable<boolean>(false);
export const hasMenu = writable<{ x: number; y: number } | null>(null);
export const lastFocus = writable<number>(Date.now());
export const ignoreToggled = writable<boolean>(false);

export const selectionHeaders = writable<RevHeader[]>([]);
// set by widgets outside the log pane (e.g. status bar counters) to replace the revset
export const logQueryRequest = writable<string | null>(null);

export const logDensity = writable<Density>("comfortable");
export const avatarMode = writable<AvatarMode>("initials");

export function dragOverWidget(event: DragEvent) {
    event.stopPropagation();
    currentTarget.set(null);
}
export function persisted<T>(key: string, initial: T) {
    let start = initial;
    try {
        let raw = localStorage.getItem(key);
        if (raw !== null) start = JSON.parse(raw) as T;
    } catch {
        // corrupt or unavailable storage - use the default
    }
    let store = writable<T>(start);
    store.subscribe(value => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // storage unavailable - value just won't persist
        }
    });
    return store;
}

export const sidebarCollapsed = persisted<boolean>("jjuicy.sidebarCollapsed", false);
// consumed by the bookmark section (phase 4); the log column header owns the toggle
export const bookmarksExpanded = persisted<boolean>("jjuicy.bookmarksExpanded", false);
export const filesView = persisted<"list" | "tree">("jjuicy.filesView", "list");
// shared by the files column and the detail pane; each resolves it against its own revs
export const selectedFile = writable<FileSelection | null>(null);
