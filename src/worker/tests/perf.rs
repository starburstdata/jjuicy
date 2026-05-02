use std::time::{Duration, Instant};

use anyhow::Result;
use jj_lib::{commit::Commit, op_store::RefTarget, ref_name::RefNameBuf};

use crate::worker::WorkerSession;

/// Benchmark `compute_hidden_forks` across a range of (commits, bookmarks, branch_depth) combos.
///
/// Run with:
///   cargo test bench_compute_hidden_forks -- --ignored --nocapture
///
/// Configurable via BENCH_COMMITS / BENCH_BOOKMARKS / BENCH_DEPTH env vars (comma-separated):
///   BENCH_COMMITS=1000,5000 BENCH_BOOKMARKS=50,500 cargo test bench_compute_hidden_forks -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn bench_compute_hidden_forks() -> Result<()> {
    let commit_sizes = env_list("BENCH_COMMITS", &[100, 500, 1_000, 5_000, 9_000]);
    let bookmark_counts = env_list("BENCH_BOOKMARKS", &[10, 50, 100, 500]);
    let branch_depth = std::env::var("BENCH_DEPTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2usize);

    println!(
        "\n{:<12} {:<12} {:<8} {:>12}",
        "commits", "bookmarks", "depth", "elapsed"
    );
    println!("{}", "-".repeat(48));

    for &n_commits in &commit_sizes {
        for &n_bookmarks in &bookmark_counts {
            let elapsed = time_hidden_forks(n_commits, n_bookmarks, branch_depth).await?;
            println!(
                "{:<12} {:<12} {:<8} {:>12}",
                n_commits,
                n_bookmarks,
                branch_depth,
                format!("{elapsed:.2?}"),
            );
        }
        println!();
    }

    Ok(())
}

async fn time_hidden_forks(
    num_commits: usize,
    num_bookmarks: usize,
    branch_depth: usize,
) -> Result<Duration> {
    let dir = tempfile::tempdir()?;

    let mut session = WorkerSession::default();
    session
        .init_repository(&dir.path().to_owned(), false)
        .await?;

    // disable the large-repo cutoff so BFS always runs, regardless of system config
    std::fs::write(
        dir.path().join(".jj").join("config.toml"),
        "[jjuicy.queries]\nlarge-repo-heuristic = 99999999\n",
    )?;

    let mut ws = session.load_workspace(dir.path()).await?;
    let empty_tree = ws.get_commit(ws.wc_id())?.tree();
    let wc_name = ws.name().to_owned();

    // snapshot + get transaction (snapshot is a no-op on a fresh empty repo)
    let mut tx = ws.start_transaction().await?;

    // linear log chain: root (@) → c0 → c1 → ... → c(N-1)  (c(N-1) becomes new @)
    let mut last_commit: Commit = ws.get_commit(ws.wc_id())?;
    let mut chain: Vec<jj_lib::backend::CommitId> = vec![last_commit.id().clone()];
    for i in 0..num_commits {
        let commit: Commit = tx
            .repo_mut()
            .new_commit(vec![last_commit.id().clone()], empty_tree.clone())
            .set_description(format!("c{i}"))
            .write()
            .await?;
        chain.push(commit.id().clone());
        last_commit = commit;
    }

    // advance working copy to the chain tip
    tx.repo_mut().edit(wc_name.clone(), &last_commit).await?;

    // side branches: each forks off a chain commit at even spacing, then descends
    // branch_depth commits and gets a bookmark at its tip (these are the out-of-log commits)
    let log_len = chain.len();
    let spacing = log_len.saturating_sub(1) / num_bookmarks.max(1);
    let spacing = spacing.max(1);
    for b in 0..num_bookmarks {
        let idx = (1 + spacing * b).min(log_len - 2).max(1);
        let mut parent_id = chain[idx].clone();
        for _ in 0..branch_depth {
            let commit: Commit = tx
                .repo_mut()
                .new_commit(vec![parent_id], empty_tree.clone())
                .write()
                .await?;
            parent_id = commit.id().clone();
        }
        tx.repo_mut().set_local_bookmark_target(
            &RefNameBuf::from(format!("bm-{b}")),
            RefTarget::normal(parent_id),
        );
    }

    ws.finish_transaction(tx, "perf-setup").await?;

    let t = Instant::now();
    ws.compute_hidden_forks("::@")?;
    Ok(t.elapsed())
}

/// Time `compute_hidden_forks` on a real repo.
///
/// Run with:
///   BENCH_REPO=/path/to/repo cargo test bench_hidden_forks_real -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn bench_hidden_forks_real() -> Result<()> {
    let repo_path = std::env::var("BENCH_REPO")
        .map(std::path::PathBuf::from)
        .expect("set BENCH_REPO=/path/to/jj/repo");

    let mut session = WorkerSession::default();
    let ws = session.load_workspace(&repo_path).await?;

    let t = std::time::Instant::now();
    let forks = ws.compute_hidden_forks("::@")?;
    let elapsed = t.elapsed();
    let total_refs: usize = forks.values().map(|v| v.len()).sum();
    let json_bytes = serde_json::to_vec(&forks)?.len();
    println!(
        "\ncompute_hidden_forks on {}: {:?} ({} commits with hidden forks, {} total refs, {} JSON)",
        repo_path.display(),
        elapsed,
        forks.len(),
        total_refs,
        human_bytes(json_bytes),
    );

    Ok(())
}

fn human_bytes(n: usize) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let mut value = n as f64;
    let mut unit = UNITS[0];
    for &u in &UNITS[1..] {
        if value < 1024.0 {
            break;
        }
        value /= 1024.0;
        unit = u;
    }
    if value < 10.0 {
        format!("{value:.1} {unit}")
    } else {
        format!("{value:.0} {unit}")
    }
}

fn env_list(var: &str, defaults: &[usize]) -> Vec<usize> {
    std::env::var(var)
        .ok()
        .and_then(|s| {
            s.split(',')
                .map(|x| x.trim().parse::<usize>().ok())
                .collect::<Option<Vec<_>>>()
        })
        .unwrap_or_else(|| defaults.to_vec())
}
