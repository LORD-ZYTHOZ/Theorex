/**
 * rotate-partitions.ts — Create upcoming flash_events partitions, drop old ones.
 *
 * Creates next month's partition if missing.
 * Drops partitions older than RETENTION_MONTHS (default: 3).
 *
 * Usage: bun scripts/rotate-partitions.ts [--dry-run]
 */

const RETENTION_MONTHS = 3;
const DRY_RUN = process.argv.includes("--dry-run");

function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}_${m}`;
}

function monthRange(date: Date): { start: string; end: string } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const fmtDate = (d: Date) => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return {
    start: fmtDate(new Date(y, m, 1)),
    end: fmtDate(new Date(y, m + 1, 1)),
  };
}

async function rotatePartitions(): Promise<void> {
  const sql = new Bun.SQL({
    host: process.env.THEOREX_PG_HOST || "100.95.91.32",
    port: Number(process.env.THEOREX_PG_PORT || 5432),
    user: process.env.THEOREX_PG_USER || "claw",
    database: process.env.THEOREX_PG_DB || "theorex",
    max: 2,
  });

  try {
    const now = new Date();

    // --- Create next month's partition ---
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextKey = monthKey(next);
    const nextRange = monthRange(next);
    const nextName = `flash_events_${nextKey}`;

    const existing = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ${nextName}
    `;

    if (existing.length === 0) {
      const createSql = `
        CREATE TABLE ${nextName} PARTITION OF flash_events
        FOR VALUES FROM ('${nextRange.start}') TO ('${nextRange.end}')
      `;
      if (DRY_RUN) {
        console.log(`[dry-run] Would create: ${nextName} (${nextRange.start} to ${nextRange.end})`);
      } else {
        await sql.unsafe(createSql);
        console.log(`[partition] Created: ${nextName} (${nextRange.start} to ${nextRange.end})`);
      }
    } else {
      console.log(`[partition] Already exists: ${nextName}`);
    }

    // --- Drop partitions older than RETENTION_MONTHS ---
    const cutoff = new Date(now.getFullYear(), now.getMonth() - RETENTION_MONTHS, 1);
    const cutoffKey = monthKey(cutoff);

    const partitions = await sql`
      SELECT inhrelid::regclass::text AS partition_name
      FROM pg_inherits
      WHERE inhparent = 'flash_events'::regclass
    `;

    const partitionRe = /^flash_events_(\d{4}_\d{2})$/;

    for (const p of partitions) {
      const name = p.partition_name as string;
      const match = partitionRe.exec(name);
      if (!match) continue;

      const partKey = match[1];
      if (partKey < cutoffKey) {
        if (DRY_RUN) {
          console.log(`[dry-run] Would drop: ${name} (older than ${cutoffKey})`);
        } else {
          await sql.unsafe(`DROP TABLE ${name}`);
          console.log(`[partition] Dropped: ${name}`);
        }
      }
    }

    console.log("[partition] Rotation complete.");
  } finally {
    await sql.end();
  }
}

rotatePartitions().catch((err) => {
  console.error("[partition] FAILED:", err);
  process.exit(1);
});
