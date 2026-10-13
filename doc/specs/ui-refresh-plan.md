# Implementation plan: jjuicy UI Refresh

Companion to [`ui-refresh.md`](ui-refresh.md). Requirement IDs (H-, L-, F-, D-, S-, B-, O-, X-, V-) refer to that PRD.

## 0. Ground rules

- **Branching:**
  - All work stacks on a `ui-refresh` bookmark created from `master`. Rebase it periodically: `jj rebase -b ui-refresh -d master`.
  - Each step below is one jj change with its own kata review.
  - `master` stays releasable on the old UI until the major-version cut at the end of phase 3.
- **Replace, don't fork:** the old components are edited or deleted in place, with no `if newLayout` branches. Where a component is superseded (`Toolbar.svelte`, `Pane.svelte`'s two-pane role, the `RevisionPane.svelte` diff accordion), delete it in the same change that lands its replacement.
- **Every change must pass:**
  - `cargo fmt`, `cargo clippy`, and `cargo test`.
  - `cargo gen`, if `src/messages/` changed.
  - `npm run check` and `npm run test`.
  - e2e (`e2e/`), for shell/drag changes.
- **Both runtimes:** each feature is verified in `cargo tauri dev` and in `cargo run -- web`. The `app/ipc.ts` abstraction means new queries need wiring in three places: `src/worker/session.rs` (event), `src/gui/mod.rs` (Tauri command + `generate_handler!`), and `src/web/queries.rs` (Axum route).
- **Routes:** `app/route.ts` has `default`, `log`, and `revision` routes. The single-pane `log` and `revision` routes keep working: they render one column of the new layout.

## Phase 1 – Shell (H-*, S-*, V-*, SplitView)

Goal: the new chrome around the *existing* log and revision panes. No behavioural change to the panes themselves.

### 1.1 Design tokens (V-1, V-3)
- `res/themes/{default,fluent,macos,material}.toml`: add the following tokens to both `[light.*]` and `[dark.*]`:
  - `colors.diffAddBg`, `colors.diffAddWordBg`, `colors.diffDelBg`, `colors.diffDelWordBg`
  - `colors.gutter`, `colors.selectionBar`, `colors.chip*` (the V-2 variants)
  - `syntax.{keyword,string,comment,number,type,function,punctuation,variable}`
  - `text.size{Xs,Sm,Md,Lg,Title}` (11/12/13/15/20)
- `src/theme/mod.rs`: missing tokens in a custom theme must fall back to the default theme's values. `resolve_variant` should merge the user theme over `default_theme()` before calling `resolve_refs`.
- `src/theme/tests.rs`:
  - Every bundled theme defines every token in `default.toml`. Generalise `parse_all_bundled_themes`.
  - A partial custom theme inherits the missing tokens.
- `app/global.css`: hairline dividers (`--ju-components-borderSubtle` reused), the type scale, and focus-ring styles (V-6).

### 1.2 SplitView component
- New `app/shell/SplitView.svelte`:
  - Props: `n` columns, `minSizes`, `storageKey`, and a collapsed set.
  - Lays children out with CSS grid and draggable separators, moving the separator logic out of `App.svelte` (`splitFraction`, `dragging`, `.hit-area`).
  - Sizes are saved to `localStorage` under `storageKey` and keyed per window label. In web mode, a single key is used.
- `app/App.svelte`: replace `.two-pane` with `<SplitView n={2}>`. It becomes 3 columns in phase 2.
- Vitest: `app/shell/SplitView.test.ts` covers size clamping, persistence round-trip, and collapse.

### 1.3 Header (H-1 to H-6)
- New `app/shell/Header.svelte`, which replaces `app/shell/Toolbar.svelte`. Delete Toolbar after the move.
  - **H-2 buttons:**
    - Sidebar toggle, which drives SplitView's collapse of column 0.
    - Refresh, which calls `query_snapshot`.
    - Fetch and Push split buttons. Reuse `RepositoryMutator`'s git fetch/push and the remote menu built with `query_remotes`, as Toolbar does today.
  - **H-3 breadcrumb:** the repo name and workspace, opening a dropdown with `WorkspaceMutator` actions and `RecentWorkspaces` items (`query_recent_workspaces`).
  - **H-4:**
    - Terminal button (Tauri only, hidden when `!isTauri()`). It needs a new trigger, `trigger_open_terminal`, in `src/gui/mod.rs` that uses `tauri-plugin-shell` to open the OS terminal in the workspace dir.
    - Settings button, which opens the existing settings entry point (`app/shell/Settings.ts`).
  - **H-6:** `ToolbarProgress.svelte` becomes a 2px indeterminate bar on the header's bottom edge, plus a `busy` prop on the originating button.
