use std::{
    borrow::Borrow,
    collections::{HashMap, HashSet},
    io::Write,
    iter::{Peekable, Skip},
    mem,
    ops::Range,
    slice,
};

use anyhow::{Result, anyhow};

use futures_util::stream::BoxStream;
use futures_util::{StreamExt, try_join};
use itertools::Itertools;
use jj_cli::diff_util::{self, LineDiffOptions};
use jj_lib::{
    annotate::{FileAnnotator, LineOrigin},
    backend::CommitId,
    commit::Commit,
    conflict_labels::ConflictLabels,
    conflicts::{
        self, ConflictMarkerStyle, ConflictMaterializeOptions, MaterializedFileConflictValue,
        MaterializedFileValue, MaterializedTreeValue,
    },
    copies::{CopiesTreeDiffEntry, CopyRecords},
    diff::{
        CompareBytesExactly, CompareBytesIgnoreAllWhitespace, CompareBytesIgnoreWhitespaceAmount,
        ContentDiff, DiffHunk, DiffHunkKind, find_line_ranges,
    },
    diff_presentation::LineCompareMode,
    evolution,
    files::{self, FileMergeHunkLevel, MergeResult},
    git::REMOTE_NAME_FOR_LOCAL_GIT_REPO,
    graph::{GraphEdge, GraphEdgeType, TopoGroupedGraphIterator},
    matchers::EverythingMatcher,
    merge::{Diff, SameChange},
    merged_tree::MergedTree,
    op_store::RefTarget,
    op_walk,
    ref_name::{RefNameBuf, RemoteNameBuf, RemoteRefSymbol},
    repo::Repo,
    repo_path::RepoPath,
    revset::{Revset, RevsetEvaluationError, RevsetExpression},
    rewrite,
    tree_merge::MergeOptions,
};

use crate::config::JjuicySettings;
use crate::messages::{
    ChangeHunk, ChangeLocation, ChangeRange, MultilineString, RevSet, TreePath, queries::*,
};
use crate::messages::{RevHeader, RevId};

use super::{WorkspaceSession, git_util::get_git_remote_names};

/// A column in the active stem array. Each column is either empty or holds a
/// stem targeting some commit; the stem "closes" when we process its target,
/// at which point we place the commit's node at that column.
///
/// The layout algorithm is a port of sapling-renderdag's `Renderer`. Stems
/// carry the source position (where they were created) so when they're
/// terminated we can emit a single LogLine spanning from child to parent.
#[derive(Clone)]
struct Stem {
    source: LogCoordinates,
    target: CommitId,
    indirect: bool,
    known_immutable: bool,
    /// True once this stem has been swapped into its current slot by a
    /// rescue sweep. The rescue emits a FromNode that already ends at the
    /// rescuing commit's row+1 coordinates, so if the stem's target turns
    /// out to be the very next commit we'd otherwise overlay a second
    /// ToNode on the same 1-row segment. See step 2 for the skip.
    rescued: bool,
}

/// state used for init or restart of a query
pub struct QueryState {
    /// max number of rows per page
    page_size: usize,
    /// number of rows already yielded
    next_row: usize,
    /// ongoing vertical stems keyed by column; None indicates an empty slot
    stems: Vec<Option<Stem>>,
    /// graph width (in columns) of the last emitted row, carried across
    /// pages so the first row of the next page can still widen its padding
    /// to match the previous page's final row.
    last_own_width: usize,
}

impl QueryState {
    pub fn new(page_size: usize) -> QueryState {
        QueryState {
            page_size,
            next_row: 0,
            stems: Vec::new(),
            last_own_width: 0,
        }
    }
}

/// live instance of a query
pub struct QuerySession<'q, 'w: 'q> {
    pub ws: &'q WorkspaceSession<'w>,
    pub state: QueryState,
    #[allow(clippy::type_complexity)]
    iter: Peekable<
        Skip<
            TopoGroupedGraphIterator<
                CommitId,
                CommitId,
                Box<
                    dyn Iterator<
                            Item = Result<
                                (CommitId, Vec<GraphEdge<CommitId>>),
                                RevsetEvaluationError,
                            >,
                        > + 'q,
                >,
                for<'a> fn(&'a CommitId) -> &'a CommitId,
            >,
        >,
    >,
    #[allow(clippy::type_complexity)]
    is_immutable: Box<dyn Fn(&CommitId) -> Result<bool, RevsetEvaluationError> + 'q>,
    hidden_forks: std::collections::HashMap<CommitId, Vec<String>>,
}

impl<'q, 'w> QuerySession<'q, 'w> {
    pub fn new(
        ws: &'q WorkspaceSession<'w>,
        revset: &'q dyn Revset,
        state: QueryState,
        hidden_forks: std::collections::HashMap<CommitId, Vec<String>>,
    ) -> QuerySession<'q, 'w> {
        let as_id: for<'a> fn(&'a CommitId) -> &'a CommitId = commit_id_identity;
        let iter = TopoGroupedGraphIterator::new(revset.iter_graph(), as_id)
            .skip(state.next_row)
            .peekable();

        let immutable_revset = ws.evaluate_immutable().unwrap();
        let is_immutable = immutable_revset.containing_fn();

