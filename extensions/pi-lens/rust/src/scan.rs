//! Fast file system scanning with gitignore support

use crate::FileEntry;
use ignore::DirEntry;
use ignore::WalkBuilder;
use std::path::Path;

/// Scan project for files matching extensions
/// Uses ripgrep's `ignore` crate for .gitignore support
pub fn scan_project(root: &str, extensions: &[String]) -> anyhow::Result<Vec<FileEntry>> {
    let root_path = Path::new(root);

    let walker = WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .build();

    let mut files: Vec<FileEntry> = Vec::new();

    for entry in walker {
        if let Ok(entry) = entry {
            if let Some(file_entry) = process_entry(entry, extensions) {
                files.push(file_entry);
            }
        }
    }

    // Sort for deterministic output
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn process_entry(entry: DirEntry, extensions: &[String]) -> Option<FileEntry> {
    let path = entry.path();

    // Check if it's a file
    let file_type = entry.file_type()?;
    if !file_type.is_file() {
        return None;
    }

    let ext = path.extension()?.to_str()?;
    let ext_with_dot = format!(".{}", ext);

    if !extensions.contains(&ext.to_string()) && !extensions.contains(&ext_with_dot) {
        return None;
    }

    let metadata = entry.metadata().ok()?;

    Some(FileEntry {
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs(),
    })
}

/// Fast parallel file scanner for bulk operations
pub fn scan_parallel(root: &str, extensions: &[String]) -> anyhow::Result<Vec<FileEntry>> {
    // Currently same as scan_project - parallel processing handled by ignore crate
    scan_project(root, extensions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_scan_finds_typescript_files() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        // Create test files
        fs::write(root.join("test.ts"), "// typescript").unwrap();
        fs::write(root.join("test.js"), "// javascript").unwrap();
        fs::write(root.join("readme.md"), "# readme").unwrap();

        // Create subdirectory
        let sub = root.join("src");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("main.ts"), "// main").unwrap();

        let files = scan_project(root.to_str().unwrap(), &[".ts".to_string()]).unwrap();

        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|f| f.path.ends_with("test.ts")));
        assert!(files.iter().any(|f| f.path.ends_with("main.ts")));
    }

    #[test]
    fn test_scan_respects_hidden_dirs() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        // Create files
        fs::write(root.join("visible.ts"), "").unwrap();
        fs::create_dir(root.join(".hidden")).unwrap();
        fs::write(root.join(".hidden/secret.ts"), "").unwrap();

        let files = scan_project(root.to_str().unwrap(), &[".ts".to_string()]).unwrap();

        // Should find visible.ts but not .hidden/secret.ts
        assert!(files.iter().any(|f| f.path.ends_with("visible.ts")));
        assert!(!files.iter().any(|f| f.path.contains(".hidden")));
    }
}
