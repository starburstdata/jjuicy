import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { TestContext, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

describe("diff viewer hunk drag and drop", () => {
    let ctx: TestContext;
    let serverUrl: string;

    async function apiQuery(command: string, body: unknown) {
        let response = await fetch(`${serverUrl}/api/query/${command}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        let result = await response.json();
        expect(response.ok, `${command} failed (${response.status}): ${JSON.stringify(result)}`).toBe(true);
        return result;
    }

    async function detail(revset: string) {
        let log = await apiQuery("query_log", { revset });
        let id = log.rows[0].revision.id;
        return apiQuery("query_revisions", { set: { from: id, to: id } });
    }

    beforeEach(async () => {
        ctx = await createContext();
        extractTestRepo(ctx.tempDir);
        // snapshotted into the working copy when the workspace loads
        writeFileSync(join(ctx.tempDir, "a.txt"), "1\n2\nchanged\n4\n");
        serverUrl = await startGG(ctx);
    });

    afterEach(async () => {
        await destroyContext(ctx);
    });

    it("dragging a hunk header onto the parent moves the hunk", async () => {
        await ctx.page.goto(serverUrl);

        let hunk = ctx.page.locator('.diff button[aria-label^="@@"]').first();
        await hunk.waitFor({ timeout: 20000 });

        // main_bookmark is the working copy's parent
        let parent = ctx.page.locator('.log-entry button[aria-label^="rename c.txt"]').first();
        await hunk.dragTo(parent);

        await expect
            .poll(async () => (await detail("@-")).changes.map((c: any) => c.path.repo_path), { timeout: 10000 })
            .toContain("a.txt");
        let wc = await detail("@");
        expect(wc.changes.map((c: any) => c.path.repo_path)).not.toContain("a.txt");
    });
});