- **H-1 (macOS title-bar merge):** set `titleBarStyle: "Overlay"` and `hiddenTitle: true` in `tauri.conf.json` window config, or at window creation in `src/gui/mod.rs`. Add `data-tauri-drag-region` on the header and left padding for the traffic lights (`src/macos.rs` if a native inset tweak is needed). Windows and Linux keep native decorations.
- **H-5:** the Edit/New/Squash/Restore/Undo actions are removed from the header. They are re-homed in phase 2.4 (detail action row) and 1.4 (Undo). Until 2.4 lands they remain reachable through the existing context menus, so the phase-1 build loses no functionality.
- `app/Shell.svelte`: mount `Header` in place of `Toolbar`.

### 1.4 Status bar (S-1 to S-3)
- Backend: extend `RepoStatus` in `src/messages/mod.rs`, using the PRD's `RepoSummary` fields inline so the existing push path carries them:
  ```rust
  pub struct RepoStatus {
      pub operation_description: String,
      pub working_copy: CommitId,
      pub summary: Option<RepoSummary>, // None when is_large
  }
  pub struct RepoSummary {
      pub wc_files: u32, pub wc_added: u32, pub wc_removed: u32,
      pub conflicted: u32, pub divergent: u32,
  }
  ```
  - `src/worker/gui_util.rs::format_status` computes `summary`:
    - Evaluate the revsets `conflicts()` and `divergent()` with a count limit of 100 (display as "99+").
    - Get the working-copy stat from a `diff_stat` of `@` against its parents.
    - Skip all of it when `self.is_large`.
  - `cargo gen`.
- Tests in `src/worker/tests/session.rs`:
  - Counters on the test repo. `conflict_bookmark()` gives `conflicted >= 1`.
  - `summary` is `None` when the large-repo heuristic is forced low.
- `app/shell/StatusBar.svelte`:
  - Left side: shield and path.
  - Right side:
    - The op description, which is a button for the op log (it shows a disabled tooltip until phase 4).
    - ⟲ undo, which calls the existing `UndoOperation` mutation.
    - Counters. Clicking one writes the revset into the log query (`@`, `conflicts()`, `divergent()`) through the same store LogPane uses, then selects the first row.
  - The drag-bar behaviour (S-3) is untouched.

### 1.5 Icons (V-5)
- `app/controls/Icon.svelte`: add the feather glyphs `sidebar`, `terminal`, `settings`, `clock` (history), `copy`, `columns`, `align-justify`, `filter`, `list`, `folder`, and `chevron-*` if missing.

**Exit:** the old panes run inside the new header/status bar/SplitView; the e2e suite is green; screenshots are taken of all 4 themes × light/dark.

## Phase 2 – Log & Files (L-*, F-*, D-1 to D-5)

### 2.1 Revset section (L-0)
- `app/LogPane.svelte`: extract the current header (`SelectWidget` presets, Save/Delete, input) into `app/log/RevsetSection.svelte` with no behaviour change. Then:
  - The input becomes an auto-growing monospace `<textarea rows=1..3>`. Enter submits; Shift+Enter inserts a newline. Blur submits, as today.
  - Revset errors render inline. Today `query_log` errors surface via `BoundQuery`/error dialog; capture the error string from the `query_log` rejection and show it under the input.
  - A collapse chevron toggles a one-line summary (the preset name, or the revset truncated). The state is persisted in `localStorage`; the default is expanded.
- Vitest: extend `app/LogPane.test.ts` (it mocks via `app/mocks.ts`) to cover:
  - Choosing a preset sets the input.
  - Editing then Enter calls `query_log`.
  - An error string is displayed.
  - Collapse persists.