        QuerySession {
            ws,
            iter,
            state,
            is_immutable,
            hidden_forks,
        }
    }

    pub fn get_page(&mut self) -> Result<LogPage> {
        let mut rows: Vec<LogRow> = Vec::with_capacity(self.state.page_size);
        // parallel to `rows`: graph width at each row's widest point during
        // processing. Used in a post-loop pass to propagate padding along
        // graph-connected rows so a node's text aligns with its graph
        // neighbours instead of snapping to its own narrow column count.
        let mut own_widths: Vec<usize> = Vec::with_capacity(self.state.page_size);
        let mut row = self.state.next_row;
        let max = row + self.state.page_size;

        let root_id = self.ws.repo().store().root_commit_id().clone();

        while let Some(Ok((commit_id, commit_edges))) = self.iter.next() {
            let mut lines: Vec<LogLine> = Vec::new();

            // 1. find a column for this commit: prefer an existing stem
            //    targeting it, then the leftmost empty slot, finally a new
            //    column on the right.
            let node_col = find_column(&self.state.stems, &commit_id);

            // 2. terminate any stem that was targeting this commit. Emit a
            //    ToNode line spanning from the stem's source to our position —
            //    the original, unbroken edge. If the stem was rescued in the
            //    immediately preceding row, its rescue FromNode already ends
            //    exactly at our coordinates; skipping the ToNode avoids
            //    overlaying two lines on the same 1-row segment. Rescues more
            //    than one row back still need the ToNode to cover the vertical
            //    run between the rescue endpoint (row+1) and our row.
            let mut stem_known_immutable = false;
            if let Some(slot) = self.state.stems.get_mut(node_col).and_then(|s| s.take()) {
                stem_known_immutable = slot.known_immutable;
                let rescue_already_covers =
                    slot.rescued && slot.source.0 == node_col && slot.source.1 + 1 == row;
                if !rescue_already_covers {
                    lines.push(LogLine::ToNode {
                        indirect: slot.indirect,
                        source: slot.source,
                        target: LogCoordinates(node_col, row),
                    });
                }
            } else if node_col >= self.state.stems.len() {
                self.state.stems.resize_with(node_col + 1, || None);
            }

            let known_immutable = if stem_known_immutable {
                Some(true)
            } else {
                Some((self.is_immutable)(&commit_id)?)
            };
            let header = self
                .ws
                .format_header(&self.ws.get_commit(&commit_id)?, known_immutable)?;

            // 3. assign each parent edge to a column.
            //    - Existing stem for this target → emit ToIntersection (merge).
            //    - Otherwise create a new stem (prefer the commit's own column
            //      if empty, else the leftmost gap, else push to the right).
            //    Track the only-parent case so step 4 can rescue it.
            let mut parent_count = 0usize;
            let mut single_parent_merge: Option<(usize, usize)> = None;

            for edge in commit_edges.iter() {
                if edge.edge_type == GraphEdgeType::Missing && edge.target == root_id {
                    continue;
                }
                parent_count += 1;
                let indirect = edge.edge_type != GraphEdgeType::Direct;

                if let Some(slot) = self
                    .state
                    .stems
                    .iter()
                    .position(|s| s.as_ref().map(|st| &st.target) == Some(&edge.target))
                {
                    let line_idx = lines.len();
                    lines.push(LogLine::ToIntersection {
                        indirect,
                        source: LogCoordinates(node_col, row),
                        target: LogCoordinates(slot, row + 1),
                    });
                    if parent_count == 1 {
                        single_parent_merge = Some((slot, line_idx));
                    } else {
                        single_parent_merge = None;
                    }
                    continue;
                }

                // no existing stem — allocate one.
                let col = if matches!(self.state.stems.get(node_col), Some(None)) {
                    node_col
                } else if let Some(i) = self.state.stems.iter().position(|s| s.is_none()) {
                    i
                } else {
                    self.state.stems.push(None);
                    self.state.stems.len() - 1
                };
                self.state.stems[col] = Some(Stem {
                    source: LogCoordinates(node_col, row),
                    target: edge.target.clone(),
                    indirect,
                    known_immutable: header.is_immutable,
                    rescued: false,
                });
                single_parent_merge = None;
            }

            // 4. column rescue (sapling-style): single-parent commits whose
            //    parent ended up as an existing stem to the right get their
            //    stem swapped back to the commit's column. The ToIntersection
            //    we just emitted would land in an empty column after the swap,
            //    so replace it with a FromNode that sweeps the old stem's
            //    source into the commit's column — but aiming one row PAST
            //    the commit so the curve ends below its circle. That way it
            //    merges into the stem's continuing column rather than
            //    appearing to terminate at the commit itself (which would
            //    read as a spurious parent-child edge to the rescuing
            //    sibling). Fire whenever the stem was created in any prior
            //    row so the rescue can cascade one lane at a time across
            //    consecutive sibling merges — matching jj's layout where a
            //    common-parent stem migrates leftward through each sibling
            //    instead of jumping across several lanes in one step.
            if parent_count == 1
                && let Some((slot, line_idx)) = single_parent_merge
                && slot > node_col
                && let Some(stem_ref) = self.state.stems[slot].as_ref()
                && stem_ref.source.1 < row
            {
                let mut stem = self.state.stems[slot].take().expect("rescued stem");

                // Redirect the current row's ToIntersection (emitted just
                // above) onto the stem's new column so the rescuing commit
                // keeps its own parent-child arc, pointing at the stem's
                // continued run below its circle.
                if let LogLine::ToIntersection { target, .. } = &mut lines[line_idx] {
                    target.0 = node_col;
                }

                // Emit the compaction sweep as a separate FromNode. The
                // logical source stays at the allocator's position (where
                // the stem was born, often kylr's row 0 col 0) so the line
                // visually grows out of the allocator's circle. The via
                // column is the stem's current slot — the renderer bends
                // right out of the allocator, runs the long vertical at
                // `via` (an empty lane), then bends left to reach the
                // rescuing commit. Running the vertical at the allocator's
                // column instead would slice through every circle on the
                // trunk; skipping the allocator's position would leave the
                // top of the line floating in empty space.
                lines.push(LogLine::FromNode {
                    indirect: stem.indirect,
                    source: stem.source,
                    target: LogCoordinates(node_col, row + 1),
                    via: Some(slot),
                });
                stem.source = LogCoordinates(node_col, row);
                stem.rescued = true;
                self.state.stems[node_col] = Some(stem);

                // earlier siblings that merged into this stem emitted
                // ToIntersection arcs targeting (slot, sibling_row + 1).
                // Leave those arcs alone: the rescue FromNode's source-
                // column vertical runs from stem.source.1 down to the
                // rescue row's boundary, so each sibling's endpoint at
                // (slot, sibling_row + 1) lies on that vertical and joins
                // the rescued stem cleanly. Redirecting them to node_col
                // would run them across the rescuing commit's own circle.
            }

            // capture the graph's widest extent at this row (after parent
            // allocation and rescue, before trimming) so the post-loop
            // padding pass can reach past every column this row touches.
            let own_width = self.state.stems.len();

            // 5. trim trailing empty stems and handle any "missing" edges that
            //    need a terminator in the next row (Sapling marks these with ~).
            while matches!(self.state.stems.last(), Some(None)) {
                self.state.stems.pop();
            }

            let location = LogCoordinates(node_col, row);

            let hidden_forks = self
                .hidden_forks
                .get(&commit_id)
                .cloned()
                .unwrap_or_default();

            rows.push(LogRow {
                revision: header,
                location,
                padding: 0, // filled in below by the neighbour-aware pass
                lines,
                hidden_forks,
            });
            own_widths.push(own_width);
            row += 1;

            // missing-parent terminators: any new stem targeting a commit that
            // isn't actually in the revset (jj tags it Missing non-root) gets
            // a ~ marker drawn at the next row via ToMissing.
            let mut next_missing: Option<(usize, bool)> = None;
            for edge in commit_edges.iter() {
                if edge.edge_type == GraphEdgeType::Missing
                    && edge.target != root_id
                    && let Some(slot) = self
                        .state
                        .stems
                        .iter()
                        .position(|s| s.as_ref().map(|st| &st.target) == Some(&edge.target))
                {
                    let indirect = self.state.stems[slot].as_ref().is_none_or(|s| s.indirect);
                    next_missing = Some((slot, indirect));
                    break;
                }
            }
            if let Some((slot, indirect)) = next_missing {
                rows.last_mut().unwrap().lines.push(LogLine::ToMissing {
                    indirect,
                    source: LogCoordinates(node_col, row - 1),
                    target: LogCoordinates(slot, row),
                });
                self.state.stems[slot] = None;
                row += 1;
            }

            if row == max {
                break;
            }
        }

        // Neighbour-aware padding: each line (ToNode/FromNode/ToIntersection/
        // ToMissing) visually spans a range of rows. Extend each spanned row's
        // effective width to the line's rightmost column so text aligns with
        // its graph-connected neighbours without being pulled wider by
        // unrelated rows. Starts from own_width, which already covers the
        // row's own stems including any passing through vertically.
        let mut row_index_by_number = std::collections::HashMap::new();
        for (i, r) in rows.iter().enumerate() {
            row_index_by_number.insert(r.location.1, i);
        }
        let mut effective = own_widths.clone();
        for row in &rows {
            for line in &row.lines {
                let (source, target, via) = match line {
                    LogLine::FromNode {
                        source,
                        target,
                        via,
                        ..
                    } => (source, target, *via),
                    LogLine::ToNode { source, target, .. }
                    | LogLine::ToIntersection { source, target, .. }
                    | LogLine::ToMissing { source, target, .. } => (source, target, None),
                };
                // rescue FromNodes hop through `via` so the vertical at
                // that column is visible at every row the line covers;
                // its width contributes to alignment even though `via`
                // isn't one of the endpoints.
                let width = source.0.max(target.0).max(via.unwrap_or(0)) + 1;
                let (lo, hi) = if source.1 <= target.1 {
                    (source.1, target.1)
                } else {
                    (target.1, source.1)
                };
                for rn in lo..=hi {
                    if let Some(&idx) = row_index_by_number.get(&rn)
                        && effective[idx] < width
                    {
                        effective[idx] = width;
                    }
                }
            }
        }
        // carry the previous page's last width into this page's first row so
        // graph-connected rows across the page boundary stay aligned.
        if !effective.is_empty() && effective[0] < self.state.last_own_width {
            effective[0] = self.state.last_own_width;
        }
        for i in 0..rows.len() {
            rows[i].padding = effective[i].saturating_sub(rows[i].location.0 + 1);
        }
        if let Some(&last) = effective.last() {
            self.state.last_own_width = last;
        }

        self.state.next_row = row;
        Ok(LogPage {
            rows,
            has_more: self.iter.peek().is_some(),
        })
    }
}

