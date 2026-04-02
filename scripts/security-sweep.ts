#!/usr/bin/env bun
/**
 * security-sweep.ts — Master orchestrator for weekly security sweep
 * Runs: npm audit → secret scan → pg_hba check
 * Alert on first failure.
 */

import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = '/Users/eoh/theorex/scripts'

function run(name: string, cmd: string, args: string[]): boolean {
  console.log(`[sweep] Running ${name}...`)
  const result = spawnSync(cmd, args, { cwd: SCRIPT_DIR })
  const out = result.stdout ? result.stdout.toString() : ''
  const err = result.stderr ? result.stderr.toString() : ''
  if (result.status !== 0) {
    console.error(`[sweep] FAIL: ${name}`)
    if (err) console.error(err.slice(0, 500))
    return false
  }
  console.log(`[sweep] OK: ${name}`)
  return true
}

async function main() {
  console.log('[sweep] === Hades Security Sweep ===')

  const steps = [
    ['npm-audit', 'bun', ['security-npm-audit.ts']],
    ['secret-scan', 'bun', ['security-secret-scan.ts']],
    ['pg-hba', 'bun', ['security-pg-hba.ts']],
  ]

  for (const [name, cmd, args] of steps) {
    const ok = run(name, cmd, args)
    if (!ok) {
      console.error(`[sweep] === Sweep FAILED at ${name} ===`)
      process.exit(1)
    }
  }

  console.log('[sweep] === Sweep COMPLETE: All checks passed ===')
  process.exit(0)
}

main()
