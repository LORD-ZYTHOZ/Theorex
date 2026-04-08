-- scripts/migrations/008-pulse-trigger.sql
-- Theorex Pulse — fire pg_notify on every concept INSERT
-- Payload: agent_id, wing, label, memory_type, inserted_at
-- Pulse daemon on m1 LISTENs to 'concept_new' and writes PULSE.md per agent

CREATE OR REPLACE FUNCTION notify_concept_new()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'concept_new',
    json_build_object(
      'agent_id',    NEW.agent_id,
      'wing',        NEW.wing,
      'label',       NEW.label,
      'memory_type', NEW.memory_type,
      'inserted_at', now()
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concept_new ON concepts;

CREATE TRIGGER trg_concept_new
AFTER INSERT ON concepts
FOR EACH ROW EXECUTE FUNCTION notify_concept_new();