fn find_column(stems: &[Option<Stem>], commit_id: &CommitId) -> usize {
    if let Some(i) = stems
        .iter()
        .position(|s| s.as_ref().map(|st| &st.target) == Some(commit_id))
    {
        return i;
    }
    if let Some(i) = stems.iter().position(|s| s.is_none()) {
        return i;
    }
    stems.len()
}

#[cfg(test)]
pub fn query_log(ws: &WorkspaceSession, revset_str: &str, max_results: usize) -> Result<LogPage> {
    let state = QueryState::new(max_results);
    let revset = ws.evaluate_revset_str(revset_str)?;
    let hidden_forks = ws.compute_hidden_forks(revset_str)?;
    let mut session = QuerySession::new(ws, &*revset, state, hidden_forks);
    session.get_page()
}

#[cfg(test)]
pub fn query_revision(ws: &WorkspaceSession<'_>, id: &RevId) -> Result<Option<RevHeader>> {
    ws.resolve_optional_id(id)?
        .map(|c| ws.format_header(&c, None))
        .transpose()
}

/// Commits of a revset along with the trees on either side of its combined diff.
struct DiffEndpoints {
    commits: Vec<Commit>,
    parent_tree: MergedTree,
    final_tree: MergedTree,
    copy_records: CopyRecords,
}

async fn resolve_diff_endpoints(
    ws: &WorkspaceSession<'_>,
    set: &RevSet,
) -> Result<Option<DiffEndpoints>> {
    // resolve singleton or arbitrary revset
    let commits = if set.from.change.hex == set.to.change.hex {
        match ws.resolve_optional_id(&set.from)? {
            Some(commit) => vec![commit],
            None => return Ok(None),
        }
    } else {
        match ws.resolve_optional_set(set)? {
            Some(commits) => commits,
            None => return Ok(None),
        }
    };

    let oldest_commit = commits.last().ok_or(anyhow!("slice is_empty()"))?;
    let oldest_parents = oldest_commit.parents().await?;
    let parent_tree = rewrite::merge_commit_trees(ws.repo(), &oldest_parents).await?;

    let newest_commit = commits.first().ok_or(anyhow!("slice is_empty()"))?;
    let final_tree = newest_commit.tree();

    // rename detection is best-effort; backends without copy tracking just report nothing
    let mut copy_records = CopyRecords::default();
    for parent in &oldest_parents {
        let records = diff_util::get_copy_records(
            ws.repo().store(),
            parent.id(),
            newest_commit.id(),
            &EverythingMatcher,
        )
        .and_then(|records| copy_records.add_records(records));
        if let Err(err) = records {
            log::warn!("copy records unavailable: {err}");
            copy_records = CopyRecords::default();
            break;
        }
    }

    Ok(Some(DiffEndpoints {
        commits,
        parent_tree,
        final_tree,
        copy_records,
    }))
}

/// Read display details for a revset (limited to sequences). Returns headers in topological order (children first).
pub async fn query_revisions(ws: &WorkspaceSession<'_>, set: RevSet) -> Result<RevsResult> {
    let Some(DiffEndpoints {
        commits,
        parent_tree,
        final_tree,
        copy_records,
    }) = resolve_diff_endpoints(ws, &set).await?
    else {
        return Ok(RevsResult::NotFound { set });
    };
    let oldest_commit = commits.last().ok_or(anyhow!("slice is_empty()"))?;

    let tree_diff =
        parent_tree.diff_stream_with_copies(&final_tree, &EverythingMatcher, &copy_records);
    let conflict_labels = Diff::new(parent_tree.labels(), final_tree.labels());
    let changes = format_tree_changes(ws, tree_diff, conflict_labels).await?;

    // find inherited conflicts: files conflicted in final_tree but unchanged relative to parent.
    // conflicted changes with empty hunks (tree value differs but materialized content is identical)
    // are dropped by format_tree_changes and end up here, since they have nothing useful to display as a diff.
    let changed_paths: HashSet<&str> = changes.iter().map(|c| c.path.repo_path.as_str()).collect();
    let mut conflicts = Vec::new();
    for (path, entry) in final_tree.entries() {
        if let Ok(entry) = entry
            && !entry.is_resolved()
        {
            let formatted_path = ws.format_path(path.clone())?;
            if changed_paths.contains(formatted_path.repo_path.as_str()) {
                continue;
            }

            match conflicts::materialize_tree_value(
                ws.repo().store(),
                &path,
                entry,
                final_tree.labels(),
            )
            .await?
            {
                MaterializedTreeValue::FileConflict(file) => {
                    let hunks = format_conflict_hunks(merge_file_conflict(&file), &file.labels, 3)?;
                    if !hunks.is_empty() {
                        conflicts.push(RevConflict {
                            path: formatted_path,
                        });
                    }
                }
                _ => {
                    log::warn!("nonresolved tree entry did not materialise as conflict");
                }
            }
        }
    }

    // details for each revision in the set
    let mut headers = Vec::new();
    let mut known_immutable: Option<bool> = None;
    for commit in &commits {
        // optimization: once we find an immutable revision, its ancestors must be immutable too
        let header = ws.format_header(commit, known_immutable)?;
        if known_immutable.is_none() && header.is_immutable {
            known_immutable = Some(true);
        }
        headers.push(header);
    }

    // optimization: if anything was immutable, the oldest revision's parents must also be immutable
    let parents = oldest_commit
        .parents()
        .await?
        .iter()
        .map(|p| ws.format_header(p, known_immutable))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(RevsResult::Detail {
        set,
        headers,
        parents,
        changes,
        conflicts,
    })
}

