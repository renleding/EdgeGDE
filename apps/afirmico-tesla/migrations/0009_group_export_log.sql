-- FRS-010 F06: group-level anonymised analytics export log.
--
-- F06-R07 requires every group-tier export to be logged with the query definition,
-- the requesting party and the timestamp. F06-R06/N03 require the output to be
-- reproducible, so the log also carries the artifact hash: a figure delivered to an
-- insurer can then be reconciled later, or proven to have changed.
--
-- Why this is separate from tesla_release
-- ---------------------------------------
-- tesla_release already records releases, and a group export IS a kind of release.
-- It is kept distinct because the two differ in the dimension that matters for
-- auditing: an individual release is attributable to a member and must be
-- revocable, whereas a group export is anonymised, has no member, and must instead
-- be checked for the absence of PII. Folding them together would mean one table
-- whose most important column is null half the time.
CREATE TABLE tesla_group_export (
  export_id          TEXT PRIMARY KEY,

  -- The query definition, stored verbatim. Reproducibility (F06-R06/N03) is only
  -- meaningful if the request can be replayed exactly, so the parameters are kept
  -- as JSON rather than parsed into columns that could drift from the code.
  query_json         TEXT NOT NULL,

  -- Who asked. Free text rather than an FK: the requesting party is usually an
  -- insurer outside this system, and we must be able to record a request we cannot
  -- resolve to a row.
  requested_by       TEXT NOT NULL,
  requested_at       TEXT NOT NULL,

  period_start       TEXT NOT NULL,
  period_end         TEXT NOT NULL,
  row_count          INTEGER NOT NULL,
  vehicle_count      INTEGER NOT NULL,

  -- Deliberately the same shape as tesla_release: the hash of the exact bytes
  -- delivered, so a copy held by an insurer can be verified against ours.
  artifact_sha256    TEXT NOT NULL,
  r2_key             TEXT,

  -- F06-R06: which aggregation logic produced these numbers. A change here means
  -- figures from two exports are not comparable, and that must be visible.
  aggregation_version TEXT NOT NULL,

  -- F06-R08 (Should): small cells are published, not suppressed (F06-R04 is a Must
  -- and requires a single-member cohort to appear), but the operator MUST be warned.
  -- Recording the warning count makes "were they warned?" answerable after the fact.
  small_cell_count   INTEGER NOT NULL DEFAULT 0,
  warnings_json      TEXT,

  -- F06-R09 (Should): how many members contributed, so the recipient can gauge
  -- representativeness. Stored because a figure without its coverage is misleading.
  members_excluded_no_postcode INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tesla_group_export_requested_at ON tesla_group_export (requested_at);
CREATE INDEX idx_tesla_group_export_requested_by ON tesla_group_export (requested_by);
