#!/usr/bin/env bun
/**
 * security-secret-scan.ts — Secret leak detection
 * Scans workspace directories for accidentally exposed secrets
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID ?? ''

const SCAN_DIRS = [
  '/Users/eoh/.openclaw',
  // Skip .ssh — SSH keys are expected and not a leak
]

const EXCLUDE_DIRS = ['node_modules', '.git', '.DS_Store', '.pm2', '.npm', '__pycache__', 'archive', 'serah_chat', 'serah_rev', 'serah_final', 'serah_deploy', 'claude_code', '.zip']

// Files that legitimately contain secrets (config, not leaks)
const EXCLUDE_FILES = [
  'openclaw.json',     // has API keys as configuration
  'device.json',       // device identity keys
  '.env.local',        // local env files (legitimately contain secrets)
  '.env.production',   // prod env (check manually)
  '.env.development',  // dev env
  'session_*.json',   // session files may contain auth tokens
  'models.json',      // model config with API keys
  'auth-profiles.json', // auth profiles with tokens
]
const MAX_FILE_SIZE = 500_000  // skip binaries, huge files

// Patterns that indicate secrets
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-key', re: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'google-api-key', re: /AIza[A-Za-z0-9_-]{35}/ },
  { name: 'generic-api-key', re: /[A-Za-z0-9]{40,}(?:aws|google|cloud|openai|anthropic)/ },
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9_.-]{20,}/ },
  { name: 'password-assignment', re: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{4,}/i },
  { name: 'private-key', re: /BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY/ },
  { name: 'generic-secret', re: /secret\s*[=:]\s*['"][^'"]{8,}/i },
  { name: 'aws-access-key', re: /(?:AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/ },
]

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  })
}

function scanDir(dir: string, depth = 0): Array<{ file: string; match: string }> {
  if (depth > 5) return []

  const findings: Array<{ file: string; match: string }> = []

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (EXCLUDE_DIRS.some(e => entry.includes(e))) continue

      const full = join(dir, entry)

      try {
        const stat = statSync(full)
        if (EXCLUDE_FILES.some(f => {
          if (f.includes('*')) {
            const re = new RegExp('^' + f.replace(/\*/g, '.*') + '$')
            return re.test(entry)
          }
          return entry === f || /\.bak(\.\d+)?$/.test(entry) || entry.endsWith('.rtf')
        })) continue
        if (stat.isDirectory()) {
          findings.push(...scanDir(full, depth + 1))
        } else if (stat.isFile() && stat.size < MAX_FILE_SIZE) {
          const content = readFileSync(full, 'utf8')
          for (const { name, re } of SECRET_PATTERNS) {
            // Only flag if not in a comment or clearly just documentation
            const lines = content.split('\n')
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
              if (re.test(trimmed)) {
                findings.push({ file: full, match: name })
              }
            }
          }
        }
      } catch {}
    }
  } catch {}

  return findings
}

function main() {
  console.log('[secret-scan] Starting...')

  const allFindings: Array<{ file: string; match: string }> = []

  for (const dir of SCAN_DIRS) {
    console.log(`[secret-scan] Scanning ${dir}...`)
    const findings = scanDir(dir)
    allFindings.push(...findings)
  }

  // Deduplicate
  const unique = allFindings.filter((f, i) =>
    allFindings.findIndex(f2 => f2.file === f.file && f2.match === f.match) === i
  )

  if (unique.length > 0) {
    console.error(`[secret-scan] FOUND ${unique.length} potential secrets:`)
    unique.slice(0, 10).forEach(f => console.error(`  ${f.match}: ${f.file}`))

    const msg = `[HADES] SECRET LEAK ALERT\n\nFound ${unique.length} potential secrets:\n\n${unique.slice(0, 5).map(f => `${f.match}\n${f.file}`).join('\n\n')}\n\nReview immediately.`
    try { sendTelegram(msg) } catch {}
    process.exit(1)
  }

  console.log('[secret-scan] ✅ No secrets found')
  process.exit(0)
}

main()