/// Full diff of one file across a revset, with display rows and drag headers.
pub async fn query_file_diff(
    ws: &WorkspaceSession<'_>,
    set: RevSet,
    path: TreePath,
    context: u32,
) -> Result<FileDiff> {
    let DiffEndpoints {
        parent_tree,
        final_tree,
        copy_records,
        ..
    } = resolve_diff_endpoints(ws, &set)
        .await?
        .ok_or(anyhow!("revision not found"))?;

    let store = ws.repo().store();
    let repo_path = RepoPath::from_internal_string(&path.repo_path)?;
    let source_path = copy_records
        .for_target(repo_path)
        .map(|record| record.source.as_ref())
        .unwrap_or(repo_path);
    let old_path = if source_path != repo_path {
        Some(ws.format_path(source_path)?)
    } else {
        None
    };

    let before = parent_tree.path_value(source_path)?;
    let after = final_tree.path_value(repo_path)?;
    let (before_value, after_value) = try_join!(
        conflicts::materialize_tree_value(store, source_path, before, parent_tree.labels()),
        conflicts::materialize_tree_value(store, repo_path, after, final_tree.labels())
    )?;
    let context = context as usize;

    if let MaterializedTreeValue::FileConflict(file) = after_value {
        let old_content = read_value_contents(source_path, before_value).await?;
        let merge_result = merge_file_conflict(&file);
        let blocks = format_conflict_blocks(&merge_result, &file.labels);
        let hunks = format_conflict_hunks(merge_result, &file.labels, context)?;
        let new_content =
            read_value_contents(repo_path, MaterializedTreeValue::FileConflict(file)).await?;
        return Ok(FileDiff {
            path,
            old_path,
            kind: FileDiffKind::Conflict,
            hunks: hunks.into_iter().map(conflict_hunk_rows).collect(),
            conflict: Some(blocks),
            old_line_count: count_lines(&old_content),
            new_line_count: count_lines(&new_content),
        });
    }

    let old_content = read_value_contents(source_path, before_value).await?;
    let new_content = read_value_contents(repo_path, after_value).await?;
    let kind = classify_contents(
        &old_content,
        &new_content,
        ws.data.workspace_settings.query_max_diff_bytes(),
    );
    let hunks = if kind == FileDiffKind::Text {
        unified_file_hunks(context, &old_content, &new_content)?
    } else {
        Vec::new()
    };

    Ok(FileDiff {
        path,
        old_path,
        kind,
        hunks,
        conflict: None,
        old_line_count: count_lines(&old_content),
        new_line_count: count_lines(&new_content),
    })
}

/// Lines `start..=end` (1-based, clamped) of a file on one side of a revset's diff.
pub async fn query_file_lines(
    ws: &WorkspaceSession<'_>,
    set: RevSet,
    path: TreePath,
    side: FileSide,
    start: u32,
    end: u32,
) -> Result<Vec<String>> {
    let DiffEndpoints {
        parent_tree,
        final_tree,
        ..
    } = resolve_diff_endpoints(ws, &set)
        .await?
        .ok_or(anyhow!("revision not found"))?;

    let tree = match side {
        FileSide::Old => parent_tree,
        FileSide::New => final_tree,
    };
    let repo_path = RepoPath::from_internal_string(&path.repo_path)?;
    let value = conflicts::materialize_tree_value(
        ws.repo().store(),
        repo_path,
        tree.path_value(repo_path)?,
        tree.labels(),
    )
    .await?;
    let content = read_value_contents(repo_path, value).await?;

    let start = start.max(1) as usize;
    let end = end as usize;
    if end < start {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&content)
        .lines()
        .skip(start - 1)
        .take(end - start + 1)
        .map(|line| line.to_owned())
        .collect())
}

pub fn query_op_log(ws: &WorkspaceSession, limit: u32, offset: u32) -> Result<Vec<OpLogEntry>> {
    let current = ws.repo().operation();
    op_walk::walk_ancestors(slice::from_ref(ws.head_operation()))
        .skip(offset as usize)
        .take(limit as usize)
        .map(|op| {
            let op = op?;
            OpLogEntry::new(&op, op.id() == current.id())
        })
        .collect()
}

pub fn query_evolog(ws: &WorkspaceSession, id: &RevId) -> Result<Vec<EvologEntry>> {
    let Some(commit) = ws.resolve_optional_id(id)? else {
        return Ok(Vec::new());
    };
    evolution::walk_predecessors(ws.repo(), slice::from_ref(commit.id()))
        .map(|entry| {
            let entry = entry?;
            Ok(EvologEntry {
                commit: ws.format_header(&entry.commit, None)?,
                operation: entry.operation.map(|op| op.metadata().description.clone()),
            })
        })
        .collect()
}

pub fn query_annotate(
    ws: &WorkspaceSession,
    id: &RevId,
    path: &TreePath,
) -> Result<FileAnnotation> {
    let Some(commit) = ws.resolve_optional_id(id)? else {
        return Err(anyhow!("revision not found"));
    };
    let repo_path = RepoPath::from_internal_string(&path.repo_path)?;
    let mut annotator = FileAnnotator::from_commit(&commit, repo_path)?;
    annotator.compute(ws.repo(), &RevsetExpression::all())?;
    let annotation = annotator.to_annotation();

    // shallow clones can leave lines without an origin; jj attributes those to the root too
    let root = LineOrigin {
        commit_id: ws.repo().store().root_commit_id().clone(),
        line_number: 0,
    };
    let mut origins = Vec::new();
    let mut indices: HashMap<CommitId, u32> = HashMap::new();
    let mut lines = Vec::new();
    for (origin, _) in annotation.line_origins() {
        let commit_id = &origin.unwrap_or(&root).commit_id;
        let index = match indices.get(commit_id) {
            Some(index) => *index,
            None => {
                let origin_commit = ws.get_commit(commit_id)?;
                let index = origins.len() as u32;
                origins.push(AnnotationOrigin {
                    id: ws.format_id(&origin_commit),
                    author: origin_commit.author().try_into()?,
                    summary: origin_commit
                        .description()
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                });
                indices.insert(commit_id.clone(), index);
                index
            }
        };
        lines.push(index);
    }
    Ok(FileAnnotation { origins, lines })
}

/// ahead/behind counts stop here; the ui shows "100+"
pub const BOOKMARK_COUNT_CAP: u32 = 100;

pub fn query_bookmarks(ws: &WorkspaceSession) -> Result<Vec<BookmarkEntry>> {
    // trunk itself is excluded, or a synced main would offer to delete itself
    let merged = ws.evaluate_revset_str("::trunk() ~ trunk()")?;
    let is_merged = merged.containing_fn();
    // one membership test for all targets; format_header's own check re-evaluates
    // immutable_heads() per commit, which dominated on repos with hundreds of remote bookmarks
    let immutable = ws.evaluate_immutable()?;
    let is_immutable = immutable.containing_fn();

    let mut entries = Vec::new();
    for (name, target) in ws.view().bookmarks() {
        let local = target.local_target;
        let mut remotes = Vec::new();
        for &(remote, remote_ref) in &target.remote_refs {
            if remote == REMOTE_NAME_FOR_LOCAL_GIT_REPO {
                continue;
            }
            let (ahead, behind) = if ws.is_large() {
                (None, None)
            } else {
                (
                    count_range(ws, &remote_ref.target, local)?,
                    count_range(ws, local, &remote_ref.target)?,
                )
            };
            remotes.push(RemoteBookmarkState {
                remote: remote.as_str().to_owned(),
                target: format_target(ws, &is_immutable, &remote_ref.target)?,
                tracked: remote_ref.is_tracked(),
                absent: remote_ref.is_tracked() && local.is_absent(),
                ahead,
                behind,
            });
        }
        entries.push(BookmarkEntry {
            name: name.as_str().to_owned(),
            target: format_target(ws, &is_immutable, local)?,
            has_conflict: local.has_conflict(),
            is_merged: match local.as_normal() {
                Some(id) => is_merged(id)?,
                None => false,
            },
            remotes,
        });
    }
    Ok(entries)
}

// conflicted targets show their first side; the conflict itself is flagged separately
fn format_target(
    ws: &WorkspaceSession,
    is_immutable: &impl Fn(&CommitId) -> Result<bool, RevsetEvaluationError>,
    target: &RefTarget,
) -> Result<Option<RevHeader>> {
    match target.added_ids().next() {
        Some(id) => {
            let immutable = is_immutable(id)?;
            Ok(Some(
                ws.format_header(&ws.get_commit(id)?, Some(immutable))?,
            ))
        }
        None => Ok(None),
    }
}

