import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestContext, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

describe("operation log", () => {
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

    it("fixes conflicts from the status bar", async () => {
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        let counter = page.locator(".status-button.counter.conflict");
        await counter.waitFor({ timeout: 20000 });
        await counter.click();

        await expect.poll(() => page.locator("textarea").inputValue(), { timeout: 10000 }).toBe("conflicts()");
        // the first conflicted revision is selected, and its conflicted file ahead of the rest
        await expect
            .poll(() => page.locator('.log-entry button[aria-selected="true"]').getAttribute("aria-label"), { timeout: 10000 })
            .toMatch(/conflict/);
        let file = page.locator('button.conflict[aria-selected="true"][aria-label$=".txt"]');
        await expect.poll(() => file.getAttribute("aria-label"), { timeout: 10000 }).toBe("conflict_chain.txt");
    });

    it("views a past operation read-only and returns", async () => {
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        let opButton = page.locator('#status-operation button[title="Operation log"]');
        await opButton.waitFor({ timeout: 20000 });
        await opButton.click();

        let entries = page.locator("#op-log li");
        await expect.poll(() => entries.count(), { timeout: 10000 }).toBeGreaterThan(1);
        await entries.nth(1).locator(".view").click();

        let banner = page.locator(".readonly-banner");
        await banner.waitFor({ timeout: 10000 });
        await expect.poll(() => entries.nth(1).getAttribute("class"), { timeout: 10000 }).toContain("viewed");

        await banner.locator("button").click();
        await banner.waitFor({ state: "detached", timeout: 10000 });
        await expect.poll(() => entries.nth(0).getAttribute("class"), { timeout: 10000 }).toContain("viewed");
    });

    it("restores an earlier operation", async () => {
        await ctx.page.goto(serverUrl);
        let page = ctx.page;

        let opButton = page.locator('#status-operation button[title="Operation log"]');
        await opButton.waitFor({ timeout: 20000 });
        await opButton.click();

        let entries = page.locator("#op-log li");
        await expect.poll(() => entries.count(), { timeout: 10000 }).toBeGreaterThan(1);
        await entries.nth(1).locator(".restore").click();
        await page.locator("#dialog-commands button", { hasText: "Restore" }).click();

        await expect
            .poll(() => entries.nth(0).locator(".description").textContent(), { timeout: 10000 })
            .toMatch(/^restore to operation/);
    });
});
