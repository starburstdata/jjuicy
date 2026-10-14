import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { TestContext, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

describe("files column drag and drop", () => {
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
        writeFileSync(join(ctx.tempDir, "dragged.txt"), "moved by drag\n");
        serverUrl = await startGG(ctx);
    });

    afterEach(async () => {
        await destroyContext(ctx);
    });

    it("dragging a file onto the parent moves the change", async () => {
        await ctx.page.goto(serverUrl);

        let file = ctx.page.locator('button[aria-label="dragged.txt"]');
        await file.waitFor({ timeout: 20000 });

        // main_bookmark is the working copy's parent
        let parent = ctx.page.locator('.log-entry button[aria-label^="rename c.txt"]').first();
        await file.dragTo(parent);

        await expect
            .poll(async () => (await detail("@-")).changes.map((c: any) => c.path.repo_path), { timeout: 10000 })
            .toContain("dragged.txt");
        let wc = await detail("@");
        expect(wc.changes.map((c: any) => c.path.repo_path)).not.toContain("dragged.txt");
    });
});
