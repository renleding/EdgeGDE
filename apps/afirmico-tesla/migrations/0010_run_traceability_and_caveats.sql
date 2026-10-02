-- FRS-010 F06: group export log, plus the run-traceability link AC6 requires.
--
-- Part 1 (migration 0009) created tesla_group_export. This migration adds the
-- columns that make F06-AC6 ("the dataset generation run is recorded and
-- traceable") actually true, and fixes the missing link it depends on.
--
-- The traceability gap, and why it was not visible
-- ------------------------------------------------
-- F06-AC6 asks for the generation run behind a figure to be traceable. It was not.
-- The intended chain was:
--
--   tesla_telemetry_fact.batch_id  →  tesla_telemetry_batch  →  tesla_ingest_run.run_id
--
-- but the middle link was absent: `tesla_telemetry_batch` had **no run_id column**,
-- while the run log (`tesla_ingest_run`, migration 0007) is keyed on run_id. The
-- ingest handler generates a `runId` and a separate `batchId` for the same request,
-- and the batch INSERT wrote only the batchId. So from a fact you could reach the
-- batch and the raw payload in R2, but not the run that ingested it — and from a run
-- you could not reach its facts at all.
--
-- Two things made this easy to miss. The run id *is* stored, in the R2 object's
-- `customMetadata` — but that is reachable only by fetching the object, so it is a
-- forensic breadcrumb rather than a queryable relation. And in the harness the
-- export was validated against a database seeded without batches, so the lookup
-- returned an empty list, which reads as "no runs in this window" rather than
-- "the join is broken".
--
-- Recording the link on the batch row is the right place: the batch is already the
-- join between raw payload and parsed facts, and run_id is immutable per batch, so
-- there is no update anomaly.
--
-- Note on run id generation (checked, not assumed): `startIngestRun` uses
-- `newId()`, which is a 48-bit millisecond timestamp plus 80 bits of randomness in
-- Crockford base32. It is collision-safe and sortable, so no change to its format is
-- needed. An earlier draft of this migration claimed the id was derived from an
-- ISO-8601 string and could collide within a millisecond; both halves of that were
-- wrong and the claim is withdrawn rather than left in a comment.
--
-- Idempotency: SQLite has no `ADD COLUMN IF NOT EXISTS`, and D1 applies each
-- migration once (tracked in d1_migrations), so a plain ALTER is correct here.

-- ---- Part 2: the missing link (F06-AC6) --------------------------------------

-- Nullable on purpose. Batches ingested before this migration have no run to point
-- at, and back-filling a plausible one would be fabricating provenance — worse than
-- an honest NULL, which the export reports as "no runs recorded" rather than
-- claiming a run it cannot name.
ALTER TABLE tesla_telemetry_batch ADD COLUMN run_id TEXT REFERENCES tesla_ingest_run (run_id);

CREATE INDEX IF NOT EXISTS idx_tesla_telemetry_batch_run ON tesla_telemetry_batch (run_id);

-- ---- Part 3: export log columns ---------------------------------------------

-- F06-AC6: the collection runs whose facts underlie an export. Stored as a JSON array
-- rather than a join table because it is written once with the export and read as a
-- whole; a join table would add a second write path to keep consistent for no query
-- that needs it.
ALTER TABLE tesla_group_export ADD COLUMN collection_run_ids TEXT;

-- Stated limitations of the export (e.g. model year derived rather than reported, or
-- a segment that could not be resolved). Persisted with the export so a caveat cannot
-- be lost with the process that printed it.
ALTER TABLE tesla_group_export ADD COLUMN caveats_json TEXT;

-- ---- Part 4: the fact→run path, made indexable ------------------------------

-- Carries the columns the AC6 lookup actually reads, so resolving "which runs
-- produced this window" does not scan the fact table.
CREATE INDEX IF NOT EXISTS idx_tesla_telemetry_fact_batch
  ON tesla_telemetry_fact (batch_id, observed_at);
