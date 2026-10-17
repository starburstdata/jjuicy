import { describe, expect, it } from "vitest";
import { parseDensity, rowGeometry } from "./density";

describe("density", () => {
    it("defaults to comfortable", () => {
        expect(parseDensity("bogus")).toBe("comfortable");
        expect(parseDensity("compact")).toBe("compact");
    });

    it("centres the node in the row", () => {
        for (let d of ["compact", "comfortable"] as const) {
            let g = rowGeometry(d);
            expect(g.nodeY).toBeGreaterThan(0);
            expect(g.nodeY).toBe(g.rowHeight / 2);
        }
    });
});
