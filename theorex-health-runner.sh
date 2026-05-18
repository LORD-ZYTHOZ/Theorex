#!/bin/bash
# theorex-health-runner.sh — runs health-check via bun, used by PM2
cd /Users/eoh/.openclaw/projects/theorex
exec bun run src/cli/index.ts health-check
