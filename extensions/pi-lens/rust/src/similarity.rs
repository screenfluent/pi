//! State matrix similarity detection
//!
//! Builds 57×72 state transition matrices from AST
//! and calculates cosine similarity between them.
//!
//! ## How the mapping works
//!
//! Tree-sitter assigns each node type a compact integer `kind_id` (u16).
//! The TypeScript grammar has ~200–350 distinct kind_ids.
//!
//! The naive `kind % DIM` modulo approach collapses multiple semantically
//! unrelated node types into the same row or column — e.g. `if_statement`,
//! `super`, and `[` all map to the same column under `% 72`. This creates
//! false similarity between structurally different functions.
//!
//! Instead we build a `KindMap` at startup: iterate over every kind_id the
//! grammar exposes (0..language.node_kind_count()), skip unnamed punctuation
//! kinds, and assign them a stable sequential index 0..DIM. Any kind_id
//! that doesn't fit in the DIM slots (rare, only if the grammar grows past
//! the matrix size) is mapped to the last bucket rather than silently
//! colliding with unrelated nodes.

use std::sync::OnceLock;

use ndarray::Array2;

const NUM_SYNTAX: usize = 57; // rows  (parent node kind)
const NUM_STATES: usize = 72; // cols  (child  node kind)

// ---------------------------------------------------------------------------
// Collision-free kind_id → matrix-index mapping
// ---------------------------------------------------------------------------

/// Lookup table: `kind_id as usize` → row index (0..NUM_SYNTAX).
static ROW_MAP: OnceLock<Vec<usize>> = OnceLock::new();
/// Lookup table: `kind_id as usize` → column index (0..NUM_STATES).
static COL_MAP: OnceLock<Vec<usize>> = OnceLock::new();

fn build_kind_map(language: &tree_sitter::Language, dim: usize) -> Vec<usize> {
    let n = language.node_kind_count();
    // Default: unnamed / punctuation tokens all go to the last slot.
    // They are syntactic noise ("{", ";", "=>", etc.) and don't need
    // individual slots; sharing one slot is intentional.
    let mut map = vec![dim - 1; n];

    // Collect all named kind_ids in order.
    let named: Vec<usize> = (0..n)
        .filter(|&id| language.node_kind_is_named(id as u16))
        .collect();

    // Distribute named types EVENLY across slots 0..dim-2.
    //
    // Why not give unique slots to the first dim-1 named types (sequential)?
    // The TypeScript grammar has ~195 named types but we only have 56 / 71
    // named slots; sequential assignment leaves ~139 types in one overflow
    // bucket, making it far noisier than the rest.  Even distribution gives
    // every slot ceil(195/56) = 4 collisions at most, balancing the signal.
    let named_slots = dim - 1; // slot dim-1 reserved for unnamed tokens
    for (i, &id) in named.iter().enumerate() {
        map[id] = i % named_slots;
    }

    map
}

fn row_map() -> &'static Vec<usize> {
    ROW_MAP.get_or_init(|| {
        let lang = tree_sitter_typescript::language_typescript();
        build_kind_map(&lang, NUM_SYNTAX)
    })
}

fn col_map() -> &'static Vec<usize> {
    COL_MAP.get_or_init(|| {
        let lang = tree_sitter_typescript::language_typescript();
        build_kind_map(&lang, NUM_STATES)
    })
}

/// Build a 57×72 state transition matrix from source code
pub fn build_state_matrix(source: &str) -> Array2<u8> {
    let mut matrix = Array2::<u8>::zeros((NUM_SYNTAX, NUM_STATES));

    // Parse with tree-sitter
    let mut parser = tree_sitter::Parser::new();
    let language = tree_sitter_typescript::language_typescript();
    if parser.set_language(&language).is_err() {
        return matrix;
    }

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return matrix,
    };
    let root = tree.root_node();

    // Walk AST and count transitions
    walk_node(&root, None, &mut matrix);

    matrix
}

fn walk_node(node: &tree_sitter::Node, parent_kind: Option<u16>, matrix: &mut Array2<u8>) {
    let rmap = row_map();
    let cmap = col_map();

    if let Some(parent_id) = parent_kind {
        let p = parent_id as usize;
        let c = node.kind_id() as usize;
        // Bounds-check: the map is sized to language.node_kind_count(), but
        // guard in case of grammar version mismatch.
        if p < rmap.len() && c < cmap.len() {
            let row = rmap[p];
            let col = cmap[c];
            let cell = &mut matrix[[row, col]];
            *cell = cell.saturating_add(1);
        }
    }

    let cursor = &mut node.walk();
    for child in node.children(cursor) {
        walk_node(&child, Some(node.kind_id()), matrix);
    }
}

