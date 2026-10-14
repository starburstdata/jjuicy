//! Request/response types for read-only operations like log listing and
//! revision details.

use super::*;

/// A file-level change within a revision's diff. Hunks are fetched separately
/// with `query_file_diff`.
#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct RevChangeSummary {
    pub kind: ChangeKind,
    pub path: TreePath,
    /// Source path when the file was renamed or copied.
    pub old_path: Option<TreePath>,
    pub has_conflict: bool,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
}

/// A file that is conflicted in the final tree but unchanged by the revisions.
#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct RevConflict {
    pub path: TreePath,
}

/// The type of modification made to a file in a diff.
#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum ChangeKind {
    None,
    Added,
    Deleted,
    Modified,
}

/// Response to a revision detail query: either not found or full details.
#[derive(Serialize, Debug)]
#[serde(tag = "type")]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
#[allow(clippy::large_enum_variant)]
pub enum RevsResult {
    NotFound {
        set: RevSet,
    },
    Detail {
        /// The revision set that was queried.
        set: RevSet,
        /// All revisions in the set, ordered ancestors-first.
        headers: Vec<RevHeader>,
        /// Parents of the oldest revision in the set.
        parents: Vec<RevHeader>,
        /// Combined changes: diff from oldest parent to newest revision.
        changes: Vec<RevChangeSummary>,
        /// Conflicts present in the parent tree of the oldest revision.
        conflicts: Vec<RevConflict>,
    },
}

/// Full diff of one file across a revision set.
#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct FileDiff {
    pub path: TreePath,
    pub old_path: Option<TreePath>,
    pub kind: FileDiffKind,
    pub hunks: Vec<FileDiffHunk>,
    /// Side/base blocks when `kind` is `Conflict`.
    pub conflict: Option<ConflictBlocks>,
    pub old_line_count: u32,
    pub new_line_count: u32,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "type")]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum FileDiffKind {
    Text,
    Binary { old_size: u32, new_size: u32 },
    TooLarge { old_size: u32, new_size: u32 },
    Conflict,
}

/// A diff hunk: `header` is the drag payload for hunk mutations, `rows` are for display.
#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct FileDiffHunk {
    pub header: ChangeHunk,
    pub rows: Vec<DiffRow>,
}

#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct DiffRow {
    pub kind: DiffRowKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
    /// Changed ranges within `text`, for word highlighting.
    pub tokens: Vec<DiffToken>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone, Copy)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum DiffRowKind {
    Context,
    Added,
    Removed,
    /// Conflict marker line; corresponds to no line on either side.
    Marker,
}

/// Half-open range in UTF-16 code units, matching JS string indexing.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct DiffToken {
    pub start: u32,
    pub end: u32,
}

#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct ConflictBlocks {
    pub regions: Vec<ConflictRegion>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum ConflictRegion {
    Resolved {
        lines: Vec<String>,
    },
    Conflict {
        sides: Vec<ConflictSide>,
        bases: Vec<ConflictSide>,
    },
}

#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct ConflictSide {
    pub label: String,
    pub lines: Vec<String>,
}

/// Which side of a diff to read from.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum FileSide {
    Old,
    New,
}

/// (column, row) position of a node in the log graph.
#[derive(Serialize, Clone, Copy, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct LogCoordinates(pub usize, pub usize);

/// An edge segment in the log graph connecting two nodes.
#[derive(Serialize, Debug)]
#[serde(tag = "type")]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub enum LogLine {
    FromNode {
        source: LogCoordinates,
        target: LogCoordinates,
        indirect: bool,
        /// For rescue sweeps: the column where the stem ran before this
        /// commit swapped it left. The renderer bends twice so the line
        /// leaves the source toward `via`, runs straight down `via`, then
        /// bends again to land at `target`.
        via: Option<usize>,
    },
    ToNode {
        source: LogCoordinates,
        target: LogCoordinates,
        indirect: bool,
    },
    ToIntersection {
        source: LogCoordinates,
        target: LogCoordinates,
        indirect: bool,
    },
    ToMissing {
        source: LogCoordinates,
        target: LogCoordinates,
        indirect: bool,
    },
}

/// A single row in the log graph with its revision and edges.
#[derive(Serialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct LogRow {
    pub revision: RevHeader,
    pub location: LogCoordinates,
    pub padding: usize,
    pub lines: Vec<LogLine>,
    /// Names of bookmarks outside the log revset whose nearest visible ancestor is this commit.
    pub hidden_forks: Vec<String>,
}

/// A paginated slice of the log graph.
#[derive(Serialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct LogPage {
    pub rows: Vec<LogRow>,
    pub has_more: bool,
}

/// A bookmark with its local target and the state of each remote copy.
#[derive(Serialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct BookmarkEntry {
    pub name: String,
    /// None when there is no local bookmark (deleted, or never fetched as tracked).
    pub target: Option<RevHeader>,
    pub has_conflict: bool,
    /// The local target is a strict ancestor of `trunk()`.
    pub is_merged: bool,
    pub remotes: Vec<RemoteBookmarkState>,
}

/// One remote's copy of a bookmark, relative to the local bookmark.
#[derive(Serialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct RemoteBookmarkState {
    pub remote: String,
    pub target: Option<RevHeader>,
    pub tracked: bool,
    /// Tracked, but the local bookmark has been deleted; the next push deletes it.
    pub absent: bool,
    /// Commits on the local target not on the remote, capped at `BOOKMARK_COUNT_CAP`.
    /// None when there is nothing to compare, or the repo is too large to count.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

/// One version of a change, newest first, like `jj evolog`.
#[derive(Serialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct EvologEntry {
    pub commit: RevHeader,
    /// Description of the operation that created this version, when known.
    pub operation: Option<String>,
}

/// One entry in the operation log, newest first.
#[derive(Serialize, Debug)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "app/messages/"))]
pub struct OpLogEntry {
    pub id: String,
    pub description: String,
    /// When the operation finished.
    pub time: chrono::DateTime<Local>,
    pub user: String,
    pub host: String,
    /// The operation the workspace is loaded at.
    pub is_current: bool,
}

impl OpLogEntry {
    pub fn new(op: &Operation, is_current: bool) -> Result<OpLogEntry> {
        let metadata = op.metadata();
        Ok(OpLogEntry {
            id: op.id().hex(),
            description: metadata.description.clone(),
            time: format_timestamp(&metadata.time.end)?.with_timezone(&Local),
            user: metadata.username.clone(),
            host: metadata.hostname.clone(),
            is_current,
        })
    }
}
