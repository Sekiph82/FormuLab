// Appends frontend diagnostics to <app-data>/debug.log so we can see what the
// webview experiences (connection attempts, SSE events, errors) in packaged builds.
//
// Phase 11 Session 5: bounded retention. Before this session `debug.log` grew
// forever — no cap, no rotation, unlike every other log this project keeps
// (`runs.rs`'s captured stdout/stderr is capped at `LOG_CAP` bytes per entry;
// this file had no equivalent). `MAX_DEBUG_LOG_BYTES` + a small rotation
// scheme (`debug.log` -> `debug.log.1` -> ... -> `debug.log.{MAX_ROTATED_FILES}`,
// oldest dropped) bounds total retention to roughly
// `MAX_DEBUG_LOG_BYTES * (MAX_ROTATED_FILES + 1)`.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEBUG_LOG_FILE: &str = "debug.log";
pub(crate) const MAX_DEBUG_LOG_BYTES: u64 = 2_000_000;
pub(crate) const MAX_ROTATED_FILES: u32 = 3;

fn rotated_path(dir: &Path, n: u32) -> PathBuf {
    dir.join(format!("{DEBUG_LOG_FILE}.{n}"))
}

/// Shifts `debug.log` -> `.1` -> `.2` -> ... , dropping whatever was at
/// `MAX_ROTATED_FILES`, only when the current file has reached the cap.
/// Best-effort: a rename failure (e.g. a concurrent reader) is not fatal —
/// the next write just keeps appending to the oversized file rather than
/// losing anything.
pub(crate) fn rotate_if_needed(dir: &Path, path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else { return };
    if meta.len() < MAX_DEBUG_LOG_BYTES {
        return;
    }
    let oldest = rotated_path(dir, MAX_ROTATED_FILES);
    let _ = std::fs::remove_file(&oldest);
    for i in (1..MAX_ROTATED_FILES).rev() {
        let from = rotated_path(dir, i);
        let to = rotated_path(dir, i + 1);
        if from.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
    let _ = std::fs::rename(path, rotated_path(dir, 1));
}

#[tauri::command]
pub fn log_debug(app: AppHandle, message: String) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(DEBUG_LOG_FILE);
    rotate_if_needed(&dir, &path);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{ts} {message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-debuglog-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rotate_if_needed_is_a_no_op_below_the_cap() {
        let dir = tmp("below-cap");
        let path = dir.join(DEBUG_LOG_FILE);
        std::fs::write(&path, b"small").unwrap();
        rotate_if_needed(&dir, &path);
        assert!(path.exists());
        assert!(!rotated_path(&dir, 1).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_if_needed_moves_the_current_file_to_dot_1_once_over_the_cap() {
        let dir = tmp("over-cap");
        let path = dir.join(DEBUG_LOG_FILE);
        std::fs::write(&path, vec![b'x'; MAX_DEBUG_LOG_BYTES as usize + 1]).unwrap();
        rotate_if_needed(&dir, &path);
        assert!(!path.exists());
        assert!(rotated_path(&dir, 1).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_if_needed_shifts_existing_rotated_files_up_and_drops_the_oldest() {
        let dir = tmp("shift-chain");
        let path = dir.join(DEBUG_LOG_FILE);
        std::fs::write(&path, vec![b'x'; MAX_DEBUG_LOG_BYTES as usize + 1]).unwrap();
        std::fs::write(rotated_path(&dir, 1), b"gen1").unwrap();
        std::fs::write(rotated_path(&dir, 2), b"gen2").unwrap();
        std::fs::write(rotated_path(&dir, 3), b"gen3-oldest").unwrap();

        rotate_if_needed(&dir, &path);

        assert_eq!(std::fs::read(rotated_path(&dir, 2)).unwrap(), b"gen1");
        assert_eq!(std::fs::read(rotated_path(&dir, 3)).unwrap(), b"gen2");
        // gen3-oldest was dropped, not shifted to a nonexistent .4
        assert!(!rotated_path(&dir, 4).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_is_bounded_to_the_current_file_plus_max_rotated_files() {
        let dir = tmp("bounded-total");
        let path = dir.join(DEBUG_LOG_FILE);
        // Simulate many rotations in a row.
        for _ in 0..10 {
            std::fs::write(&path, vec![b'x'; MAX_DEBUG_LOG_BYTES as usize + 1]).unwrap();
            rotate_if_needed(&dir, &path);
        }
        let mut count = 1u32; // the fresh (post-rotation, currently-absent-until-next-write) slot counts conceptually
        for i in 1..=MAX_ROTATED_FILES {
            if rotated_path(&dir, i).exists() {
                count += 1;
            }
        }
        assert!(count <= MAX_ROTATED_FILES + 1);
        assert!(!rotated_path(&dir, MAX_ROTATED_FILES + 1).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
