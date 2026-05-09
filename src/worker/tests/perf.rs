use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::Result;

use crate::worker::{WorkerSession, queries};

const TIMEOUT_SECS: u64 = 30;

struct RevsetBench {
    name: &'static str,
    revset: &'static str,
}

const REVSETS: &[RevsetBench] = &[
    RevsetBench {
        name: "all()",
        revset: "all()",
    },
    RevsetBench {
        name: "::@",
        revset: "::@",
    },
    RevsetBench {
        name: "default",
        revset: r#"present(@) | ancestors(immutable_heads().., 2) | trunk()"#,
    },
    RevsetBench {
        name: "mine",
        revset: "trunk() | (trunk()..(bookmarks() & mine())) | parents(bookmarks() & mine()) | @",
    },
];

/// Run with: BENCH_REPO=/path/to/repo cargo test query_bench -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn query_bench() -> Result<()> {
    let repo_path = match std::env::var("BENCH_REPO") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            eprintln!("SKIP: set BENCH_REPO=/path/to/jj/repo to run this benchmark");
            return Ok(());
        }
    };

    if !repo_path.join(".jj").exists() {
        eprintln!("SKIP: no .jj directory found at {}", repo_path.display());
        return Ok(());
    }

    eprintln!("repo: {}", repo_path.display());

    let mut session = WorkerSession::default();

    let t0 = Instant::now();
    let mut ws = session.load_workspace(&repo_path).await?;
    eprintln!("load_workspace: {}ms", t0.elapsed().as_millis());

    let t1 = Instant::now();
    ws.import_and_snapshot(false, true).await?;
    eprintln!("import_and_snapshot: {}ms", t1.elapsed().as_millis());

    eprintln!();
    eprintln!(
        "{:<12} {:>10} {:>10} {:>10} {:>10}  {:<6}",
        "revset", "eval", "forks", "page", "total", "rows"
    );
    eprintln!("{}", "-".repeat(70));

    for bench in REVSETS {
        let (_cancel, rx) = mpsc::channel::<()>();
        let bench_name = bench.name;

        std::thread::spawn(move || {
            if let Err(mpsc::RecvTimeoutError::Timeout) =
                rx.recv_timeout(Duration::from_secs(TIMEOUT_SECS))
            {
                eprintln!("{bench_name:<12}  TIMEOUT (>{TIMEOUT_SECS}s)");
                std::process::exit(1);
            }
        });

        let t_total = Instant::now();

        let t_eval = Instant::now();
        let revset_result = ws.evaluate_revset_str(bench.revset);
        let eval_ms = t_eval.elapsed().as_millis();

        let revset = match revset_result {
            Ok(r) => r,
            Err(e) => {
                eprintln!("{:<12}  ERROR: {e}", bench.name);
                continue;
            }
        };

        let t_forks = Instant::now();
        let hidden_forks = ws.compute_hidden_forks(bench.revset).unwrap_or_default();
        let forks_ms = t_forks.elapsed().as_millis();

        let t_page = Instant::now();
        let state = queries::QueryState::new(50);
        let mut qs = queries::QuerySession::new(&ws, &*revset, state, hidden_forks);
        let page = qs.get_page()?;
        let page_ms = t_page.elapsed().as_millis();

        let total_ms = t_total.elapsed().as_millis();
        eprintln!(
            "{:<12} {:>9}ms {:>9}ms {:>9}ms {:>9}ms  {:<6}",
            bench.name, eval_ms, forks_ms, page_ms, total_ms, page.rows.len()
        );
    }

    Ok(())
}
