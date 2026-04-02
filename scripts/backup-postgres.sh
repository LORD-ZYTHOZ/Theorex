#!/bin/bash
# Install: cp scripts/com.theorex.backup.plist ~/Library/LaunchAgents/
#          launchctl load ~/Library/LaunchAgents/com.theorex.backup.plist
# Test:    bash scripts/backup-postgres.sh
# Restore: gunzip -c ~/backups/theorex/theorex-XXXX.sql.gz | psql -h localhost -U claw theorex
set -euo pipefail

BACKUP_DIR="$HOME/backups/theorex"
LOG="$BACKUP_DIR/backup.log"
RETENTION_DAYS=7
DB_NAME="theorex"
DB_USER="claw"
DB_HOST="localhost"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/theorex-${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting backup..." >> "$LOG"

if ! pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"; then
    echo "[$(date)] ERROR: pg_dump failed" >> "$LOG"
    rm -f "$BACKUP_FILE"
    exit 1
fi

if [ ! -s "$BACKUP_FILE" ]; then
    echo "[$(date)] ERROR: Backup file is empty" >> "$LOG"
    rm -f "$BACKUP_FILE"
    exit 1
fi

echo "[$(date)] Backup complete: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))" >> "$LOG"

# Prune old backups
find "$BACKUP_DIR" -name "theorex-*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Pruned backups older than ${RETENTION_DAYS} days" >> "$LOG"

# Rotate flash_events partitions (create next month, drop old)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v bun &>/dev/null; then
    bun "$SCRIPT_DIR/rotate-partitions.ts" >> "$LOG" 2>&1 || echo "[$(date)] WARNING: partition rotation failed" >> "$LOG"
fi

# Verify backup integrity (test restore to temp db, check row counts)
if command -v bun &>/dev/null; then
    bun "$SCRIPT_DIR/verify-backup.ts" >> "$LOG" 2>&1 || echo "[$(date)] WARNING: backup verification failed" >> "$LOG"
fi