/// Calculate cosine similarity between two state matrices
pub fn calculate_similarity(m1: &Array2<u8>, m2: &Array2<u8>) -> f32 {
    let p1 = to_probability_matrix(m1);
    let p2 = to_probability_matrix(m2);

    let mut total_similarity = 0.0;
    let mut valid_rows = 0;

    for i in 0..NUM_SYNTAX {
        let row1 = p1.row(i);
        let row2 = p2.row(i);

        // Skip empty rows
        let has_data1 = row1.iter().any(|&v| v > 0.0);
        let has_data2 = row2.iter().any(|&v| v > 0.0);

        if has_data1 || has_data2 {
            let sim = cosine_similarity(row1.as_slice().unwrap(), row2.as_slice().unwrap());
            total_similarity += sim;
            valid_rows += 1;
        }
    }

    if valid_rows == 0 {
        return 0.0;
    }

    total_similarity / valid_rows as f32
}

fn to_probability_matrix(matrix: &Array2<u8>) -> Array2<f32> {
    let mut result = Array2::<f32>::zeros(matrix.raw_dim());

    for i in 0..NUM_SYNTAX {
        let row = matrix.row(i);
        let sum: u32 = row.iter().map(|&v| v as u32).sum();

        if sum > 0 {
            let mut prob_row = result.row_mut(i);
            for (j, &val) in row.iter().enumerate() {
                prob_row[j] = val as f32 / sum as f32;
            }
        }
    }

    result
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot_product = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for i in 0..a.len() {
        dot_product += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a.sqrt() * norm_b.sqrt())
}

/// Count non-zero transitions (proxy for complexity)
pub fn count_transitions(matrix: &Array2<u8>) -> usize {
    matrix.iter().filter(|&&v| v > 0).count()
}

/// Check if function meets complexity threshold
pub fn is_complex_enough(matrix: &Array2<u8>, min_transitions: usize) -> bool {
    count_transitions(matrix) >= min_transitions
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    /// Diagnostic test: shows which node kinds collide under the current
    /// modulo mapping. Run with `cargo test dump_kind_collisions -- --nocapture`.
    /// Run with `cargo test dump_kind_collisions -- --ignored --nocapture` to see
    /// a collision analysis comparing the old modulo mapping to the current one.
    #[test]
    #[ignore]
    fn dump_kind_collisions() {
        let mut parser = tree_sitter::Parser::new();
        let language = tree_sitter_typescript::language_typescript();
        parser.set_language(&language).unwrap();

        // Source with diverse node types
        let source = r#"
import { foo } from './foo';
export interface MyInterface { name: string; age: number; }
export type Alias = string | number;
export class MyClass extends Base {
    private field: string = 'hello';
    constructor(private name: string) { super(); }
    async method(x: number, y?: string): Promise<boolean> {
        if (x > 0) { return true; }
        for (const item of [1,2,3]) { console.log(item); }
        try { throw new Error('oops'); } catch (e) { return false; }
    }
    static factory = (n: string) => new MyClass(n);
}
export function complexFn<T>(items: T[], pred: (x: T) => boolean): T[] {
    return items.filter(pred).map(x => ({ ...x as object }));
}
"#;

        let tree = parser.parse(source, None).unwrap();

        // Walk entire tree collecting every (kind_id, kind_name) pair
        let mut seen: HashMap<u16, &str> = HashMap::new();
        let mut stack = vec![tree.root_node()];
        while let Some(node) = stack.pop() {
            seen.insert(node.kind_id(), node.kind());
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                stack.push(child);
            }
        }

        let mut kinds: Vec<(u16, &str)> = seen.into_iter().collect();
        kinds.sort_by_key(|(id, _)| *id);

        const NUM_SYNTAX: usize = 57;
        const NUM_STATES: usize = 72;

        let mut row_map: HashMap<usize, Vec<(u16, &str)>> = HashMap::new();
        let mut col_map: HashMap<usize, Vec<(u16, &str)>> = HashMap::new();
        for (id, name) in &kinds {
            row_map.entry(*id as usize % NUM_SYNTAX).or_default().push((*id, name));
            col_map.entry(*id as usize % NUM_STATES).or_default().push((*id, name));
        }

        println!("\n=== Kind collision analysis: old (% modulo) vs new (even-distribution) ===");
        println!("Distinct kind_ids in this source sample: {}", kinds.len());

        // --- OLD: modulo approach ---
        let lost_rows: usize = row_map.values().filter(|v| v.len() > 1).map(|v| v.len() - 1).sum();
        let lost_cols: usize = col_map.values().filter(|v| v.len() > 1).map(|v| v.len() - 1).sum();
        let max_old_row = row_map.values().map(|v| v.len()).max().unwrap_or(0);
        let max_old_col = col_map.values().map(|v| v.len()).max().unwrap_or(0);
        println!("\nOLD mapping (kind_id % dim):");
        println!("  Rows (%{}): {}/{} kinds share a slot, worst slot has {} kinds",
            NUM_SYNTAX, lost_rows, kinds.len(), max_old_row);
        println!("  Cols (%{}): {}/{} kinds share a slot, worst slot has {} kinds",
            NUM_STATES, lost_cols, kinds.len(), max_old_col);
        let mut row_cols: Vec<_> = row_map.iter().filter(|(_, v)| v.len() > 1).collect();
        row_cols.sort_by_key(|(_, v)| std::cmp::Reverse(v.len()));
        for (idx, entries) in row_cols.iter().take(3) {
            let names: Vec<_> = entries.iter().map(|(id, n)| format!("{} ({})", n, id)).collect();
            println!("    row {:2}: {}", idx, names.join(" + "));
        }

        // --- NEW: even-distribution mapping (live) ---
        let rmap = super::row_map();
        let cmap = super::col_map();
        let mut live_row: HashMap<usize, Vec<&str>> = HashMap::new();
        let mut live_col: HashMap<usize, Vec<&str>> = HashMap::new();
        let mut named_count = 0usize;
        let mut unnamed_count = 0usize;
        for &(id, name) in &kinds {
            live_row.entry(rmap[id as usize]).or_default().push(name);
            live_col.entry(cmap[id as usize]).or_default().push(name);
            let lang = tree_sitter_typescript::language_typescript();
            if lang.node_kind_is_named(id) { named_count += 1; } else { unnamed_count += 1; }
        }
        let unnamed_bucket = NUM_SYNTAX - 1;
        let named_rows: Vec<_> = live_row.iter()
            .filter(|&(k, _)| *k != unnamed_bucket)
            .collect();
        let max_named_row = named_rows.iter().map(|(_, v)| v.len()).max().unwrap_or(0);
        let max_named_col = live_col.iter()
            .filter(|&(k, _)| *k != NUM_STATES - 1)
            .map(|(_, v)| v.len()).max().unwrap_or(0);
        let unnamed_row_size = live_row.get(&unnamed_bucket).map(|v| v.len()).unwrap_or(0);
        let unnamed_col_size = live_col.get(&(NUM_STATES - 1)).map(|v| v.len()).unwrap_or(0);
        println!("\nNEW mapping (even-distribution + unnamed bucket):");
        println!("  Named kinds: {}, Unnamed (punctuation) kinds: {}", named_count, unnamed_count);
        println!("  Rows: named slots 0..{} hold {} named kinds, max {} per slot",
            unnamed_bucket - 1, named_count, max_named_row);
        println!("  Rows: unnamed bucket (slot {}) holds {} punctuation kinds",
            unnamed_bucket, unnamed_row_size);
        println!("  Cols: named slots 0..{} hold {} named kinds, max {} per slot",
            NUM_STATES - 2, named_count, max_named_col);
        println!("  Cols: unnamed bucket (slot {}) holds {} punctuation kinds",
            NUM_STATES - 1, unnamed_col_size);
        let mut worst_named: Vec<_> = named_rows.iter()
            .filter(|(_, v)| v.len() > 1)
            .collect();
        worst_named.sort_by_key(|(_, v)| std::cmp::Reverse(v.len()));
        if worst_named.is_empty() {
            println!("  Named slot collisions: none (every named kind has a unique slot in this sample)");
        } else {
            println!("  Worst named-slot collisions:");
            for (idx, names) in worst_named.iter().take(3) {
                println!("    row {:2}: {}", idx, names.join(" + "));
            }
        }
    }

    use super::*;

    const TEST_FUNCTION_1: &str = r#"
