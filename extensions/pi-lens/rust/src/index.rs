//! Project index: Parallel function indexing with state matrices
//!
//! The index is built once per project and persisted to
//! `{project_root}/.pi-lens/rust-index.json` so that subsequent
//! `Similarity` commands can load it without re-parsing all files.

use std::fs;
use std::path::Path;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::similarity::build_state_matrix;
use crate::{cache, FunctionEntry, IndexData, SimilarityMatch};

// ---------------------------------------------------------------------------
// On-disk format
// ---------------------------------------------------------------------------

/// Versioned index stored on disk.
#[derive(Serialize, Deserialize)]
pub struct CachedIndex {
    pub version: u32,
    pub project_root: String,
    pub functions: Vec<CachedFunctionEntry>,
}

impl CachedIndex {
    /// Bump this when the serialization format changes incompatibly.
    pub const CURRENT_VERSION: u32 = 1;
}

/// One function entry with its state matrix serialized as a 2-D Vec.
#[derive(Serialize, Deserialize)]
pub struct CachedFunctionEntry {
    pub entry: FunctionEntry,
    /// Row-major matrix: `matrix_rows[row][col]`; always NUM_SYNTAX × NUM_STATES.
    pub matrix_rows: Vec<Vec<u8>>,
}

impl CachedFunctionEntry {
    fn from_function_info(info: &FunctionInfo) -> Self {
        let matrix_rows = info
            .matrix
            .rows()
            .into_iter()
            .map(|row| row.to_vec())
            .collect();
        CachedFunctionEntry {
            entry: info.entry.clone(),
            matrix_rows,
        }
    }

    /// Reconstruct an `Array2<u8>` from the stored rows.
    pub fn to_matrix(&self) -> ndarray::Array2<u8> {
        let nrows = self.matrix_rows.len();
        let ncols = self.matrix_rows.first().map(|r| r.len()).unwrap_or(0);
        if nrows == 0 || ncols == 0 {
            return ndarray::Array2::zeros((57, 72));
        }
        let flat: Vec<u8> = self.matrix_rows.iter().flatten().cloned().collect();
        ndarray::Array2::from_shape_vec((nrows, ncols), flat)
            .unwrap_or_else(|_| ndarray::Array2::zeros((57, 72)))
    }
}

// ---------------------------------------------------------------------------
// In-memory representation (only alive during a single process invocation)
// ---------------------------------------------------------------------------

