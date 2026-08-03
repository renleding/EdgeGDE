-- FRS-007 Phase 3 closure — P3: L1 Resumption Handshake support
--
-- Adds the idempotency contract to the mission queue:
--   target_state    — the business state the item must reach; the
--                     Performer's resume handshake reads it back and
--                     checks whether it was ALREADY reached (prior
--                     partial success). If reached → mark COMPLETED
--                     (idempotent skip); if not → execute.
--   state_object_id — the business object the target_state applies to
--                     (e.g. deal id) so the read-back is authoritative.

ALTER TABLE mission_queue ADD COLUMN target_state TEXT;
ALTER TABLE mission_queue ADD COLUMN state_object_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mission_queue_resume
    ON mission_queue (state_object_id, target_state);