- P1, separate change: autocomplete. Its source is a new query `query_revset_completions` returning function names, aliases (`revset-aliases` config), and bookmark names.

### 2.2 Two-line log cards (L-1 to L-3, L-5, L-6)
- `app/objects/RevisionObject.svelte` (545 lines) is reworked into a card layout. It stays the `Object` drag source and the `Zone` drop target (L-7).
  - Line 1: `IdSpan` and the chips.
  - Line 2: the description, clamped to 2 lines.
  - Line 3: the commit id, avatar, author, and `TimestampSpan` in relative mode.
- `app/controls/Chip.svelte`: a `variant` prop (`bookmark | wc | conflict | divergent | tag | remote | immutable`) mapped to the `chip*` tokens (V-2). Update `Chip.test.ts`.
- New `app/controls/Avatar.svelte` (V-4):
  - Initials with an HSL hue from a hash of the email.
  - `gravatar` mode builds an md5 URL, but only when `jjuicy.ui.avatars = "gravatar"`.
  - Add `ui.avatars` and `ui.log-density` to `src/config/jjuicy.toml` and expose them through `RepoConfig` (`src/messages/mod.rs`, then `cargo gen`).
- `app/GraphLog.svelte` / `GraphLine.svelte` / `GraphNode.svelte`:
  - Row height comes from density: comfortable ≈ 56px, compact = today's.
  - The graph geometry scales from a single `rowHeight` constant instead of hard-coded values.
- Virtualisation (L-5): row height stays *fixed per density*. The 2-line clamp makes it constant, which keeps the existing slot-index virtualisation math unchanged. Verify `{#each visibleSlice.rows as row, i (i)}` and `$:` derivations in the card.
- L-4 column header: "Bookmarks N ▾" toggle (a placeholder until phase 4; hide it if the count is 0) and the row count from `LogPage`.
- Selection style (L-3): an accent bar and tint via `colors.selectionBar`.

### 2.3 Files column (F-1 to F-7)
- New `app/files/FilesPane.svelte`, taking `revs: RevsResult`:
  - Rows reuse `app/objects/ChangeObject.svelte` as the drag source and context menu (F-6). ChangeObject's accordion/hunk rendering moves out (see 2.5), leaving a slim row: status badge, bold name, muted dir, `+/−`.
  - The list/tree toggle (F-2) is persisted. Tree mode groups by directory segments of `TreePath`, with collapsible folders and summed counts.
  - Filter (F-3) is a fuzzy subsequence match on the path, implemented in TS (no dependency).
  - The header shows "N files"; conflicts sort first (F-4).
  - An "All files" pseudo-row (F-7).
  - Selection is click-only (F-5). The selected path goes into a new store, `selectedFile` in `app/stores.ts`, keyed by the revision set so it resets when the selection changes. It keeps the same path when it still exists.
- `app/App.svelte`: `SplitView n={3}` with Log | Files | Detail.
  - The `revision` route renders Files+Detail as a 2-column SplitView.
- Vitest, `app/files/FilesPane.test.ts`:
  - Tree grouping.
  - Filter.
  - Conflict-first sort.
  - Selection persistence across a revision change.

### 2.4 Detail header (D-1 to D-5, H-5)
- Split `app/RevisionPane.svelte` (569 lines) into:
  - `app/detail/DetailPane.svelte`: the header plus the diff area.
  - `app/detail/RevisionHeader.svelte`:
    - Title, with ✎ Edit toggling the existing description textarea inline (keep Reset author, Describe, and ⌘↩).
    - Body clamp with "show more".
    - Metadata row with copy buttons (`navigator.clipboard`).
    - The total `+/−`.
    - Flag chips.
    - Parent chips, each still a `Zone` for the `Merge` operand (D-4).
  - `app/detail/ActionRow.svelte` (D-3): the actions are built from `RevisionMutator`'s existing methods, which are already used by the context menu. Disabled states use the same predicates. This replaces the toolbar's Edit/New/Squash/Restore.
  - The multi-select header (D-5) is moved over from the existing RevisionPane code.
