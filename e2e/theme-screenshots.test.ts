// visual check of every bundled theme in both schemes (plan §3.3 exit gate); not an assertion,
// so it only runs on request:
//   npm run build && JU_SHOTS=/tmp/shots JU_BIN=target/release/ju npx vitest run --project e2e e2e/theme-screenshots.test.ts
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PROJECT_ROOT, createContext, destroyContext, extractTestRepo, startGG } from "./harness.js";

const THEMES = ["default", "macos", "material", "fluent"];

describe.runIf(process.env.JU_SHOTS)("theme screenshots", () => {
    for (let theme of THEMES) {
        it(theme, async () => {
            let out = process.env.JU_SHOTS!;
            mkdirSync(out, { recursive: true });
            let ctx = await createContext();
            try {
                extractTestRepo(ctx.tempDir);
                writeFileSync(join(ctx.tempDir, "a.txt"), "1\n2\nchanged\n4\n");
                // the theme is read from startup settings, before any repo config is loaded
                let config = join(out, `${theme}-config.toml`);
                writeFileSync(config, `[jjuicy.ui]\ntheme-file = ${JSON.stringify(join(PROJECT_ROOT, "res", "themes", `${theme}.toml`))}\n`);
                process.env.JJ_CONFIG = config;
                let serverUrl = await startGG(ctx);
                for (let scheme of ["light", "dark"] as const) {
                    await ctx.page.setViewportSize({ width: 1400, height: 860 });
                    await ctx.page.emulateMedia({ colorScheme: scheme });
                    await ctx.page.goto(serverUrl);
                    await ctx.page.waitForSelector(".diff", { timeout: 30000 });
                    await ctx.page.waitForTimeout(500);
                    await ctx.page.screenshot({ path: join(out, `${theme}-${scheme}.png`) });
                }
            } finally {
                delete process.env.JJ_CONFIG;
                await destroyContext(ctx);
            }
        }, 120000);
    }
});
