import { spawnSync } from 'node:child_process'

const r = spawnSync('psql', [
  '-h', '100.95.91.32', '-U', 'claw', '-d', 'theorex',
  '-t', '-A', '-c',
  "SELECT c.relname, 0 as row_count FROM pg_class c JOIN pg_inherits i ON c.oid = i.inhrelid JOIN pg_class parent ON parent.oid = i.inhparent WHERE parent.relname = 'flash_events' ORDER BY c.relname"
])

console.log('stdout:', r.stdout ? r.stdout.toString() : 'NULL')
console.log('stderr:', r.stderr ? r.stderr.toString() : 'NULL')
console.log('status:', r.status)

const names = (r.stdout ? r.stdout.toString() : '').trim().split('\n').filter(Boolean)
console.log('partition count:', names.length)
for (const n of names) console.log(' -', n.trim())
