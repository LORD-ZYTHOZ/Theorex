-- scripts/migrations/007-palace-columns.sql
-- Palace Dream (AAAK) — add wing, room, compressed_aaak columns to concepts table
--
-- wing: memory palace wing identifier, e.g. 'wing_secretarius', 'wing_diary_meridian'
-- room: room within a wing, e.g. 'room_trading_decisions', 'room_2026-04-07'
-- compressed_aaak: AAAK-encoded compressed representation of concept body

DO $$
BEGIN
  -- Add wing column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'concepts'
      AND column_name = 'wing'
  ) THEN
    ALTER TABLE concepts ADD COLUMN wing varchar(64);
  END IF;

  -- Add room column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'concepts'
      AND column_name = 'room'
  ) THEN
    ALTER TABLE concepts ADD COLUMN room varchar(128);
  END IF;

  -- Add compressed_aaak column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'concepts'
      AND column_name = 'compressed_aaak'
  ) THEN
    ALTER TABLE concepts ADD COLUMN compressed_aaak text;
  END IF;
END $$;

-- Index on wing alone (for single-wing retrieval)
CREATE INDEX IF NOT EXISTS idx_concepts_wing
  ON concepts (wing)
  WHERE wing IS NOT NULL;

-- Composite index on wing + room (for scoped room retrieval)
CREATE INDEX IF NOT EXISTS idx_concepts_wing_room
  ON concepts (wing, room)
  WHERE wing IS NOT NULL;
