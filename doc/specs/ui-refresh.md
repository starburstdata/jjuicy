# PRD: jjuicy UI Refresh

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-13 |
| **Inspiration** | [jayjay](https://github.com/hewigovens/jayjay) ([screenshot](https://github.com/hewigovens/jayjay/raw/main/docs/imgs/home.webp)) |

## 1. Summary

jjuicy's interaction model is good: you edit the repo by dragging things around, and every operation can be undone. Its visual design has fallen behind. Today the window has a labelled toolbar, a log pane on the left, and a detail pane on the right that puts the description, the parents, and a long accordion of files with inline unified diffs into one scrolling column. The log uses dense one-line rows and truncates descriptions heavily, and diffs have no syntax highlighting.

This PRD proposes a new layout based on jayjay's: a compact unified header, a **three-column body** (log → files → diff), richer two-line log cards, a real code-review-quality diff viewer, and an informative status bar. It also proposes a set of features that the new layout makes possible: a bookmark section, an operation log, file history, and evolog.

The refresh must **keep jjuicy's core metaphor, direct manipulation** (see `doc/DESIGN.md`). Every object that can be dragged or right-clicked today must still support drag and right-click in the new layout.

> **Licensing note:** the jayjay apps are BSL 1.1. Only its crates are Apache-2.0. We take *layout and interaction* inspiration only. We do not copy code or assets.

## 2. Problem statement

| # | Problem | Evidence |
|---|---|---|
| P1 | The detail pane mixes metadata, editing, and diff reading in one scroll. With large changes (80+ files), the description and parents scroll out of view, and you have to expand files one at a time to read the diff. | `RevisionPane.svelte` renders the description, the parents, and `{#each syntheticChanges}` with inline `<pre class="diff">` |
| P2 | Diffs are unified only, plain text, and have no word-level highlighting. They are hard to review. | `lineColour(line)` colours whole lines by prefix |
| P3 | Log rows are single-line and get truncated when bookmarks are present (`improve ca...`). The author column uses up horizontal space. | Current screenshot |
| P4 | The toolbar takes a full row of large labelled buttons for 7 actions. Most other actions can only be found through context menus. | `Toolbar.svelte` |
| P5 | The revset selector takes three rows (title, preset dropdown, text input) above the log. | `LogPane.svelte` header |
| P6 | There is no way to see repo-wide state (conflicts, divergence, working-copy dirtiness) without scrolling the log. | Status bar shows only the path and the last operation |

## 3. Goals and non-goals

### Goals
1. Reach visual parity with modern review tools: clear hierarchy, generous whitespace, and a consistent type scale.
2. Separate **navigation** (log, files) from **reading** (diff) from **editing** (description).
3. Provide a first-class diff viewer: side-by-side and unified modes, syntax highlighting, word-level changes.
4. Keep direct manipulation (drag-drop and context menus) working everywhere, in both GUI and web mode.
5. Stay within the existing theme system (`res/themes/*.toml`, `--ju-*` CSS tokens).

### Non-goals
- A native rewrite (SwiftUI/GPUI). We remain Tauri + Svelte.
- Forge integration (PR/CI status), AI commit messages, and a review-notes CLI. These are listed under [Future](#9-future--out-of-scope) only.
- Replacing external diff/merge tool support.
- Mobile or narrow-screen layouts below 900px wide, beyond a collapsing fallback.
- Keyboard-driven navigation beyond what exists today (command palette, single-key shortcuts, focus cycling). The refresh is mouse/UI-first; existing accelerators (Ctrl+N/M/O, ⌘↩ to describe) keep working.
- Supporting the old layout. The refresh lands on its own bookmark and ships as a new major version; users who prefer the current UI can stay on the previous major.

## 4. Users and key scenarios

- **Daily jj user:** browses the stack, rewords descriptions, squashes and moves hunks, and pushes.
  - *Scenario:* "I select a change, click a file, read a side-by-side diff, and drag a hunk to the parent."
- **Reviewer of their own stack before pushing:** reads each change top to bottom.
  - *Scenario:* "I click a revision, then click through its files in the Files column; each diff appears immediately without expanding anything."
- **Conflict fixer:**
  - *Scenario:* "The status bar shows *1 conflicted*. I click it, the log jumps to the conflicted change, and the conflicted file is preselected."

## 5. Proposed layout

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [▤] [⟳] [↓] [↑]   repo / workspace ▾                                        [>_] [⚙] │  header
├──────────────────────┬────────────────┬────────────────────────────────────────────────┤
│ Revset [Default ▾] 💾│ ☰ ⌕     2 files│ feat: include transfer time …   ✎ Edit   ⇕     │
│ present(@) | trunk() │                │ ◉ Author · uylryvwq ⧉ · Sep 30 21:05    +21 −2 │
│ ⚑ Bookmarks 4 ▾   12 │                │                                                │
│──────────────────────│────────────────│────────────────────────────────────────────────│
│ ● kuutuxvx  @        │ ~ cache.rs     │                                                │
│   (no description)   │   src/         │ src/routes.rs ⧉ Modified +7 −2  [Side-by-side] │
│   62165ffe ◉ CI 1m   │▐~ routes.rs   ▌│ 1 │ use crate::…        │ 1 │ use crate::…       │
│▐● uylryvwq          ▌│▐  src/        ▌│ 6 │-candidates.sort…    │ 6 │+candidates.sort…   │
│▐  feat: include …   ▌│                │ … │                     │ … │                    │
│ ○ ovqruwkp ⚑faster…  │                │                                                │
│   …                  │                │                                                │
├──────────────────────┴────────────────┴────────────────────────────────────────────────┤
│ 🛡 /path/to/repo                    ⟲ snapshot working copy · 4 files +17 −1 · ⑂1 · ⚠1 │  status
└────────────────────────────────────────────────────────────────────────────────────────┘
```

All three column dividers are draggable. Column widths are saved per window in local storage. The sidebar toggle (`▤`) collapses the log column.

## 6. Requirements

Priority: **P0** = required for the refresh to ship, **P1** = fast follow, **P2** = nice to have.

### 6.1 Header / toolbar (P0)

| ID | Requirement |
|---|---|
| H-1 | A single compact row replaces the labelled toolbar. The revset block moves into the log column (§6.2, L-0). In GUI mode on macOS, it merges with the title bar (`titleBarStyle: Overlay`) and leaves room for the traffic lights. |
| H-2 | Icon-only buttons with tooltips: **toggle sidebar**, **refresh/snapshot**, **fetch** (split button showing a remote menu, as today), **push** (split button). |
| H-3 | **Breadcrumb**: `repo-name / workspace ▾`. The dropdown lists the workspaces in the repo (switch / forget) and recent repositories (`query_recent_workspaces`). |
| H-4 | Right side: **open terminal here** (Tauri only), **settings**. |
| H-5 | The revision actions currently in the toolbar (Edit/New/Squash/Restore/Undo) move into the detail header (§6.4) and the context menus. Undo also moves to the status bar. |
| H-6 | Progress (`ToolbarProgress`) is shown as a thin indeterminate bar along the bottom edge of the header, plus a spinner on the button that started the operation. |

### 6.2 Log column (P0)

| ID | Requirement |
|---|---|
| L-0 | **Revset section**, pinned at the top of the log column (it scopes the log, so it lives with it). It keeps full parity with today's `LogPane` header:<ul><li>Preset dropdown (`Default` plus `jjuicy.presets`), with **Save** and **Delete** preset buttons on the same row.</li><li>An always-visible, editable monospace input that wraps to 2–3 lines for long revsets. Enter or blur re-runs the query, as today.</li><li>Revset errors are shown inline under the input, not in a dialog.</li></ul>The section can be collapsed to a single line that shows the active preset name or revset, but it is expanded by default. P1: autocomplete revset functions, bookmarks, and aliases. |
| L-1 | **Two-line revision cards.**<br>Line 1: change id (shortest-prefix highlight kept) followed by chips: `@`/workspace, bookmarks, tags, `conflict`, `divergent`, `immutable` (lock icon).<br>Line 2: the full first line of the description, wrapped to at most 2 lines. `(no description)` is shown muted.<br>Line 3: commit id (muted), author avatar, author name, and relative time. |
| L-2 | The graph keeps the current `GraphLog`/`GraphLine` rendering, rescaled to the taller row height. Node glyphs keep their meaning: filled = mutable, hollow = immutable, `@` = working copy, red = conflict, diamond = root/trunk. |
| L-3 | Selection is a full-width tinted card with a 3px accent bar on the left, not a solid blue fill. Hover gives a subtle tint. |
| L-4 | **Column header** (below the revset section): a "Bookmarks *N* ▾" toggle that expands or collapses the bookmark section (§6.6), and a count of the changes in the current revset. |
| L-5 | Virtualization must keep working with the variable/taller row height. Rows stay keyed by slot index (see AGENTS.md). |
| L-6 | Two-line cards are the default for every repo, including those over `large-repo-heuristic`. An opt-in compact density setting (`jjuicy.ui.log-density = "comfortable" \| "compact"`) gives single-line rows like today's. |
| L-7 | Drag and drop is unchanged: cards are `Object` drag sources and `Zone` drop targets, and bookmark chips can be dragged. |

### 6.3 Files column (P0)

| ID | Requirement |
|---|---|
| F-1 | Lists the changed files of the selected revision or range. Each row has a status badge (`+` added, `~` modified, `−` deleted, `→` renamed, `!` conflict), the **file name in bold**, and the directory path muted below it. |
| F-2 | **List/tree toggle** (☰). Tree mode groups files by directory, with collapsible folders and aggregated `+/−` counts. |
| F-3 | **Filter** (⌕): fuzzy filter on the path. |
| F-4 | Header shows "*N* files". Conflicted files sort first. |
| F-5 | Clicking a file shows its diff in the detail column. |
| F-6 | Each row is a `ChangeObject`, so it stays draggable (squash/restore/move to another revision) and keeps its existing context menu. |
| F-7 | "All files" pseudo-entry at the top shows every file's diff stacked in one scroll, like today's behaviour but with the new renderer. |

### 6.4 Detail column (P0)

**Revision header**

| ID | Requirement |
|---|---|
| D-1 | **Title**: the first line of the description in a large heading, with `✎ Edit` beside it. Edit opens an inline editor (the existing textarea, Reset author, Describe, ⌘↩ to commit). The rest of the description body is shown under the title, collapsed after 3 lines with a "show more" control. |
| D-2 | **Metadata row**: avatar, author, change id (copy button), commit id (copy), timestamp (absolute; relative on hover), and the total `+X −Y` on the right. Flags as chips: Working copy, Immutable, Conflict, Divergent. |
| D-3 | **Action row**, icon + label, contextual: Edit, New child, New before/after, Squash into parent, Restore, Abandon, Duplicate, Backout. This mirrors `RevisionMutator`. Disabled states follow the existing immutability rules and `ignoreToggled`. |
| D-4 | **Parents**: shown as compact chips under the metadata (`parent: utsvzuup Make multi-revision…`). They remain drop zones for the `Merge` operand. |
| D-5 | A **multi-select range** shows the existing combined header (set span, author list, time range) and a scrollable list of the descriptions. |

**Diff viewer**

| ID | Requirement |
|---|---|
| D-6 | **File header**: path (directory muted, name bold), copy-path button, status badge, `+X −Y`, the **Unified / Side-by-side** toggle (saved globally), and the **Open in external diff** button (existing `ExternalDiff`). |
| D-7 | **Side-by-side mode**: old file on the left and new file on the right, each with a line-number gutter. Removed and added lines are tinted, and blank spacer rows keep the hunks aligned. |
| D-8 | **Unified mode**: dual gutters (old/new line numbers). |
| D-9 | **Word-level highlighting** within changed lines, with a darker tint on the changed tokens. |
| D-10 | **Syntax highlighting** chosen by file extension, with colours taken from the theme tokens so light/dark themes and custom themes apply. |
| D-11 | **Expandable context**: "⋯ N unchanged lines" separators between hunks expand in place (up 20, down 20, or all). |
| D-12 | **Hunk drag handle**: each hunk has a header bar (`@@ … @@`) that remains a `HunkObject` drag source. It also gets a context menu (move hunk to parent/child/working copy, discard hunk). |
| D-13 | **Conflicts** render as their own blocks (side/base/side) with clear labels, replacing the current marker-stripe styling. Actions: open external resolver, accept side A, accept side B. |
| D-14 | Binary, too-large, and LFS files show a placeholder card ("Binary file, 1.2 MB → 1.3 MB"). |
| D-15 | **Rename detection**: show `old/path → new/path` in the file header. |

### 6.5 Status bar (P0)

| ID | Requirement |
|---|---|
| S-1 | Left: immutability shield toggle (existing) and the workspace path. |
| S-2 | Right: last operation (click opens the operation log, §6.7) with an **undo** button (⟲), then **clickable counters**: working-copy changes (`4 files +17 −1`), `⑂ N divergent`, `⚠ N conflicted`. Clicking a counter sets the revset to the matching set (`@`, `divergent()`, `conflicts()`) and selects the first result. |
| S-3 | While dragging, the status bar becomes the drop hint bar, as it does today (`drag-bar`). |

### 6.6 Bookmark section (P1)

| ID | Requirement |
|---|---|
| B-1 | A persistent collapsible section between the revset section and the log. Its expanded/collapsed state and height (it has a drag handle) are saved per window. It lists all bookmarks, grouped *Local*, *Tracked remote*, and *Untracked remote*. Each entry shows its sync state: ahead, behind, diverged, or absent. |
| B-2 | Clicking a bookmark selects and scrolls to its revision. Bookmarks can be dragged onto log cards, which moves the bookmark using the existing `MoveRef`. |
| B-3 | Cleanup actions: "Delete merged bookmarks" and "Forget absent remotes". Each shows a confirmation that lists the affected bookmarks. |

### 6.7 Operation log (P1)

| ID | Requirement |
|---|---|
| O-1 | A slide-over panel listing operations: description, time, user@host. |
| O-2 | Actions: **undo to here** (`jj op restore`) and **view repo at this op**. The second reloads the log read-only at that operation, with a banner saying so. This covers the TODO item "View the repo at past ops". |

### 6.8 History (P1/P2)

| ID | Priority | Requirement |
|---|---|---|
| X-1 | P1 | **File history**: a context menu entry on a file opens a list of the revisions that touched it (`files(path)` revset). Selecting one shows that revision's diff for the file. |
| X-2 | P1 | **Evolog**: a "History" tab in the detail header lists the previous versions of the change. Selecting a version shows that version's own diff against its parents; an earlier version can be restored. |
| X-3 | P2 | **Annotate (blame)** mode in the diff viewer for the new side. |

### 6.9 Visual design system (P0)

| ID | Requirement |
|---|---|
| V-1 | **Typography**: system UI font for chrome, monospace for ids, paths in diffs, and code. Type scale: 11 / 12 / 13 / 15 / 20 px (title). |
| V-2 | **Chips**: one rounded chip component (`Chip.svelte` extended) with semantic colour variants: bookmark (purple), working copy (green), conflict (red), divergent (amber), tag (teal), remote-only (outlined). |
| V-3 | **Surfaces**: flat backgrounds with hairline dividers instead of the current heavy borders. Add the new tokens (`diffAddBg`, `diffAddWordBg`, `diffDelBg`, `diffDelWordBg`, `gutter`, `selectionBar`, `syntax.*`) to all bundled themes (`default`, `fluent`, `macos`, `material`). Custom theme files fall back to defaults for missing tokens. |
| V-4 | **Avatars**: initials on a colour hashed from the email by default. Gravatar is opt-in (`jjuicy.ui.avatars = "initials" \| "gravatar" \| "none"`) because it sends a network request. |
| V-5 | Icons: keep the existing feather icon set (`Icon.svelte`) and add the missing glyphs (sidebar, terminal, command, pin, history). |
| V-6 | Accessibility: WCAG AA contrast for text and diff tints in both light and dark; visible focus rings on all interactive elements; roles and labels on the columns. |

## 7. Technical considerations

### Backend (Rust)
- **New query `query_file_diff(rev_set, path, context)`**. It returns a structured diff with line numbers on both sides, intra-line token ranges, and hunk boundaries. The current `ChangeHunk { lines: MultilineString }` is prefix-encoded text and cannot carry word ranges. jj-lib's `diff` module already tokenises words (`DiffTokenVec` in `queries.rs`), so we expose that data instead of recomputing it in TypeScript.
- **Lazy loading**: `query_revisions` should return only the file list and stats (`+/−` per file). Hunks are fetched per file on selection. This keeps 80-file changes fast and fixes P1.
- **Context expansion**: `query_file_lines(rev, path, side, range)` serves the lines behind the expand separators.
- **New messages** (`src/messages/`): `RevChangeSummary`, `FileDiff`, `DiffRow`, `DiffToken`, `OpLogEntry`, `RepoSummary` (counters for the status bar). Run `cargo gen` after adding them.
- **Status counters**: compute `conflicts()`, `divergent()`, and the working-copy stat after each snapshot and push them via `RepoStatus`. Skip them when `is_large` holds (large-repo heuristic).
- **New mutations**: `RestoreOperation` (op restore), `RestoreFromEvolog`, `ResolveConflictSide` (D-13 accept-side). Follow the mutation conventions in AGENTS.md.

### Frontend (Svelte)
- **Syntax highlighting**: done in the frontend (decided, §11), with a small, tree-shakeable highlighter. Candidates are Shiki with the JS regex engine, or Lezer/CodeMirror language packages. Map the output to theme CSS variables rather than to bundled themes. It must work offline and in web mode. Highlight only the lines that are visible, using the virtualised diff rows.
- **Diff virtualisation**: very large files (>5k lines) need virtualised rows, using the same slot-index keying rules as the log.
- **Layout**: replace `Pane.svelte`'s two-pane split with a `SplitView` component (n columns, persisted sizes).
- **Keyboard**: existing GUI accelerators (`forward_accelerator`) and ⌘↩ in the description editor keep working. No new shortcuts.
- **Drag and drop**: `Object`/`Zone` work in the new columns without change. Add e2e coverage for dragging a file from the Files column and a hunk from the diff viewer.

### Web mode
- Every feature must work in `ju web`. The terminal button is hidden in web mode, and the title bar merge applies to GUI mode only.

### Performance budgets
- Selecting a revision → file list rendered: < 100 ms for 500 files.
- Selecting a file → first diff paint: < 150 ms for 2k-line files.
- Log scroll stays at 60fps with comfortable density on 10k-row revsets.

## 8. Rollout & phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 – Shell** | Header (H-*), status bar (S-*), SplitView, design tokens (V-*) | Existing features work in the new chrome; all tests pass |
| **2 – Log & files** | L-*, F-* | Drag/drop parity; virtualization verified |
| **3 – Diff viewer** | D-*, backend diff queries | Side-by-side + unified + syntax + word diff on all bundled themes |
| **4 – Power features** | Bookmark section (B-*), op log (O-*) | "Conflict fixer" scenario works end to end from the status bar |
| **5 – History** | X-* | — |

All work happens on a dedicated bookmark (`ui-refresh`), rebased onto `master` periodically. The new layout replaces the old one outright, with no setting to switch between them. The refresh is released as a new **major version** once phase 3 is complete; phases 4–5 can follow in minor releases. Users who want the current UI stay on the previous major version.

## 9. Future / out of scope

These appear in jayjay and are deliberately deferred:
- Forge integration: PR/MR links, CI status, stacked PRs.
- AI-generated commit messages.
- Persistent per-hunk review marks and line-anchored review notes.
- Line-range split ("move selected lines into child/sibling"), and `jj split --tool jjuicy`.
- A three-way merge editor (beyond D-13's accept-side actions).
- Rich previews (images, Markdown, CSV, notebooks).
- In-place editing of working-copy files.
- Repo Overview window across workspaces.
- Command palette, shortcut overlay, and keyboard-driven navigation.
- Interdiff (pinned-revision compare, divergent-version compare, evolog version-to-version diff).

## 10. Success metrics

- Fewer clicks for "read every diff in a 10-file change": today about 20 (expand/collapse each file); target 10 (one click per file).
- No regression in drag-drop e2e tests.
- Log pane scroll and selection latency stay within the performance budgets in §7.
- Qualitative: dogfooding feedback on the new major version before release.

## 11. Decisions

Resolved during review of the first draft:

1. **Description editor**: stays inline in the detail header (D-1).
2. **Syntax highlighting**: done in the frontend (§7).
3. **Log density**: two-line cards are the default for every repo, including large ones. Compact mode is opt-in (L-6).
4. **Bookmark panel**: a persistent collapsible section, not a popover (B-1).
5. **Classic layout**: not kept. The refresh ships as a new major version; users can stay on the previous major (§8).
6. **Revset**: today's revset functionality (presets, save/delete, a free-form editable input) is kept intact in a dedicated section at the top of the log column (L-0).
7. **Out of scope**: command palette, keyboard navigation, and interdiff (§9).