/// commits reachable from `heads` but not `roots`; None if either side is absent
fn count_range(ws: &WorkspaceSession, roots: &RefTarget, heads: &RefTarget) -> Result<Option<u32>> {
    if roots.is_absent() || heads.is_absent() {
        return Ok(None);
    }
    let roots = RevsetExpression::commits(roots.added_ids().cloned().collect());
    let heads = RevsetExpression::commits(heads.added_ids().cloned().collect());
    let revset = ws.evaluate_revset_expr(ws.repo(), roots.range(&heads))?;
    let count = revset
        .iter()
        .take(BOOKMARK_COUNT_CAP as usize)
        .process_results(|iter| iter.count())?;
    Ok(Some(count as u32))
}

pub fn query_remotes(
    ws: &WorkspaceSession,
    tracking_bookmark: Option<String>,
) -> Result<Vec<String>> {
    let git_repo = match ws.git_repo() {
        Some(git_repo) => git_repo,
        None => return Err(anyhow!("No git backend")),
    };

    let all_remotes = get_git_remote_names(&git_repo);

    let matching_remotes = match tracking_bookmark {
        Some(bookmark_name) => all_remotes
            .into_iter()
            .filter(|remote_name| {
                let remote_name_ref = RemoteNameBuf::from(remote_name);
                let bookmark_name_ref = RefNameBuf::from(bookmark_name.clone());
                let remote_ref_symbol = RemoteRefSymbol {
                    name: &bookmark_name_ref,
                    remote: &remote_name_ref,
                };
                let remote_ref = ws.view().get_remote_bookmark(remote_ref_symbol);
                !remote_ref.is_absent() && remote_ref.is_tracked()
            })
            .collect(),
        None => all_remotes,
    };

    Ok(matching_remotes)
}

async fn format_tree_changes(
    ws: &WorkspaceSession<'_>,
    mut tree_diff: BoxStream<'_, CopiesTreeDiffEntry>,
    conflict_labels: Diff<&ConflictLabels>,
) -> Result<Vec<RevChangeSummary>> {
    let store = ws.repo().store();
    let max_diff_bytes = ws.data.workspace_settings.query_max_diff_bytes();
    let mut changes = Vec::new();

    while let Some(entry) = tree_diff.next().await {
        let diff = entry.values?;
        let source = entry.path.source();
        let target = entry.path.target();
        let before = &diff.before;
        let after = &diff.after;

        let kind = if before.is_present() && after.is_present() {
            ChangeKind::Modified
        } else if before.is_absent() {
            ChangeKind::Added
        } else {
            ChangeKind::Deleted
        };

        let has_conflict = !after.is_resolved();

        let (before_value, after_value) = try_join!(
            conflicts::materialize_tree_value(
                store,
                source,
                before.clone(),
                conflict_labels.before
            ),
            conflicts::materialize_tree_value(store, target, after.clone(), conflict_labels.after)
        )?;

        let (added, removed, binary) =
            if let MaterializedTreeValue::FileConflict(file) = after_value {
                let hunks = format_conflict_hunks(merge_file_conflict(&file), &file.labels, 3)?;
                // tree value differs but materialised content is identical: reported as an inherited conflict instead
                if hunks.is_empty() {
                    continue;
                }
                let lines = hunks.iter().flat_map(|h| h.lines.lines.iter());
                let (mut added, mut removed) = (0, 0);
                for line in lines {
                    if line.starts_with('+') {
                        added += 1;
                    } else if line.starts_with('-') {
                        removed += 1;
                    }
                }
                (added, removed, false)
            } else {
                let old_content = read_value_contents(source, before_value).await?;
                let new_content = read_value_contents(target, after_value).await?;
                match classify_contents(&old_content, &new_content, max_diff_bytes) {
                    FileDiffKind::Text => {
                        let (added, removed) = line_diff_stat(&old_content, &new_content);
                        (added, removed, false)
                    }
                    FileDiffKind::Binary { .. } => (0, 0, true),
                    _ => (0, 0, false),
                }
            };

        changes.push(RevChangeSummary {
            kind,
            path: ws.format_path(target)?,
            old_path: entry
                .path
                .source
                .as_ref()
                .map(|(path, _)| ws.format_path(path))
                .transpose()?,
            has_conflict,
            added,
            removed,
            binary,
        });
    }
    Ok(changes)
}

fn merge_file_conflict(file: &MaterializedFileConflictValue) -> MergeResult {
    files::merge_hunks(
        &file.contents,
        &MergeOptions {
            hunk_level: FileMergeHunkLevel::Line,
            same_change: SameChange::Accept,
        },
    )
}

fn is_binary(content: &[u8]) -> bool {
    content[..8000.min(content.len())].contains(&b'\0') // same heuristic git uses
}

pub(super) fn classify_contents(old: &[u8], new: &[u8], max_diff_bytes: usize) -> FileDiffKind {
    let old_size = old.len() as u32;
    let new_size = new.len() as u32;
    if is_binary(old) || is_binary(new) {
        FileDiffKind::Binary { old_size, new_size }
    } else if old.len() > max_diff_bytes || new.len() > max_diff_bytes {
        FileDiffKind::TooLarge { old_size, new_size }
    } else {
        FileDiffKind::Text
    }
}

fn count_lines(content: &[u8]) -> u32 {
    let newlines = content.iter().filter(|b| **b == b'\n').count();
    let unterminated = !content.is_empty() && !content.ends_with(b"\n");
    (newlines + usize::from(unterminated)) as u32
}

fn line_diff_stat(old: &[u8], new: &[u8]) -> (u32, u32) {
    let diff = diff_by_line(
        [old, new],
        &LineDiffOptions {
            compare_mode: LineCompareMode::Exact,
        },
    );
    let (mut added, mut removed) = (0, 0);
    for hunk in diff.hunks() {
        if hunk.kind == DiffHunkKind::Different {
            removed += count_lines(hunk.contents[0]);
            added += count_lines(hunk.contents[1]);
        }
    }
    (added, removed)
}

/// the conflict as labelled side/base blocks, for accept-side actions
fn format_conflict_blocks(merge_result: &MergeResult, labels: &ConflictLabels) -> ConflictBlocks {
    fn split_lines(content: &[u8]) -> Vec<String> {
        String::from_utf8_lossy(content)
            .lines()
            .map(|line| line.to_owned())
            .collect()
    }

    let mut regions = Vec::new();
    let hunks = match merge_result {
        MergeResult::Resolved(content) => {
            regions.push(ConflictRegion::Resolved {
                lines: split_lines(content),
            });
            return ConflictBlocks { regions };
        }
        MergeResult::Conflict(hunks) => hunks,
    };

    for hunk in hunks {
        if let Some(content) = hunk.resolve_trivial(SameChange::Accept) {
            let lines = split_lines(content);
            if let Some(ConflictRegion::Resolved { lines: prev }) = regions.last_mut() {
                prev.extend(lines);
            } else {
                regions.push(ConflictRegion::Resolved { lines });
            }
            continue;
        }

        let num_bases = hunk.removes().len();
        regions.push(ConflictRegion::Conflict {
            sides: hunk
                .adds()
                .enumerate()
                .map(|(i, side)| ConflictSide {
                    label: labels
                        .get_add(i)
                        .map_or_else(|| format!("side {}", i + 1), |l| l.to_owned()),
                    lines: split_lines(side),
                })
                .collect(),
            bases: hunk
                .removes()
                .enumerate()
                .map(|(i, base)| ConflictSide {
                    label: labels.get_remove(i).map_or_else(
                        || {
                            if num_bases == 1 {
                                "base".to_owned()
                            } else {
                                format!("base {}", i + 1)
                            }
                        },
                        |l| l.to_owned(),
                    ),
                    lines: split_lines(base),
                })
                .collect(),
        });
    }

    ConflictBlocks { regions }
}

