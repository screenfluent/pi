/**
 * Runner definitions for pi-lens dispatch system
 */

import { registerRunner } from "../dispatcher.ts";
import architectRunner from "./architect.ts";
import astGrepNapiRunner from "./ast-grep-napi.ts";
import biomeRunner from "./biome.ts";
import biomeCheckJsonRunner from "./biome-check.ts";
import eslintRunner from "./eslint.ts";
import goVetRunner from "./go-vet.ts";
import golangciRunner from "./golangci-lint.ts";
import lspRunner from "./lsp.ts";
import oxlintRunner from "./oxlint.ts";
import pyrightRunner from "./pyright.ts";
import pythonSlopRunner from "./python-slop.ts";
import rubocopRunner from "./rubocop.ts";
import ruffRunner from "./ruff.ts";
import rustClippyRunner from "./rust-clippy.ts";
import shellcheckRunner from "./shellcheck.ts";
import sqlfluffRunner from "./sqlfluff.ts";
// Import similarity runner
import similarityRunner from "./similarity.ts";
import spellcheckRunner from "./spellcheck.ts";
import yamllintRunner from "./yamllint.ts";
// Import tree-sitter runner
import treeSitterRunner from "./tree-sitter.ts";
import tsLspRunner from "./ts-lsp.ts";
import typeSafetyRunner from "./type-safety.ts";

// Register all runners (ordered by priority)
// Unified LSP runner for all languages (TypeScript, Python, Go, Rust, etc.) - priority 4
registerRunner(lspRunner); // Unified LSP type-checking for all languages (priority 4)
registerRunner(tsLspRunner); // TypeScript type-checking (priority 5) - fallback when --lens-lsp disabled
registerRunner(pyrightRunner); // Python type-checking (priority 5) - fallback when --lens-lsp disabled
registerRunner(biomeCheckJsonRunner); // Biome check with JSON output for diagnostic capture (priority 9)
// DISABLED in post-write dispatch - ast-grep-napi can crash. Enabled via /lens-booboo plan only.
registerRunner(astGrepNapiRunner); // TS/JS structural analysis via NAPI (priority 15, post-write disabled)
registerRunner(biomeRunner); // Biome formatting/linting (priority 10)
registerRunner(treeSitterRunner); // Tree-sitter structural analysis (priority 14)
registerRunner(ruffRunner); // Python linting (priority 10)
registerRunner(pythonSlopRunner); // Python slop via CLI (priority 25)
registerRunner(typeSafetyRunner); // Type safety checks (priority 20)
registerRunner(shellcheckRunner); // Shell script linting (priority 20)
// DISABLED: registerRunner(astGrepRunner); // Replaced by ast-grep-napi for dispatch
// CLI ast-grep kept for ast_grep_search/ast_grep_replace tools only
registerRunner(similarityRunner); // Semantic reuse detection (priority 35)
registerRunner(architectRunner); // Architectural rules (priority 40)
registerRunner(eslintRunner); // ESLint (priority 12, jsts, config-gated)
registerRunner(golangciRunner); // golangci-lint (priority 20, go, config-gated)
registerRunner(rubocopRunner); // RuboCop lint (priority 10, ruby)
registerRunner(spellcheckRunner); // Spellcheck for markdown/docs (priority 30)
registerRunner(yamllintRunner); // YAML lint (priority 22)
registerRunner(sqlfluffRunner); // SQL lint (priority 24)
registerRunner(goVetRunner); // Go analysis (priority 50)
registerRunner(rustClippyRunner); // Rust analysis (priority 50)
