/**
 * Runner definitions for pi-lens dispatch system
 */

import { registerRunner } from "../dispatcher.ts";
import architectRunner from "./architect.ts";
// Import all runners
import astGrepNapiRunner from "./ast-grep-napi.ts";
import astGrepRunner from "./ast-grep.ts";
import biomeRunner from "./biome.ts";
import goVetRunner from "./go-vet.ts";
import oxlintRunner from "./oxlint.ts";
import pythonSlopRunner from "./python-slop.ts";
import pyrightRunner from "./pyright.ts";
import ruffRunner from "./ruff.ts";
import rustClippyRunner from "./rust-clippy.ts";
import shellcheckRunner from "./shellcheck.ts";
// Import similarity runner
import similarityRunner from "./similarity.ts";
import spellcheckRunner from "./spellcheck.ts";
import tsLspRunner from "./ts-lsp.ts";
import tsSlopRunner from "./ts-slop.ts";
import typeSafetyRunner from "./type-safety.ts";

// Register all runners (ordered by priority)
registerRunner(tsLspRunner); // TypeScript type-checking (priority 5)
registerRunner(pyrightRunner); // Python type-checking (priority 5)
registerRunner(astGrepNapiRunner); // TS/JS structural analysis via NAPI (priority 15)
registerRunner(biomeRunner); // Biome formatting/linting (priority 10)
registerRunner(oxlintRunner); // Oxlint fast JS/TS linter (priority 12)
registerRunner(ruffRunner); // Python linting (priority 10)
registerRunner(tsSlopRunner); // DISABLED - TypeScript slop via CLI (disabled, use NAPI)
registerRunner(pythonSlopRunner); // Python slop via CLI (priority 25)
registerRunner(typeSafetyRunner); // Type safety checks (priority 20)
registerRunner(shellcheckRunner); // Shell script linting (priority 20)
registerRunner(astGrepRunner); // Other languages via CLI (priority 30)
registerRunner(similarityRunner); // Semantic reuse detection (priority 35)
registerRunner(architectRunner); // Architectural rules (priority 40)
registerRunner(spellcheckRunner); // Spellcheck for markdown/docs (priority 30)
registerRunner(goVetRunner); // Go analysis (priority 50)
registerRunner(rustClippyRunner); // Rust analysis (priority 50)
