import { describe, expect, it } from "vitest";
import { hue, initials, parseAvatarMode } from "./avatar";

describe("initials", () => {
    it("uses first and last words", () => {
        expect(initials("Ada King Lovelace", "ada@example.com")).toBe("AL");
    });

    it("uses two letters of a single word", () => {
        expect(initials("ada", "ada@example.com")).toBe("AD");
    });

    it("falls back to email then placeholder", () => {
        expect(initials("", "zed@example.com")).toBe("Z");
        expect(initials("", "")).toBe("?");
    });
});

describe("hue", () => {
    it("is stable and in range", () => {
        let h = hue("ada@example.com");
        expect(h).toBe(hue("ada@example.com"));
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
    });

    it("varies by email", () => {
        expect(hue("a@example.com")).not.toBe(hue("b@example.com"));
    });
});

describe("parseAvatarMode", () => {
    it("defaults unknown values to initials", () => {
        expect(parseAvatarMode("gravatar")).toBe("gravatar");
        expect(parseAvatarMode("none")).toBe("none");
        expect(parseAvatarMode("bogus")).toBe("initials");
    });
});