/// conflict hunks are prefix-encoded; markers carry no line on either side
fn conflict_hunk_rows(header: ChangeHunk) -> FileDiffHunk {
    let mut old_line = header.location.from_file.start as u32;
    let mut new_line = header.location.to_file.start as u32;
    let mut rows = Vec::new();
    for line in &header.lines.lines {
        let text = line
            .get(1..)
            .unwrap_or("")
            .trim_end_matches('\n')
            .to_owned();
        let kind = if line.starts_with(" <<<<<<<")
            || line.starts_with(" +++++++")
            || line.starts_with(" >>>>>>>")
        {
            DiffRowKind::Marker
        } else if line.starts_with('-') {
            DiffRowKind::Removed
        } else if line.starts_with('+') {
            DiffRowKind::Added
        } else {
            DiffRowKind::Context
        };
        let (old, new) = match kind {
            DiffRowKind::Marker => (None, None),
            DiffRowKind::Removed => (Some(old_line), None),
            DiffRowKind::Added => (None, Some(new_line)),
            DiffRowKind::Context => (Some(old_line), Some(new_line)),
        };
        old_line += u32::from(old.is_some());
        new_line += u32::from(new.is_some());
        rows.push(DiffRow {
            kind,
            old_line: old,
            new_line: new,
            text,
            tokens: Vec::new(),
        });
    }
    FileDiffHunk { header, rows }
}

async fn read_value_contents(path: &RepoPath, value: MaterializedTreeValue) -> Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;

    match value {
        MaterializedTreeValue::Absent => Ok(Vec::new()),
        MaterializedTreeValue::File(MaterializedFileValue { mut reader, .. }) => {
            let mut contents = vec![];
            reader.read_to_end(&mut contents).await?;
            Ok(contents)
        }
        MaterializedTreeValue::Symlink { target, .. } => Ok(target.into_bytes()),
        MaterializedTreeValue::GitSubmodule(_) => Ok("(submodule)".to_owned().into_bytes()),
        MaterializedTreeValue::FileConflict(file) => {
            let mut hunk_content = vec![];
            conflicts::materialize_merge_result(
                &file.contents,
                &file.labels,
                &mut hunk_content,
                &ConflictMaterializeOptions {
                    marker_style: ConflictMarkerStyle::Git,
                    marker_len: None,
                    merge: MergeOptions {
                        hunk_level: FileMergeHunkLevel::Line,
                        same_change: SameChange::Accept,
                    },
                },
            )?;
            Ok(hunk_content)
        }
        MaterializedTreeValue::OtherConflict { id, labels } => {
            Ok(id.describe(&labels).into_bytes())
        }
        MaterializedTreeValue::Tree(_) => Err(anyhow!("Unexpected tree in diff at path {path:?}")),
        MaterializedTreeValue::AccessDenied(error) => Err(anyhow!(error)),
    }
}

/// render a conflict as a sequence of diff hunks: base content as deletions,
/// sides as additions, resolved content as context. resolved regions are
/// trimmed to `num_context_lines` around each conflict; if too much resolved
/// content sits between two conflicts, the hunk is split so each carries its
/// own `@@ -a,b +c,d @@` header.
fn format_conflict_hunks(
    merge_result: MergeResult,
    labels: &ConflictLabels,
    num_context_lines: usize,
) -> Result<Vec<ChangeHunk>> {
    let hunks = match merge_result {
        MergeResult::Resolved(content) => {
            let mut lines = Vec::new();
            for line in String::from_utf8_lossy(&content).lines() {
                lines.push(format!(" {line}\n"));
            }
            let len = lines.len();
            if len == 0 {
                return Ok(Vec::new());
            }
            return Ok(vec![ChangeHunk {
                location: ChangeLocation {
                    from_file: ChangeRange { start: 1, len },
                    to_file: ChangeRange { start: 1, len },
                },
                lines: MultilineString { lines },
            }]);
        }
        MergeResult::Conflict(hunks) => hunks,
    };

    let num_conflicts = hunks.iter().filter(|h| !h.is_resolved()).count();
    let mut out: Vec<ChangeHunk> = Vec::new();
    let mut pending_resolved: Vec<String> = Vec::new();
    let mut from_cursor: usize = 0;
    let mut to_cursor: usize = 0;
    let mut current: Option<PendingHunk> = None;
    let mut conflict_idx = 0;

    for hunk in &hunks {
        if let Some(content) = hunk.resolve_trivial(SameChange::Accept) {
            for line in String::from_utf8_lossy(content).lines() {
                pending_resolved.push(format!(" {line}\n"));
            }
            continue;
        }

        flush_before_conflict(
            &mut out,
            &mut current,
            &mut pending_resolved,
            &mut from_cursor,
            &mut to_cursor,
            num_context_lines,
        );
        let cur = current.as_mut().expect("hunk must exist after flush");
        conflict_idx += 1;

        // when one side is empty (edit-vs-delete), show a diff between
        // base and the non-empty side instead of the raw merge output
        let adds: Vec<_> = hunk.adds().collect();
        let removes: Vec<_> = hunk.removes().collect();
        if removes.len() == 1
            && adds.len() == 2
            && let Some(empty_idx) = adds.iter().position(|s| s.is_empty())
        {
            let other_idx = 1 - empty_idx;
            let deleted_label = labels.get_add(empty_idx).map_or_else(
                || format!("side {}", empty_idx + 1),
                |l| format!("side {} ({l})", empty_idx + 1),
            );
            let kept_label = labels.get_add(other_idx).map_or_else(
                || format!("side {}", other_idx + 1),
                |l| format!("side {} ({l})", other_idx + 1),
            );
            cur.lines.push(format!(
                " <<<<<<< conflict {conflict_idx} of {num_conflicts} \
                 — deleted by {deleted_label}\n"
            ));
            let base_content = removes[0];
            let side_content = adds[other_idx];
            let diff_hunks = get_unified_hunks(3, base_content.as_ref(), side_content.as_ref())?;
            if diff_hunks.is_empty() {
                // base and kept side are identical
                cur.lines
                    .push(format!(" +++++++ {kept_label} (unchanged)\n"));
                for line in String::from_utf8_lossy(side_content).lines() {
                    cur.lines.push(format!(" {line}\n"));
                    cur.from_len += 1;
                    cur.to_len += 1;
                    from_cursor += 1;
                    to_cursor += 1;
                }
            } else {
                cur.lines.push(format!(" +++++++ {kept_label}\n"));
                for diff_hunk in &diff_hunks {
                    for line in &diff_hunk.lines.lines {
                        cur.lines.push(line.clone());
                        if line.starts_with('-') {
                            cur.from_len += 1;
                            from_cursor += 1;
                        } else if line.starts_with('+') {
                            cur.to_len += 1;
                            to_cursor += 1;
                        } else {
                            cur.from_len += 1;
                            cur.to_len += 1;
                            from_cursor += 1;
                            to_cursor += 1;
                        }
                    }
                }
            }
            cur.lines.push(format!(
                " >>>>>>> conflict {conflict_idx} of {num_conflicts}\n"
            ));
            continue;
        }

        cur.lines.push(format!(
            " <<<<<<< conflict {conflict_idx} of {num_conflicts}\n"
        ));
        for base in hunk.removes() {
            for line in String::from_utf8_lossy(base).lines() {
                cur.lines.push(format!("-{line}\n"));
                cur.from_len += 1;
                from_cursor += 1;
            }
        }
        for (i, side) in hunk.adds().enumerate() {
            let label = labels.get_add(i).map_or_else(
                || format!(" +++++++ side {}\n", i + 1),
                |l| format!(" +++++++ side {} ({l})\n", i + 1),
            );
            cur.lines.push(label);
            for line in String::from_utf8_lossy(side).lines() {
                cur.lines.push(format!("+{line}\n"));
                cur.to_len += 1;
                to_cursor += 1;
            }
        }
        cur.lines.push(format!(
            " >>>>>>> conflict {conflict_idx} of {num_conflicts}\n"
        ));
    }

    // trailing resolved context: keep at most `num_context_lines`, discard the rest
    if let Some(ref mut cur) = current {
        let keep = num_context_lines.min(pending_resolved.len());
        for line in pending_resolved.drain(..keep) {
            cur.lines.push(line);
            cur.from_len += 1;
            cur.to_len += 1;
        }
    }
    if let Some(cur) = current {
        out.push(cur.into_change_hunk());
    }

    Ok(out)
}

