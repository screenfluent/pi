//! pi-lens-core: High-performance analysis engine
//!
//! Provides:
//! - Fast file system scanning with gitignore support
//! - State matrix similarity detection
//! - Parallel project indexing
//! - Tree-sitter query execution

#![allow(missing_docs)] // Temporarily allow during development

pub mod cache;
pub mod index;
pub mod scan;
pub mod similarity;

use serde::{Deserialize, Serialize};

/// Main analysis request from TypeScript
#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeRequest {
    pub command: Command,
    pub project_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Command {
    Scan {
        extensions: Vec<String>,
    },
    BuildIndex {
        files: Vec<String>,
    },
    Similarity {
        file_path: String,
        threshold: f32,
    },
    Query {
        language: String,
        query: String,
        file_path: String,
    },
}

/// Analysis response to TypeScript
#[derive(Debug, Clone, Serialize)]
pub struct AnalyzeResponse {
    pub success: bool,
    pub data: ResponseData,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseData {
    Files(Vec<FileEntry>),
    Index(IndexData),
    Similarities(Vec<SimilarityMatch>),
    QueryResults(Vec<QueryMatch>),
    Empty,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexData {
    pub entry_count: usize,
    pub functions: Vec<FunctionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionEntry {
    pub id: String,
    pub file_path: String,
    pub name: String,
    pub line: usize,
    pub signature: String,
    pub matrix_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SimilarityMatch {
    pub source_id: String,
    pub target_id: String,
    pub similarity: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryMatch {
    pub line: usize,
    pub column: usize,
    pub text: String,
}

/// Analyze a request and return structured response
pub fn analyze(request: &AnalyzeRequest) -> AnalyzeResponse {
    match &request.command {
        Command::Scan { extensions } => {
            match scan::scan_project(&request.project_root, extensions) {
                Ok(files) => AnalyzeResponse {
                    success: true,
                    data: ResponseData::Files(files),
                    error: None,
                },
                Err(e) => AnalyzeResponse {
                    success: false,
                    data: ResponseData::Empty,
                    error: Some(format!("{}", e)),
                },
            }
        }
        Command::BuildIndex { files } => {
            match index::build_project_index(&request.project_root, files) {
                Ok(index_data) => AnalyzeResponse {
                    success: true,
                    data: ResponseData::Index(index_data),
                    error: None,
                },
                Err(e) => AnalyzeResponse {
                    success: false,
                    data: ResponseData::Empty,
                    error: Some(format!("{}", e)),
                },
            }
        }
        Command::Similarity { file_path, threshold } => {
            let matches = index::find_similar_to(&request.project_root, file_path, *threshold);
            if matches.is_empty() {
                AnalyzeResponse {
                    success: true,
                    data: ResponseData::Similarities(vec![]),
                    error: None,
                }
            } else {
                AnalyzeResponse {
                    success: true,
                    data: ResponseData::Similarities(matches),
                    error: None,
                }
            }
        }
        Command::Query { language, query, file_path } => {
            // Tree-sitter query execution
            match run_query(language, query, file_path) {
                Ok(results) => AnalyzeResponse {
                    success: true,
                    data: ResponseData::QueryResults(results),
                    error: None,
                },
                Err(e) => AnalyzeResponse {
                    success: false,
                    data: ResponseData::Empty,
                    error: Some(format!("{}", e)),
                },
            }
        }
    }
}

/// Run a tree-sitter query on a file
fn run_query(
    language: &str,
    query_str: &str,
    file_path: &str,
) -> anyhow::Result<Vec<QueryMatch>> {
    use tree_sitter::{Parser, Query, QueryCursor};
    
    // Read file content
    let content = std::fs::read_to_string(file_path)?;
    
    // Create parser and set language
    let mut parser = Parser::new();
    let language = match language {
        "typescript" => tree_sitter_typescript::language_typescript(),
        "rust" => tree_sitter_rust::language(),
        _ => return Err(anyhow::anyhow!("Unsupported language: {}", language)),
    };
    parser.set_language(&language)?;
    
    // Parse the file
    let tree = parser.parse(&content, None)
        .ok_or_else(|| anyhow::anyhow!("Failed to parse file"))?;
    
    // Create and execute query
    let query = Query::new(&language, query_str)?;
    let root = tree.root_node();
    let mut cursor = QueryCursor::new();
    let matches = cursor.matches(&query, root, content.as_bytes());
    
    // Collect results
    let mut results = Vec::new();
    for m in matches {
        for capture in m.captures {
            let node = capture.node;
            results.push(QueryMatch {
                line: node.start_position().row + 1,
                column: node.start_position().column + 1,
                text: node.utf8_text(content.as_bytes())?.to_string(),
            });
        }
    }
    
    Ok(results)
}
