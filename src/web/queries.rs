//! Typed handlers for web mode queries

use std::path::PathBuf;
use std::sync::mpsc::channel;

use axum::{Json, Router, extract::State, routing::post};
use serde::Deserialize;

use crate::messages::{
    RepoConfig, RepoStatus, RevId, RevSet, TreePath,
    queries::{BookmarkEntry, EvologEntry, FileDiff, FileSide, LogPage, OpLogEntry, RevsResult},
};
use crate::worker::SessionEvent;

use super::ApiError;
use super::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/query_workspace", post(query_workspace))
        .route("/query_log", post(query_log))
        .route("/query_log_next_page", post(query_log_next_page))
        .route("/query_revisions", post(query_revisions))
        .route("/query_file_diff", post(query_file_diff))
        .route("/query_file_lines", post(query_file_lines))
        .route("/query_remotes", post(query_remotes))
        .route("/query_bookmarks", post(query_bookmarks))
        .route("/query_op_log", post(query_op_log))
        .route("/query_evolog", post(query_evolog))
        .route("/view_operation", post(view_operation))
        .route("/query_recent_workspaces", post(query_recent_workspaces))
        .route("/query_snapshot", post(query_snapshot))
}

#[derive(Deserialize)]
pub struct QueryWorkspace {
    path: Option<String>,
}

async fn query_workspace(
    State(state): State<AppState>,
    Json(req): Json<QueryWorkspace>,
) -> Result<Json<RepoConfig>, ApiError> {
    let path = req.path.map(PathBuf::from);
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::OpenWorkspace {
        tx,
        wd: path.clone(),
    })?;

    let config = match rx.recv()? {
        Ok(config) => {
            log::debug!("load workspace succeeded");
            config
        }
        Err(err) => {
            log::warn!("load workspace failed: {err}");
            RepoConfig::LoadError {
                absolute_path: path.unwrap_or_default().into(),
                message: format!("{:#}", err),
            }
        }
    };

    Ok(Json(config))
}

#[derive(Deserialize)]
pub struct QueryLog {
    revset: String,
}

async fn query_log(
    State(state): State<AppState>,
    Json(req): Json<QueryLog>,
) -> Result<Json<LogPage>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryLog {
        tx,
        query: req.revset,
    })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

async fn query_log_next_page(State(state): State<AppState>) -> Result<Json<LogPage>, ApiError> {
    let (tx, rx) = channel();
    state
        .worker_tx
        .send(SessionEvent::QueryLogNextPage { tx })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryRevisions {
    set: RevSet,
}

async fn query_revisions(
    State(state): State<AppState>,
    Json(req): Json<QueryRevisions>,
) -> Result<Json<RevsResult>, ApiError> {
    let (tx, rx) = channel();
    state
        .worker_tx
        .send(SessionEvent::QueryRevisions { tx, set: req.set })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryFileDiff {
    set: RevSet,
    path: TreePath,
    context: u32,
}

async fn query_file_diff(
    State(state): State<AppState>,
    Json(req): Json<QueryFileDiff>,
) -> Result<Json<FileDiff>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryFileDiff {
        tx,
        set: req.set,
        path: req.path,
        context: req.context,
    })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryFileLines {
    set: RevSet,
    path: TreePath,
    side: FileSide,
    start: u32,
    end: u32,
}

async fn query_file_lines(
    State(state): State<AppState>,
    Json(req): Json<QueryFileLines>,
) -> Result<Json<Vec<String>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryFileLines {
        tx,
        set: req.set,
        path: req.path,
        side: req.side,
        start: req.start,
        end: req.end,
    })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryRemotes {
    tracking_bookmark: Option<String>,
}

async fn query_remotes(
    State(state): State<AppState>,
    Json(req): Json<QueryRemotes>,
) -> Result<Json<Vec<String>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryRemotes {
        tx,
        tracking_bookmark: req.tracking_bookmark,
    })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

async fn query_bookmarks(
    State(state): State<AppState>,
) -> Result<Json<Vec<BookmarkEntry>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryBookmarks { tx })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryOpLog {
    limit: u32,
    offset: u32,
}

async fn query_op_log(
    State(state): State<AppState>,
    Json(req): Json<QueryOpLog>,
) -> Result<Json<Vec<OpLogEntry>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::QueryOpLog {
        tx,
        limit: req.limit,
        offset: req.offset,
    })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct QueryEvolog {
    id: RevId,
}

async fn query_evolog(
    State(state): State<AppState>,
    Json(req): Json<QueryEvolog>,
) -> Result<Json<Vec<EvologEntry>>, ApiError> {
    let (tx, rx) = channel();
    state
        .worker_tx
        .send(SessionEvent::QueryEvolog { tx, id: req.id })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct ViewOperation {
    id: Option<String>,
}

async fn view_operation(
    State(state): State<AppState>,
    Json(req): Json<ViewOperation>,
) -> Result<Json<RepoStatus>, ApiError> {
    let (tx, rx) = channel();
    state
        .worker_tx
        .send(SessionEvent::ViewOperation { tx, id: req.id })?;
    let result = rx.recv()??;
    Ok(Json(result))
}

async fn query_recent_workspaces(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::ReadConfigArray {
        tx,
        key: vec!["jjuicy".into(), "ui".into(), "recent-workspaces".into()],
    })?;
    let result = rx.recv()?.unwrap_or_default();
    Ok(Json(result))
}

async fn query_snapshot(
    State(state): State<AppState>,
) -> Result<Json<Option<RepoStatus>>, ApiError> {
    let (tx, rx) = channel();
    state.worker_tx.send(SessionEvent::ExecuteSnapshot { tx })?;
    let result = rx.recv()?;
    Ok(Json(result))
}
