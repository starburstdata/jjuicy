import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestContext, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

describe("bookmark section", () => {
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

    it("selects a bookmark's target, widening the revset when it isn't loaded", async () => {
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        let toggle = page.locator(".bookmarks-toggle");
        await toggle.waitFor({ timeout: 20000 });
        await toggle.click();

        let main = page.locator('[data-bookmark="main"] button[aria-label="main"]');
        await main.click();
        await expect
            .poll(() => page.locator('.log-entry button[aria-selected="true"]').getAttribute("aria-label"), { timeout: 10000 })
            .toMatch(/^rename c\.txt/);

        // narrow the log so main falls outside it
        let input = page.locator("textarea");
        await input.fill("@");
        await input.press("Enter");
        let showInLog = page.locator('[data-bookmark="main"] .link');
        await showInLog.waitFor({ timeout: 10000 });
        await showInLog.click();

        await expect.poll(() => input.inputValue(), { timeout: 10000 }).toMatch(/^\(@\) \| [0-9a-f]{40}$/);
        await expect
            .poll(() => page.locator('.log-entry button[aria-selected="true"]').getAttribute("aria-label"), { timeout: 10000 })
            .toMatch(/^rename c\.txt/);
    });
});