/// Function metadata with its precomputed state matrix.
#[derive(Clone)]
pub struct FunctionInfo {
    pub entry: FunctionEntry,
    pub matrix: ndarray::Array2<u8>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build a project index from a list of relative file paths.
///
/// Saves the result to `{project_root}/.pi-lens/rust-index.json` so that
/// subsequent `find_similar_to` calls in *separate* process invocations can
/// load it without rebuilding.
pub fn build_project_index(project_root: &str, files: &[String]) -> anyhow::Result<IndexData> {
    // Parse all TypeScript/JavaScript files in parallel.
    let results: Vec<FunctionInfo> = files
        .par_iter()
        .filter(|f| {
            f.ends_with(".ts")
                || f.ends_with(".tsx")
                || f.ends_with(".js")
                || f.ends_with(".jsx")
        })
        .flat_map(|file_path| {
            let full_path = Path::new(project_root).join(file_path);
            extract_functions(&full_path, file_path).unwrap_or_default()
        })
        .collect();

    let function_entries: Vec<FunctionEntry> = results.iter().map(|r| r.entry.clone()).collect();
    let entry_count = function_entries.len();

    // Persist to disk so `find_similar_to` can read it later.
    let cached = CachedIndex {
        version: CachedIndex::CURRENT_VERSION,
        project_root: project_root.to_string(),
        functions: results.iter().map(CachedFunctionEntry::from_function_info).collect(),
    };
    if let Err(e) = cache::save_index(project_root, &cached) {
        eprintln!("[pi-lens-core] Warning: could not save index cache: {}", e);
    }

    Ok(IndexData {
        entry_count,
        functions: function_entries,
    })
}

/// Find functions in the index that are similar to any function defined in
/// `file_path`.
///
/// `file_path` may be absolute or relative; it is normalised before lookup.
/// Requires `build_project_index` to have been called at least once
/// (it persists the index to disk).
pub fn find_similar_to(project_root: &str, file_path: &str, threshold: f32) -> Vec<SimilarityMatch> {
    let cached = match cache::load_index(project_root) {
        Some(c) => c,
        None => return vec![],
    };

    // Normalise to a forward-slash relative path for consistent matching.
    let target_rel = normalize_path(project_root, file_path);

    // Reconstruct all matrices (only deserialise once).
    let all: Vec<(FunctionEntry, ndarray::Array2<u8>)> = cached
        .functions
        .iter()
        .map(|cf| (cf.entry.clone(), cf.to_matrix()))
        .collect();

    // Targets = every function whose file matches the requested path.
    let targets: Vec<&(FunctionEntry, ndarray::Array2<u8>)> = all
        .iter()
        .filter(|(e, _)| normalize_path(project_root, &e.file_path) == target_rel)
        .collect();

    if targets.is_empty() {
        return vec![];
    }

    let mut matches = Vec::new();

    for (target_entry, target_matrix) in &targets {
        for (other_entry, other_matrix) in &all {
            // Skip self-matches.
            if other_entry.id == target_entry.id {
                continue;
            }

            let sim = crate::similarity::calculate_similarity(target_matrix, other_matrix);
            if sim >= threshold {
                matches.push(SimilarityMatch {
                    source_id: target_entry.id.clone(),
                    target_id: other_entry.id.clone(),
                    similarity: sim,
                });
            }
        }
    }

    // Highest similarity first.
    matches.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    matches
}

// ---------------------------------------------------------------------------
// File parsing helpers
// ---------------------------------------------------------------------------

fn extract_functions(full_path: &Path, relative_path: &str) -> anyhow::Result<Vec<FunctionInfo>> {
    let source = fs::read_to_string(full_path)?;

    let mut parser = tree_sitter::Parser::new();
    let language = tree_sitter_typescript::language_typescript();
    parser
        .set_language(&language)
        .map_err(|_| anyhow::anyhow!("Failed to load TypeScript grammar"))?;

    let tree = match parser.parse(&source, None) {
        Some(t) => t,
        None => return Ok(vec![]),
    };

    let mut results = Vec::new();
    collect_functions(&tree.root_node(), &source, relative_path, &mut results);
    Ok(results)
}

/// Recursively descend the AST to collect function nodes.
/// Transparent wrappers like `export_statement` are traversed without
/// emitting an entry; function nodes stop the descent (no nested tracking).
fn collect_functions(
    node: &tree_sitter::Node,
    source: &str,
    relative_path: &str,
    results: &mut Vec<FunctionInfo>,
) {
    match node.kind() {
        "function_declaration" | "function" | "method_definition" => {
            if let Some((name, line, signature)) = extract_function_info(node, source) {
                let func_source = &source[node.byte_range()];
                let matrix = build_state_matrix(func_source);
                results.push(FunctionInfo {
                    entry: FunctionEntry {
                        id: format!("{}::{}@{}", relative_path, name, line),
                        file_path: relative_path.to_string(),
                        name,
                        line,
                        signature,
                        matrix_hash: format!(
                            "{:x}",
                            matrix.iter().map(|&v| v as u64).sum::<u64>()
                        ),
                    },
                    matrix,
                });
                // Don't recurse further — nested functions tracked separately.
            }
            return;
        }
        // Transparent wrappers: walk into them.
        "export_statement"
        | "ambient_declaration"
        | "class_declaration"
        | "class_body"
        | "statement_block"
        | "program" => {}
        // Skip everything else (literals, identifiers, expressions, …).
        _ => return,
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_functions(&child, source, relative_path, results);
    }
}

fn extract_function_info(
    node: &tree_sitter::Node,
    source: &str,
) -> Option<(String, usize, String)> {
    let line = node.start_position().row + 1; // 1-based

    // Name comes from the first `identifier` child.
    let mut cursor = node.walk();
    let name = node
        .children(&mut cursor)
        .find(|c| c.kind() == "identifier")
        .and_then(|c| c.utf8_text(source.as_bytes()).ok())
        .map(|s| s.to_string())?;

    // Signature = everything before the body block.
    let signature = if let Some(body) = node.child_by_field_name("body") {
        source[node.start_byte()..body.start_byte()]
            .trim()
            .to_string()
    } else {
        format!("function {}", name)
    };

    Some((name, line, signature))
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/// Strip `project_root` prefix (if present) and normalise separators to `/`.
fn normalize_path(project_root: &str, file_path: &str) -> String {
    let stripped = if file_path.starts_with(project_root) {
        &file_path[project_root.len()..]
    } else {
        file_path
    };
    stripped
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_extract_functions_simple() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.ts");
        let source = r#"
function add(a: number, b: number): number {
    return a + b;
}

function subtract(x: number, y: number): number {
    return x - y;
}
"#;
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(source.as_bytes()).unwrap();

        let results = extract_functions(&file_path, "test.ts").unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].entry.name, "add");
        assert_eq!(results[1].entry.name, "subtract");
    }

    #[test]
    fn test_build_index() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        fs::write(
            root.join("main.ts"),
            "function main() { console.log('Hello'); }\n",
        )
        .unwrap();
        fs::write(
            root.join("lib.ts"),
            "export function helper(): number { return 42; }\n",
        )
        .unwrap();

        let files = vec!["main.ts".to_string(), "lib.ts".to_string()];
        let index = build_project_index(root.to_str().unwrap(), &files).unwrap();

        assert_eq!(index.entry_count, 2);
        assert_eq!(index.functions.len(), 2);
    }

    #[test]
    fn test_index_persisted_to_disk() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        fs::write(
            root.join("utils.ts"),
            "export function formatDate(d: Date): string { return d.toISOString(); }\n",
        )
        .unwrap();

        build_project_index(root.to_str().unwrap(), &["utils.ts".to_string()]).unwrap();

        // Cache file must exist after building.
        let cache_path = cache::get_index_cache_path(root.to_str().unwrap());
        assert!(cache_path.exists(), "rust-index.json should have been created");

        let loaded = cache::load_index(root.to_str().unwrap()).unwrap();
        assert_eq!(loaded.functions.len(), 1);
        assert_eq!(loaded.functions[0].entry.name, "formatDate");
    }

    #[test]
    fn test_find_similar_to_reads_disk() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let root_str = root.to_str().unwrap();

        // Two structurally similar functions in different files.
        fs::write(
            root.join("a.ts"),
            "function sum(a: number, b: number): number { return a + b; }\n",
        )
        .unwrap();
        fs::write(
            root.join("b.ts"),
            "function add(x: number, y: number): number { return x + y; }\n",
        )
        .unwrap();

        build_project_index(root_str, &["a.ts".to_string(), "b.ts".to_string()]).unwrap();

        let matches = find_similar_to(root_str, "a.ts", 0.5);
        // Should find b.ts::add as similar to a.ts::sum.
        assert!(
            !matches.is_empty(),
            "expected at least one similarity match across files"
        );
    }

    #[test]
    fn test_normalize_path_strips_root() {
        assert_eq!(
            normalize_path("/proj", "/proj/src/utils.ts"),
            "src/utils.ts"
        );
        assert_eq!(normalize_path("/proj", "src/utils.ts"), "src/utils.ts");
    }
}
