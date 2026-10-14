import type { RepoStatus } from "../messages/RepoStatus";
import { query } from "../ipc";
import { repoStatusEvent } from "../stores";

export const OP_LOG_PAGE = 50;

/** pins the session at a past operation, or returns to the head when id is null */
export async function viewOperation(id: string | null): Promise<string | null> {
    let result = await query<RepoStatus>("view_operation", { id });
    if (result.type == "data") {
        repoStatusEvent.set(result.value);
        return null;
    } else if (result.type == "error") {
        return result.message;
    }
    return null;
}

export function shortOpId(id: string) {
    return id.slice(0, 12);
}
