#!/bin/bash
cd /Users/eoh/.openclaw/projects/theorex
export THEOREX_STORAGE=postgres
export THEOREX_PG_HOST=10.10.0.2
export THEOREX_PG_PORT=5432
export THEOREX_PG_USER=claw
export THEOREX_PG_DB=theorex
exec /Users/eoh/.bun/bin/bun run src/cli/index.ts evolve-review --agent all
