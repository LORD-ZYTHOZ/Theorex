<!-- theronexus:start -->
# Theronexus — Code Intelligence

This project is indexed by Theronexus as **theorex** (956 symbols, 2568 relationships, 69 execution flows). Use the Theronexus MCP tools to understand code, assess impact, and navigate safely.

> If any Theronexus tool warns the index is stale, run `theorex ingest-code --agent main <dir> --theronexus` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `theronexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `theronexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `theronexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `theronexus_context({name: "symbolName"})`.

## When Debugging

1. `theronexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `theronexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ theronexus://repo/theorex/process/{processName}` — trace the full execution flow step by step
4. For regressions: `theronexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `theronexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `theronexus_context({name: "target"})` to see all incoming/outgoing refs, then `theronexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `theronexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `theronexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `theronexus_rename` which understands the call graph.
- NEVER commit changes without running `theronexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `theronexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `theronexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `theronexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `theronexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `theronexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `theronexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `theronexus://repo/theorex/context` | Codebase overview, check index freshness |
| `theronexus://repo/theorex/clusters` | All functional areas |
| `theronexus://repo/theorex/processes` | All execution flows |
| `theronexus://repo/theorex/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `theronexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `theronexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the Theronexus index becomes stale. Re-run analyze to update it:

```bash
theorex ingest-code --agent main <dir> --theronexus
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
theorex ingest-code --agent main <dir> --theronexus --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/theronexus/theronexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/theronexus/theronexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/theronexus/theronexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/theronexus/theronexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/theronexus/theronexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/theronexus/theronexus-cli/SKILL.md` |

<!-- theronexus:end -->