---
name: release
description: Cut a new jjuicy release: draft the changelog from recent commits, bump version, commit+tag, push, create GitHub release, open homebrew PR. Use when the user says "cut a release", "do a release", "release jjuicy", or asks to bump the version and publish.
---

# Release jjuicy

Automates the full release pipeline via `scripts/release.py`.

## Step 1 — determine bump type

If the user hasn't specified, ask:
> Patch (bug fixes only), minor (new features), or major (breaking changes)?

Default to **patch** if the changes look like fixes only.

## Step 2 — generate changelog proposal

Run:
```
python3 scripts/release.py generate [--bump patch|minor|major | --version X.Y.Z]
```

This prints JSON to stdout with `version` and `commits` fields (raw commit
descriptions since the last release tag). The script no longer drafts the
changelog itself — **you** draft it from the commits.

Draft a changelog body in keepachangelog.com style:
- `### Added` / `### Changed` / `### Fixed` sections (omit any that are empty)
- One concise bullet per user-visible change
- Skip internal commits: version bumps, formatting, CI, test infrastructure
- Do **not** include the `## [version]` header line — the script adds it

Show the user:
- The proposed version
- The drafted changelog as markdown
- The raw commits (collapsed or summarized) for reference

Ask:
> Does this changelog look right? Any additions, corrections, or changes?

Apply any requested edits to the changelog text directly.

## Step 3 — write changelog to temp file

Write the final (possibly user-edited) changelog body to a temp file, e.g. `/tmp/jjuicy-changelog.md`.
Do **not** include the `## [version]` header — the script adds that.

## Step 4 — execute the release

Once the user approves, run:
```
python3 scripts/release.py execute --version <version> --changelog-file /tmp/jjuicy-changelog.md
```

This will:
1. Update `Cargo.toml`, `package.json`, `Tauri.toml`
2. Run `cargo update` and `npm update`
3. Prepend the new section to `CHANGELOG.md`
4. `jj commit` the version bump
5. Create the `v<version>` tag
6. Push to GitHub (bookmarks + tag)
7. Create the GitHub release with the changelog as release notes
8. Fetch the auto-generated source tarball and compute its SHA256
9. Clone `starburstdata/homebrew-jjuicy`, update `Formula/jjuicy.rb`, and open a PR

## Step 5 — report back

Show the user:
- The GitHub release URL
- The homebrew PR URL

## Notes

- Requires `gh` CLI authenticated and `git` available for `execute`.
- If `generate` returns no commits, there is nothing to release — tell the user.
- If the user wants to preview without touching the repo, run only `generate` and stop there.
