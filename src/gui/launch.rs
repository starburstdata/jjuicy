//! hand-off to the os terminal

use std::path::Path;
use std::process::Command;

use anyhow::{Result, anyhow};

/// open a terminal window with `dir` as its working directory
pub fn open_terminal(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Err(anyhow!("not a directory: {}", dir.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(dir)
            .spawn()?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        // `start` detaches the console so it outlives us
        Command::new("cmd")
            .args(["/C", "start", "", "cmd"])
            .current_dir(dir)
            .spawn()?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut candidates = vec![];
        if let Ok(term) = std::env::var("TERMINAL") {
            candidates.push(term);
        }
        candidates.extend(
            [
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "alacritty",
                "kitty",
                "xterm",
            ]
            .map(String::from),
        );
        for candidate in candidates {
            if Command::new(&candidate).current_dir(dir).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(anyhow!("no terminal emulator found; set $TERMINAL"))
    }
}
