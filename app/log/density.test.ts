import { describe, expect, it } from "vitest";
import { parseDensity, rowGeometry } from "./density";

describe("density", () => {
    it("defaults to comfortable", () => {
        expect(parseDensity("bogus")).toBe("comfortable");
        expect(parseDensity("compact")).toBe("compact");
    });

    it("keeps the node inside the row", () => {
        for (let d of ["compact", "comfortable"] as const) {
            let g = rowGeometry(d);
            expect(g.nodeY).toBeGreaterThan(0);
            expect(g.nodeY).toBeLessThan(g.rowHeight);
        }
    });
});