struct PendingHunk {
    from_start: usize, // 0-based absolute position at hunk start
    to_start: usize,
    lines: Vec<String>,
    from_len: usize,
    to_len: usize,
}

impl PendingHunk {
    fn new(from_start: usize, to_start: usize) -> Self {
        Self {
            from_start,
            to_start,
            lines: Vec::new(),
            from_len: 0,
            to_len: 0,
        }
    }

    fn into_change_hunk(self) -> ChangeHunk {
        ChangeHunk {
            location: ChangeLocation {
                from_file: ChangeRange {
                    start: self.from_start + 1,
                    len: self.from_len,
                },
                to_file: ChangeRange {
                    start: self.to_start + 1,
                    len: self.to_len,
                },
            },
            lines: MultilineString { lines: self.lines },
        }
    }
}

/// before emitting a conflict, flush buffered resolved-trivial lines.
/// keeps up to `num_context_lines` adjacent to each conflict; if the gap
/// between two conflicts exceeds `2 * num_context_lines`, splits the current
/// hunk and starts a new one so each has its own header.
fn flush_before_conflict(
    out: &mut Vec<ChangeHunk>,
    current: &mut Option<PendingHunk>,
    pending: &mut Vec<String>,
    from_cursor: &mut usize,
    to_cursor: &mut usize,
    num_context_lines: usize,
) {
    let n = pending.len();

    if let Some(cur) = current {
        if n <= 2 * num_context_lines {
            for line in pending.drain(..) {
                cur.lines.push(line);
                cur.from_len += 1;
                cur.to_len += 1;
                *from_cursor += 1;
                *to_cursor += 1;
            }
            return;
        }

        for line in pending.drain(..num_context_lines) {
            cur.lines.push(line);
            cur.from_len += 1;
            cur.to_len += 1;
            *from_cursor += 1;
            *to_cursor += 1;
        }
        let skip = n - 2 * num_context_lines;
        pending.drain(..skip);
        *from_cursor += skip;
        *to_cursor += skip;
        out.push(current.take().unwrap().into_change_hunk());
    } else if n > num_context_lines {
        let skip = n - num_context_lines;
        pending.drain(..skip);
        *from_cursor += skip;
        *to_cursor += skip;
    }

    let mut new_hunk = PendingHunk::new(*from_cursor, *to_cursor);
    for line in pending.drain(..) {
        new_hunk.lines.push(line);
        new_hunk.from_len += 1;
        new_hunk.to_len += 1;
        *from_cursor += 1;
        *to_cursor += 1;
    }
    *current = Some(new_hunk);
}

fn get_unified_hunks(
    num_context_lines: usize,
    left_content: &[u8],
    right_content: &[u8],
) -> Result<Vec<ChangeHunk>> {
    unified_diff_hunks(
        left_content,
        right_content,
        &unified_diff_options(num_context_lines),
    )
    .iter()
    .map(change_hunk_header)
    .collect()
}

fn unified_diff_options(num_context_lines: usize) -> UnifiedDiffOptions {
    UnifiedDiffOptions {
        context: num_context_lines,
        line_diff: LineDiffOptions {
            compare_mode: LineCompareMode::Exact,
        },
    }
}

/// prefix-encoded hunk, the payload MoveHunk/CopyHunk expect
fn change_hunk_header(hunk: &UnifiedDiffHunk) -> Result<ChangeHunk> {
    let location = ChangeLocation {
        from_file: ChangeRange {
            start: hunk.left_line_range.start,
            len: hunk.left_line_range.len(),
        },
        to_file: ChangeRange {
            start: hunk.right_line_range.start,
            len: hunk.right_line_range.len(),
        },
    };

    let mut lines = Vec::new();
    for (line_type, tokens) in &hunk.lines {
        let mut formatter: Vec<u8> = vec![];
        match line_type {
            DiffLineType::Context => write!(formatter, " ")?,
            DiffLineType::Removed => write!(formatter, "-")?,
            DiffLineType::Added => write!(formatter, "+")?,
        }
        for (_, content) in tokens {
            formatter.write_all(content)?;
        }
        lines.push(String::from_utf8_lossy(&formatter).into_owned());
    }

    Ok(ChangeHunk {
        location,
        lines: MultilineString { lines },
    })
}

fn unified_file_hunks(
    num_context_lines: usize,
    left_content: &[u8],
    right_content: &[u8],
) -> Result<Vec<FileDiffHunk>> {
    let mut hunks = Vec::new();
    for hunk in unified_diff_hunks(
        left_content,
        right_content,
        &unified_diff_options(num_context_lines),
    ) {
        let header = change_hunk_header(&hunk)?;
        let mut old_line = hunk.left_line_range.start as u32;
        let mut new_line = hunk.right_line_range.start as u32;
        let mut rows = Vec::new();
        for (line_type, tokens) in &hunk.lines {
            let (kind, old, new) = match line_type {
                DiffLineType::Context => (DiffRowKind::Context, Some(old_line), Some(new_line)),
                DiffLineType::Removed => (DiffRowKind::Removed, Some(old_line), None),
                DiffLineType::Added => (DiffRowKind::Added, None, Some(new_line)),
            };
            old_line += u32::from(old.is_some());
            new_line += u32::from(new.is_some());
            let (text, tokens) = format_row_tokens(tokens);
            rows.push(DiffRow {
                kind,
                old_line: old,
                new_line: new,
                text,
                tokens,
            });
        }
        hunks.push(FileDiffHunk { header, rows });
    }
    Ok(hunks)
}

/// row text without its newline, plus changed ranges in utf-16 units. a row with
/// nothing matching gets no ranges - highlighting the whole line adds no information.
fn format_row_tokens(tokens: &[(DiffTokenType, &[u8])]) -> (String, Vec<DiffToken>) {
    let mut text = String::new();
    let mut ranges: Vec<DiffToken> = Vec::new();
    let mut offset = 0u32;
    let mut any_matching = false;
    for (token_type, content) in tokens {
        let content = String::from_utf8_lossy(content);
        let len = content.encode_utf16().count() as u32;
        match token_type {
            DiffTokenType::Matching => any_matching = true,
            DiffTokenType::Different => match ranges.last_mut() {
                Some(prev) if prev.end == offset => prev.end += len,
                _ => ranges.push(DiffToken {
                    start: offset,
                    end: offset + len,
                }),
            },
        }
        text.push_str(&content);
        offset += len;
    }

    let trimmed = text.trim_end_matches(['\n', '\r']).len();
    text.truncate(trimmed);
    if !any_matching {
        return (text, Vec::new());
    }

    let text_len = text.encode_utf16().count() as u32;
    let ranges = ranges
        .into_iter()
        .filter_map(|range| {
            let end = range.end.min(text_len);
            (range.start < end).then_some(DiffToken {
                start: range.start,
                end,
            })
        })
        .collect();
    (text, ranges)
}

