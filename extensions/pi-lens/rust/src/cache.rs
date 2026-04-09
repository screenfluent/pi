//! Cache utilities: xxHash fingerprints + disk index persistence

use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use xxhash_rust::xxh3::xxh3_64;

use crate::index::CachedIndex;

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/// Compute a fast xxHash-based cache key from file path + mtime + size.
/// Used to detect stale cache entries without re-reading file contents.
pub fn compute_file_hash(path: &Path, mtime: u64, size: u64) -> String {
    let input = format!("{}:{}:{}", path.display(), mtime, size);
    format!("{:016x}", xxh3_64(input.as_bytes()))
}

/// Compute a cache key for a list of file paths (e.g. for rules sets).
pub fn compute_rules_hash(files: &[String]) -> String {
    let input = files.join("|");
    format!("{:016x}", xxh3_64(input.as_bytes()))
}

// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

/// Path to the Rust similarity index for a project.
/// Stored alongside the TypeScript index in `.pi-lens/`.
pub fn get_index_cache_path(project_root: &str) -> PathBuf {
    Path::new(project_root)
        .join(".pi-lens")
        .join("rust-index.json")
}

/// Persist a `CachedIndex` to `{project_root}/.pi-lens/rust-index.json`.
/// Creates the `.pi-lens/` directory if it doesn't exist.
pub fn save_index(project_root: &str, index: &CachedIndex) -> anyhow::Result<()> {
    let cache_path = get_index_cache_path(project_root);

    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = std::fs::File::create(&cache_path)?;
    let writer = BufWriter::new(file);
    serde_json::to_writer(writer, index)?;

    Ok(())
}

/// Load a `CachedIndex` from disk, returning `None` if the file doesn't
/// exist, can't be read, or has an incompatible version.
pub fn load_index(project_root: &str) -> Option<CachedIndex> {
    let cache_path = get_index_cache_path(project_root);
    let file = std::fs::File::open(&cache_path).ok()?;
    let reader = BufReader::new(file);
    let index: CachedIndex = serde_json::from_reader(reader).ok()?;

    // Reject stale cache versions
    if index.version != CachedIndex::CURRENT_VERSION {
        return None;
    }

    Some(index)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_compute_file_hash_is_deterministic() {
        let path = Path::new("/some/file.ts");
        let h1 = compute_file_hash(path, 1234567890, 4096);
        let h2 = compute_file_hash(path, 1234567890, 4096);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 16); // 64-bit hex
    }

    #[test]
    fn test_compute_file_hash_changes_with_mtime() {
        let path = Path::new("/some/file.ts");
        let h1 = compute_file_hash(path, 100, 512);
        let h2 = compute_file_hash(path, 200, 512);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_save_and_load_index_roundtrip() {
        use crate::index::{CachedFunctionEntry, CachedIndex};
        use crate::FunctionEntry;

        let temp = TempDir::new().unwrap();
        let root = temp.path().to_str().unwrap();

        let index = CachedIndex {
            version: CachedIndex::CURRENT_VERSION,
            project_root: root.to_string(),
            functions: vec![CachedFunctionEntry {
                entry: FunctionEntry {
                    id: "src/lib.ts::foo@1".to_string(),
                    file_path: "src/lib.ts".to_string(),
                    name: "foo".to_string(),
                    line: 1,
                    signature: "()".to_string(),
                    matrix_hash: "deadbeef".to_string(),
                },
                matrix_rows: vec![vec![0u8; 72]; 57],
            }],
        };

        save_index(root, &index).unwrap();

        let loaded = load_index(root).unwrap();
        assert_eq!(loaded.functions.len(), 1);
        assert_eq!(loaded.functions[0].entry.name, "foo");
    }
}
