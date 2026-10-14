import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Chip, { type ChipVariant } from "./Chip.svelte";

describe("Chip", () => {
    it("sets title attribute from tip prop", () => {
        let { container } = render(Chip, {
            props: { context: false, target: false, tip: "Tooltip text" },
        });
        let chip = container.querySelector(".chip");
        expect(chip?.getAttribute("title")).toBe("Tooltip text");
    });

    it("defaults to the neutral variant", () => {
        let { container } = render(Chip, { props: { context: false, target: false } });
        expect(container.querySelector(".chip")?.classList.contains("neutral")).toBe(true);
    });

    it.each(["bookmark", "wc", "conflict", "divergent", "tag", "remote", "immutable"] as ChipVariant[])(
        "applies the %s variant class",
        (variant) => {
            let { container } = render(Chip, { props: { context: false, target: false, variant } });
            expect(container.querySelector(".chip")?.classList.contains(variant)).toBe(true);
        },
    );
});