/**************************/
/* from jj_cli::diff_util */
/**************************/

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnifiedDiffOptions {
    /// Number of context lines to show.
    pub context: usize,
    /// How lines are tokenized and compared.
    pub line_diff: LineDiffOptions,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DiffLineType {
    Context,
    Removed,
    Added,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DiffTokenType {
    Matching,
    Different,
}

type DiffTokenVec<'content> = Vec<(DiffTokenType, &'content [u8])>;

struct UnifiedDiffHunk<'content> {
    left_line_range: Range<usize>,
    right_line_range: Range<usize>,
    lines: Vec<(DiffLineType, DiffTokenVec<'content>)>,
}

impl<'content> UnifiedDiffHunk<'content> {
    fn extend_context_lines(&mut self, lines: impl IntoIterator<Item = &'content [u8]>) {
        let old_len = self.lines.len();
        self.lines.extend(lines.into_iter().map(|line| {
            let tokens = vec![(DiffTokenType::Matching, line)];
            (DiffLineType::Context, tokens)
        }));
        self.left_line_range.end += self.lines.len() - old_len;
        self.right_line_range.end += self.lines.len() - old_len;
    }

    fn extend_removed_lines(&mut self, lines: impl IntoIterator<Item = DiffTokenVec<'content>>) {
        let old_len = self.lines.len();
        self.lines
            .extend(lines.into_iter().map(|line| (DiffLineType::Removed, line)));
        self.left_line_range.end += self.lines.len() - old_len;
    }

    fn extend_added_lines(&mut self, lines: impl IntoIterator<Item = DiffTokenVec<'content>>) {
        let old_len = self.lines.len();
        self.lines
            .extend(lines.into_iter().map(|line| (DiffLineType::Added, line)));
        self.right_line_range.end += self.lines.len() - old_len;
    }
}

fn unified_diff_hunks<'content>(
    left_content: &'content [u8],
    right_content: &'content [u8],
    options: &UnifiedDiffOptions,
) -> Vec<UnifiedDiffHunk<'content>> {
    let mut hunks = vec![];
    let mut current_hunk = UnifiedDiffHunk {
        left_line_range: 1..1,
        right_line_range: 1..1,
        lines: vec![],
    };
    let diff = diff_by_line([left_content, right_content], &options.line_diff);
    let mut diff_hunks = diff.hunks().peekable();
    while let Some(hunk) = diff_hunks.next() {
        match hunk.kind {
            DiffHunkKind::Matching => {
                // Just use the right (i.e. new) content. We could count the
                // number of skipped lines separately, but the number of the
                // context lines should match the displayed content.
                let [_, right] = hunk.contents[..].try_into().unwrap();
                let mut lines = right.split_inclusive(|b| *b == b'\n').fuse();
                if !current_hunk.lines.is_empty() {
                    // The previous hunk line should be either removed/added.
                    current_hunk.extend_context_lines(lines.by_ref().take(options.context));
                }
                let before_lines = if diff_hunks.peek().is_some() {
                    lines.by_ref().rev().take(options.context).collect()
                } else {
                    vec![] // No more hunks
                };
                let num_skip_lines = lines.count();
                if num_skip_lines > 0 {
                    let left_start = current_hunk.left_line_range.end + num_skip_lines;
                    let right_start = current_hunk.right_line_range.end + num_skip_lines;
                    if !current_hunk.lines.is_empty() {
                        hunks.push(current_hunk);
                    }
                    current_hunk = UnifiedDiffHunk {
                        left_line_range: left_start..left_start,
                        right_line_range: right_start..right_start,
                        lines: vec![],
                    };
                }
                // The next hunk should be of DiffHunk::Different type if any.
                current_hunk.extend_context_lines(before_lines.into_iter().rev());
            }
            DiffHunkKind::Different => {
                let (left_lines, right_lines) =
                    unzip_diff_hunks_to_lines(ContentDiff::by_word(hunk.contents).hunks());
                current_hunk.extend_removed_lines(left_lines);
                current_hunk.extend_added_lines(right_lines);
            }
        }
    }
    if !current_hunk.lines.is_empty() {
        hunks.push(current_hunk);
    }
    hunks
}

/// Splits `(left, right)` hunk pairs into `(left_lines, right_lines)`.
#[allow(dead_code)]
fn unzip_diff_hunks_to_lines<'content, I>(
    diff_hunks: I,
) -> (Vec<DiffTokenVec<'content>>, Vec<DiffTokenVec<'content>>)
where
    I: IntoIterator,
    I::Item: Borrow<DiffHunk<'content>>,
{
    let mut left_lines: Vec<DiffTokenVec<'content>> = vec![];
    let mut right_lines: Vec<DiffTokenVec<'content>> = vec![];
    let mut left_tokens: DiffTokenVec<'content> = vec![];
    let mut right_tokens: DiffTokenVec<'content> = vec![];

    for hunk in diff_hunks {
        let hunk = hunk.borrow();
        match hunk.kind {
            DiffHunkKind::Matching => {
                // TODO: add support for unmatched contexts
                debug_assert!(hunk.contents.iter().all_equal());
                for token in hunk.contents[0].split_inclusive(|b| *b == b'\n') {
                    left_tokens.push((DiffTokenType::Matching, token));
                    right_tokens.push((DiffTokenType::Matching, token));
                    if token.ends_with(b"\n") {
                        left_lines.push(mem::take(&mut left_tokens));
                        right_lines.push(mem::take(&mut right_tokens));
                    }
                }
            }
            DiffHunkKind::Different => {
                let [left, right] = hunk.contents[..]
                    .try_into()
                    .expect("hunk should have exactly two inputs");
                for token in left.split_inclusive(|b| *b == b'\n') {
                    left_tokens.push((DiffTokenType::Different, token));
                    if token.ends_with(b"\n") {
                        left_lines.push(mem::take(&mut left_tokens));
                    }
                }
                for token in right.split_inclusive(|b| *b == b'\n') {
                    right_tokens.push((DiffTokenType::Different, token));
                    if token.ends_with(b"\n") {
                        right_lines.push(mem::take(&mut right_tokens));
                    }
                }
            }
        }
    }

    if !left_tokens.is_empty() {
        left_lines.push(left_tokens);
    }
    if !right_tokens.is_empty() {
        right_lines.push(right_tokens);
    }
    (left_lines, right_lines)
}

fn diff_by_line<'input, T: AsRef<[u8]> + ?Sized + 'input>(
    inputs: impl IntoIterator<Item = &'input T>,
    options: &LineDiffOptions,
) -> jj_lib::diff::ContentDiff<'input> {
    // TODO: If we add --ignore-blank-lines, its tokenizer will have to attach
    // blank lines to the preceding range. Maybe it can also be implemented as a
    // post-process (similar to refine_changed_regions()) that expands unchanged
    // regions across blank lines.
    use jj_lib::diff::ContentDiff;
    match options.compare_mode {
        LineCompareMode::Exact => {
            ContentDiff::for_tokenizer(inputs, find_line_ranges, CompareBytesExactly)
        }
        LineCompareMode::IgnoreAllSpace => {
            ContentDiff::for_tokenizer(inputs, find_line_ranges, CompareBytesIgnoreAllWhitespace)
        }
        LineCompareMode::IgnoreSpaceChange => {
            ContentDiff::for_tokenizer(inputs, find_line_ranges, CompareBytesIgnoreWhitespaceAmount)
        }
    }
}

fn commit_id_identity(commit_id: &CommitId) -> &CommitId {
    commit_id
}
