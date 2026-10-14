import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { TestContext, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

describe("file history", () => {
    let ctx: TestContext;
    let serverUrl: string;

    beforeEach(async () => {
        ctx = await createContext();
        extractTestRepo(ctx.tempDir);
        serverUrl = await startGG(ctx);
    });

    afterEach(async () => {
        await destroyContext(ctx);
    });

    it("filters the log to revisions touching a file", async () => {
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        await page.locator('.log-entry button[aria-label^="create c.txt and change a.txt"]').first().click();
        let file = page.locator('button[aria-label="a.txt"]').first();
        await file.waitFor({ timeout: 20000 });
        await file.click({ button: "right" });
        await page.locator('[role="menu"] button', { hasText: "Show history" }).click();

        await expect.poll(() => page.locator("textarea").inputValue(), { timeout: 10000 }).toBe('files(root-file:"a.txt")');
        await expect
            .poll(() => page.locator(".log-entry button[aria-label]").count(), { timeout: 10000 })
            .toBeGreaterThan(0);
        let labels = await page.locator(".log-entry button[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        expect(labels.some((l) => /^create a\.txt/.test(l ?? ""))).toBe(true);
        expect(labels.some((l) => /^rename c\.txt/.test(l ?? ""))).toBe(false);
    });

    it("restores the working copy from an earlier version", async () => {
        // the snapshot at startup makes a second version of the working copy
        writeFileSync(join(ctx.tempDir, "evolved.txt"), "evolved\n");
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        await page.locator('[role="tab"]', { hasText: "Changes" }).waitFor({ timeout: 20000 });
        await expect.poll(() => page.locator(".change .file-header").count(), { timeout: 10000 }).toBe(1);

        await page.locator('[role="tab"]', { hasText: "History" }).click();
        let versions = page.locator(".versions li");
        await expect.poll(() => versions.count(), { timeout: 10000 }).toBe(2);
        await versions.nth(1).locator(".version").click();
        await expect.poll(() => page.locator(".evolog .empty").count(), { timeout: 10000 }).toBe(1);

        await versions.nth(1).locator(".restore").click();
        // restoring rewrites the change, adding a third version
        await expect.poll(() => versions.count(), { timeout: 10000 }).toBe(3);

        await page.locator('[role="tab"]', { hasText: "Changes" }).click();
        await expect.poll(() => page.locator(".changes-header .no-changes").count(), { timeout: 10000 }).toBe(1);
    });
});