- Until phase 3, the diff area renders the current `<pre class="diff">` per selected file (or all files), so phase 2 is shippable on the bookmark without the new diff backend.
- Update `app/RevisionPane.test.ts` → `app/detail/DetailPane.test.ts`. Assert the describe flow, the parents zone, and that the actions are enabled or disabled for immutable revisions.

**Exit:**
- Drag-drop parity (revision→revision, bookmark→revision, file→revision, hunk→revision).
- New e2e test `e2e/files-drag.test.ts`, which drags a file from the Files column to its parent and asserts that `MoveChanges` happened.
- 10k-row revset scroll check, done manually with a large repo (e.g. jj's own repo).

## Phase 3 – Diff viewer (D-6 to D-15, backend diff queries)

### 3.1 Backend: lazy summaries
- `src/messages/mod.rs`:
  - New `RevChangeSummary { kind, path, has_conflict, added: u32, removed: u32, old_path: Option<TreePath>, binary: bool }`. `old_path` is for renames (D-15).
  - `RevsResult::Detail.changes: Vec<RevChange>` becomes `Vec<RevChangeSummary>`. Hunks are no longer sent eagerly.
- `src/worker/queries.rs::query_revisions`:
  - Compute the summary per file. Line counts come from a cheap `diff_stat`.
  - Rename detection comes from `copy_tracking` / `TreeDiffIterator` with copies. Check what the pinned jj-lib version offers; fall back to no rename info if unavailable.
- Keep `get_unified_hunks` temporarily for `HunkObject` operands. `ChangeHunk` is still the drag payload for `MoveHunk` / `CopyHunk`, so those mutation messages stay unchanged.
- `src/worker/tests/queries.rs`: update the existing detail tests; add stat assertions on `main_bookmark()` (renamed c.txt → assert `old_path`).

### 3.2 Backend: `query_file_diff` and `query_file_lines`
- Messages:
  ```rust
  pub struct FileDiff {
      pub path: TreePath, pub old_path: Option<TreePath>,
      pub kind: FileDiffKind,      // Text | Binary { old_size, new_size } | TooLarge | Conflict
      pub hunks: Vec<DiffHunk>,
      pub conflict: Option<ConflictBlocks>,
      pub old_line_count: u32, pub new_line_count: u32,
  }
  pub struct DiffHunk {
      pub header: ChangeHunk,      // reused as the HunkObject drag payload (D-12)
      pub rows: Vec<DiffRow>,
  }
  pub struct DiffRow {
      pub kind: DiffRowKind,       // Context | Added | Removed
      pub old_line: Option<u32>, pub new_line: Option<u32>,
      pub text: String,
      pub tokens: Vec<DiffToken>,  // changed ranges for word highlighting (D-9)
  }
  pub struct DiffToken { pub start: u32, pub end: u32 } // utf-16 offsets for the frontend
  ```
  - Side-by-side vs unified is a *frontend* pairing of the same rows, so the query has no `mode` parameter. PRD §7 is updated to match.
- `queries.rs::query_file_diff(ws, set: RevSet, path: TreePath, context: u32)`:
  - Build on the existing `DiffTokenVec` word tokenisation, and emit per-row token ranges instead of prefix-encoded text.
  - Convert byte offsets to UTF-16 here, so that the frontend never re-tokenises.
  - Thresholds: binary detection (NUL in the first 8KB), and `TooLarge` above `jjuicy.queries.max-diff-bytes` (new config, default 2MB).
- `queries.rs::query_file_lines(ws, rev: RevId, path, side: Old|New, start, end) -> Vec<String>` serves the context expansion (D-11).
- Wiring for each query: `SessionEvent::QueryFileDiff` / `QueryFileLines` in `session.rs`; handling in `worker/mod.rs`; a Tauri command in `src/gui/mod.rs`; a route in `src/web/queries.rs`. Then `cargo gen`.
- Tests on the test repo:
  - Modified file: line numbers and token ranges.
  - Rename.
  - Conflict file on `conflict_bookmark()` gives `kind == Conflict` and three blocks.
  - Binary placeholder, using a fixture added to the repo zip only if needed. Otherwise test the threshold logic directly.
  - `query_file_lines` bounds.

### 3.3 Frontend: DiffViewer
- `app/diff/`:
  - `FileHeader.svelte` (D-6, D-15): path, copy, badge, `+/−`, the unified/side-by-side toggle (in a global store persisted to `localStorage`), and the `ExternalDiff` button.
  - `DiffViewer.svelte`: fetches `query_file_diff` for `selectedFile` via `BoundQuery`. It caches the last N results per (commit, path) in memory.
  - `UnifiedRows.svelte` (D-8) and `SplitRows.svelte` (D-7). Pairing rule: within a hunk, align runs of Removed with the following run of Added, padding with spacer rows.
  - `HunkHeader.svelte` (D-12): wraps `HunkObject` so the hunk stays draggable. It adds a context menu (move to parent/child/working copy, discard) using the existing `MoveHunk` mutation. Discard = `MoveHunk` with a reverse, or new `DiscardHunk` if it isn't expressible; decide during implementation and note it in review.
  - `ContextSeparator.svelte` (D-11): expand ±20 or all, via `query_file_lines`.
  - `ConflictView.svelte` (D-13): labelled side/base/side blocks. The accept-side actions need a new mutation, `ResolveConflictSide { id, path, side }`, in `src/worker/mutations/change.rs`, written to the AGENTS.md mutation rules. Open-resolver uses the existing `ExternalResolve`.
  - `BinaryCard.svelte` (D-14).
  - The All-files mode (F-7) stacks `FileHeader` + rows per file, lazily fetched as each enters the viewport (IntersectionObserver).
- Virtualise rows for files over ~2k rows, keyed by slot index (same rules as the log).
- **Syntax highlighting (D-10):**
  - Spike first, as its own change: compare Shiki (JS regex engine, fine-grained language imports) and `@lezer/*` parsers with `@lezer/highlight`.
  - Criteria:
    - Bundle size for ~20 common languages.
    - Incremental, per-line tokenisation of only the visible rows.
    - The ability to emit class names, so colours map to `--ju-syntax-*`.
  - Default recommendation: Lezer. It is smaller, emits tag classes directly, and handles partial documents well.
  - Highlight the *full* old/new text of a hunk region, then slice by line, so multi-line strings and comments colour correctly. Fall back to plain text for unknown extensions.
  - Word tokens (D-9) are overlaid as a second span layer.
- Delete the `<pre class="diff">` and `lineColour` code from the old RevisionPane / ChangeObject.
- Vitest:
  - Row pairing (pure function, `app/diff/pairing.test.ts`).
  - Token overlay splitting (`app/diff/spans.test.ts`).
  - The toggle persists.
- e2e: new `e2e/hunk-drag.test.ts`, which drags a hunk header from the diff viewer onto the parent.

**Exit / release gate:**
- The PRD §7 performance budgets are measured and recorded in the review, using a `performance.mark` around selection→paint.
- All themes × light/dark are visually checked.
- `doc/TODO.md` is updated.
- Cut the **new major version** from `ui-refresh` (merge into `master`, then the release script).

## Phase 4 – Bookmark section & op log (B-*, O-*)

### 4.1 Bookmark section (B-1 to B-3)
- Backend: new query `query_bookmarks`, returning `Vec<BookmarkEntry { name, target: Option<RevHeader-lite>, remotes: Vec<RemoteState { remote, tracked, ahead, behind, absent }> }>`. Ahead and behind are counted via revsets between local and remote targets, capped at 100.
  - The state machine terminology comes from `DESIGN.md`.
  - Wire it through session/gui/web, then `cargo gen`.
  - Tests on the test repo bookmarks.
- Frontend: `app/log/BookmarkSection.svelte`, sitting between `RevsetSection` and the log.
  - Collapsible, with a drag handle for height. Both are persisted.
  - Groups: Local, Tracked, Untracked.
  - Rows are `BookmarkObject`, so dragging to a card performs the existing `MoveRef` (B-2).
  - Clicking a row sets the log selection and scrolls to it. If the target is outside the current revset, offer "show in log", which ORs `| <commit>` into the revset input.
- Cleanup (B-3) is a confirmation dialog (`ModalDialog`) listing the targets.
  - "Delete merged bookmarks" means local bookmarks whose target is an ancestor of `trunk()`. It runs `DeleteRef` per bookmark.
  - "Forget absent remotes" uses the existing untrack/forget paths.
  - If batching is needed, add a `DeleteRefs` mutation.

### 4.2 Operation log (O-1, O-2)
- Backend:
  - `query_op_log(limit, offset) -> Vec<OpLogEntry { id, description, time, user, host, is_current }>`.
  - Mutation `RestoreOperation { id }` (`jj op restore` semantics via `jj_lib::op_walk` / repo loader at the op), with a test that restores to the parent op and asserts the head changed.
- "View repo at this op" (O-2) needs read-only sessions at an op:
  - Add `at_operation: Option<OperationId>` to `QueryLog` / `QueryRevisions` handling in `WorkspaceSession`, loading the repo at that op without snapshotting.
  - Mutations are rejected with a precondition error while it is set.
  - This touches `gui_util.rs` session loading and is the riskiest part of phase 4, so it gets a separate change and review.
- Frontend: `app/oplog/OpLogPanel.svelte`, a slide-over opened from the status bar op description.
  - A read-only banner sits in the log column while viewing a past op.

**Exit:** the "conflict fixer" scenario works end to end. An e2e test clicks ⚠ in the status bar and asserts that the log revset is `conflicts()` and that the conflicted file is preselected.

## Phase 5 – History (X-*)

- **X-1 file history:**
  - A "Show history" entry in the ChangeObject context menu (in `ChangeMutator.ts`) sets the revset to `files("<path>")` and pins the selected file to that path, so each selected revision shows that file's diff.
  - This is frontend-only.
- **X-2 evolog:**
  - Backend:
    - `query_evolog(id) -> Vec<EvologEntry { commit: RevHeader, operation: Option<String> }>`.
    - Mutation `RestoreFromEvolog { id, from: CommitId }`, which sets the change's tree to the old version's tree, written as a new transaction per the mutation rules.
    - Tests use a change rewritten in the test repo, or one created in-test by a describe followed by a restore.
  - Frontend:
    - The detail header gets tabs: Changes | History.
    - History lists the versions. Selecting one shows that version's own diff against its parents, reusing `query_file_diff` with the old commit id. It also offers a Restore button.
- **X-3 annotate (P2):**
  - `query_annotate(rev, path) -> Vec<AnnotateLine { change_id, commit_id, author, time }>` via `jj_lib::annotate`.
  - The frontend adds a gutter column in the new side of the diff viewer, and clicking it selects that revision.

## Cross-cutting checklist

| Concern | Where | When |
|---|---|---|
| `cargo gen` after message changes | `src/messages/*` → `app/messages/*` | 1.4, 2.2, 3.1, 3.2, 4.1, 4.2, 5 |
| Tauri + web wiring for each new query or mutation | `session.rs`, `worker/mod.rs`, `gui/mod.rs`, `web/queries.rs` / `web/mod.rs::handle_mutate` | every new IPC |
| Large-repo heuristic | `gui_util.rs::is_large` | status counters (1.4), ahead/behind (4.1) |
| Theme tokens in all 4 themes + fallback test | `res/themes/*`, `src/theme/tests.rs` | 1.1, revisited in 3.3 for syntax |
| Drag-drop policy unchanged | `app/mutators/BinaryMutator.ts` | regression-check 2.x, 3.3 |
| Web-mode hiding | terminal button, title-bar merge | 1.3 |
| Docs | `AGENTS.md` key files, `DESIGN.md` layout section, `src/config/jjuicy.toml` inline docs for new settings | end of each phase |

## Risks

- **Rename/copy info in the pinned jj-lib.** If it's unavailable, D-15 degrades to delete+add, and the review will say so.
- **Highlighter bundle size.** Mitigate with the spike in 3.3 and lazy-loaded language packs.
- **Read-only op view (O-2).** It touches session loading. It is isolated in its own change and can slip to a later minor release without blocking O-1.
- **Variable-height cards.** Avoided by clamping to fixed heights per density, so the virtualisation math doesn't change.