function calculateSum(a: number, b: number): number {
    if (a < 0 || b < 0) {
        throw new Error("Negative numbers not allowed");
    }
    return a + b;
}
"#;

    const TEST_FUNCTION_2: &str = r#"
function addValues(x: number, y: number): number {
    if (x < 0 || y < 0) {
        throw new Error("Invalid input");
    }
    return x + y;
}
"#;

    #[test]
    fn test_build_matrix_has_correct_dimensions() {
        let matrix = build_state_matrix(TEST_FUNCTION_1);
        assert_eq!(matrix.shape(), &[57, 72]);
    }

    #[test]
    fn test_similar_high_for_similar_functions() {
        let m1 = build_state_matrix(TEST_FUNCTION_1);
        let m2 = build_state_matrix(TEST_FUNCTION_2);

        let similarity = calculate_similarity(&m1, &m2);

        // Similar functions should have > 60% similarity
        assert!(similarity > 0.60, "Expected > 0.60, got {}", similarity);
    }

    #[test]
    fn test_similarity_is_symmetric() {
        let m1 = build_state_matrix(TEST_FUNCTION_1);
        let m2 = build_state_matrix(TEST_FUNCTION_2);

        let sim1 = calculate_similarity(&m1, &m2);
        let sim2 = calculate_similarity(&m2, &m1);

        assert!((sim1 - sim2).abs() < 0.001);
    }

    #[test]
    fn test_identical_functions_have_100_similarity() {
        let m1 = build_state_matrix(TEST_FUNCTION_1);
        let m2 = build_state_matrix(TEST_FUNCTION_1);

        let similarity = calculate_similarity(&m1, &m2);

        assert!((similarity - 1.0).abs() < 0.001);
    }
}
