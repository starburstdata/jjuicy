// PRD §7 budget measurement; skipped unless asked for, and only meaningful against a release build:
//   cargo build --release && npm run build
//   JU_PERF=1 JU_BIN=target/release/ju npx vitest run --project e2e e2e/perf-budgets.test.ts
import { it } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

async function run(setup: (dir: string) => void, act: (page: any) => Promise<void>, name: string) {
    let ctx = await createContext();
    try {
        extractTestRepo(ctx.tempDir);
        setup(ctx.tempDir);
        let url = await startGG(ctx);
        await ctx.page.goto(url);
        let parent = ctx.page.locator('.log-entry button[aria-label^="rename c.txt"]').first();
        let wc = ctx.page.locator(".log-entry button").first();
        await parent.waitFor({ timeout: 30000 });
        await ctx.page.waitForTimeout(1000);
        let out: number[] = [];
        for (let n = 0; n < 7; n++) {
            await parent.click();
            await ctx.page.waitForTimeout(400);
            await ctx.page.evaluate(() => performance.clearMeasures());
            await wc.click();
            await act(ctx.page);
            await ctx.page.waitForTimeout(600);
            let m = await ctx.page.evaluate((n: string) => performance.getEntriesByName(n).map((e) => e.duration), name);
            out.push(Math.round(m[m.length - 1]));
        }
        return out;
    } finally {
        await destroyContext(ctx);
    }
}

it.runIf(process.env.JU_PERF)("measure budgets", async () => {
    let files = await run(
        (dir) => {
            mkdirSync(join(dir, "many"));
            for (let i = 0; i < 500; i++) writeFileSync(join(dir, "many", `f${i}.txt`), `file ${i}\n`);
        },
        async () => {},
        "select-revision",
    );
    let diff = await run(
        (dir) => {
            let big = [];
            for (let i = 0; i < 2000; i++) big.push(`fn f${i}(x: u32) -> u32 { let s = "str"; x + ${i} } // c`);
            writeFileSync(join(dir, "big.rs"), big.join("\n") + "\n");
            writeFileSync(join(dir, "small.txt"), "x\n");
        },
        async (page) => {
            await page.locator('button[aria-label="small.txt"]').click();
            await page.waitForTimeout(400);
            await page.evaluate(() => performance.clearMeasures());
            await page.locator('button[aria-label="big.rs"]').click();
        },
        "select-file",
    );
    console.info(JSON.stringify({ "select-revision (500 files)": files, "select-file (2k lines)": diff }));
});
