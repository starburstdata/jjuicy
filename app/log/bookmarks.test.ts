import { describe, it, expect } from "vitest";
import { absentTargets, groupBookmarks, localCount, mergedTargets, refLabel, syncBadges, withRevision } from "./bookmarks";
import { ENTRIES } from "./bookmarks.fixtures";

describe("bookmarks", () => {
    it("groups locals, tracked and untracked remotes", () => {
        let groups = groupBookmarks(ENTRIES);
        expect(groups.local.map(r => r.label)).toEqual(["feature", "landed", "busy"]);
        expect(groups.tracked.map(r => r.label)).toEqual(["feature@origin", "gone@origin", "busy@origin"]);
        expect(groups.untracked.map(r => r.label)).toEqual(["theirs@upstream"]);
        expect(localCount(ENTRIES)).toBe(3);
    });

    it("badges ahead, diverged, conflict and absent", () => {
        expect(syncBadges(ENTRIES[0]).map(b => b.text)).toEqual(["↑2"]);
        // the backend caps walks at 100, so large counts read as 99+
        expect(syncBadges(ENTRIES[4]).map(b => b.text)).toEqual(["conflict", "↑99+ ↓3"]);
        let gone = groupBookmarks(ENTRIES).tracked.find(r => r.label == "gone@origin")!;
        expect(gone.badges.map(b => b.kind)).toEqual(["absent"]);
    });

    it("collects cleanup targets as store refs", () => {
        expect(mergedTargets(ENTRIES).map(refLabel)).toEqual(["landed"]);
        let absent = absentTargets(ENTRIES);
        expect(absent).toHaveLength(1);
        expect(absent[0]).toMatchObject({ type: "RemoteBookmark", bookmark_name: "gone", remote_name: "origin", is_absent: true });
    });

    it("widens the revset rather than replacing it", () => {
        expect(withRevision("mine()", "abc")).toBe("(mine()) | abc");
        expect(withRevision("  ", "abc")).toBe("abc");
    });
});
