# AGENTS.md - Project-specific context for pi agents

## Knip False Positives

Knip reports all `.ts` files as `[file]` (unused files) because it doesn't
understand that pi loads `index.ts` directly at runtime — not via npm scripts.
**This is a false positive for pi extensions.**

When running `/lens-booboo-fix`:
- **IGNORE** all `[file]` type issues from Knip (dead code section)
- Only act on `[export]`, `[dependency]`, `[devDependency]` issues from Knip

Do NOT "fix" by deleting or restructuring source files that knip reports
as unused — they ARE used, just not via npm entry points.

## Project Structure

This is a pi extension. Key entry point: `index.ts`

- `clients/` - Lint tool wrappers and utilities
- `commands/` - /lens-booboo, /lens-booboo-fix, /lens-booboo-refactor
- `rules/ast-grep-rules/` - AST structural lint rules
