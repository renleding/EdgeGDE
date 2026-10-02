-- FRS-010 F08: Tesla data storage model for the AFIRMICO Auto platform.
--
-- Design notes
-- ------------
-- * This database is owned by the `afirmico-tesla` Worker. The Oracle relay
--   never writes to it (SDD-010 invariant 3).
-- * Row ids are ULIDs stored as TEXT: lexicographically sortable by creation
--   time, so `ORDER BY id` is chronological and no extra index is needed for
--   time-ordered scans. ULIDs are generated in the Worker, not by SQLite, so
--   the schema does not depend on a specific SQLite version.
-- * Timestamps are TEXT ISO-8601 UTC (`2026-10-02T10:11:47Z`), never numeric.
--   They sort correctly, survive a JSON round trip, and stay legible in a
--   D1 dump. Durations are also text ('6 hours') because they are display
--   values passed to Tesla, not arithmetic operands.
-- * The fact table is deliberately NARROW: one row per (vin, field, time) with
--   typed value columns rather than one column per field. Widening the
--   collected field set therefore never changes the fact table's shape.
-- * There is exactly ONE raw-payload table (`tesla_telemetry_batch`), not two.
--   An earlier design had the relay POST to one table and the Worker normalise
--   into another; that duplicated every payload and left the raw copy without
--   an owner. The raw body lives in R2 and this table holds its reference,
--   checksum and processing state.
--
-- The catalog tables (`tesla_field_catalog`) are populated by 0002, which is
-- generated from Tesla's vehicle_data.proto plus fleet_streaming_fields.csv.

-- ---------------------------------------------------------------------------
-- F03: Complete Fleet API registry
-- ---------------------------------------------------------------------------

-- Every Fleet Telemetry field Tesla exposes, collected or not. Storing the full
-- universe up front is what makes widening the collected subset a config
-- change instead of a migration (FRS-010 F03-R07).
CREATE TABLE tesla_field_catalog (
  field_key                 TEXT    PRIMARY KEY,        -- proto Field enum name
  field_number              INTEGER UNIQUE NOT NULL,    -- proto Field enum number
  category                  TEXT    NOT NULL,           -- Charging, Safety, ...
  value_type                TEXT    NOT NULL,           -- real|integer|boolean|string|enum|timestamp|time|Location|unknown
  vehicle_data_equivalent   TEXT,                       -- REST equivalent, '' when telemetry-only
  description               TEXT,
  proto_enum_name           TEXT,                       -- value enum, '' when scalar
  collection_tier           TEXT    NOT NULL DEFAULT 'never'
                            CHECK (collection_tier IN ('event','on_change','once','never')),
  collected                 INTEGER NOT NULL DEFAULT 0 CHECK (collected IN (0,1)),
  collection_group          TEXT,                       -- config group when collected (F03-R07)
  min_delta                 REAL,                       -- Tesla minimum_delta when collected (F03-R07)
  -- Location and RouteLine carry movement traces. Classified explicitly rather
  -- than inferred from the type, because erasure and release both key off it
  -- (F03-R11).
  sensitivity               TEXT    NOT NULL DEFAULT 'standard'
                            CHECK (sensitivity IN ('standard','location','trace')),
  is_broken                 INTEGER NOT NULL DEFAULT 0 CHECK (is_broken IN (0,1)),
  min_firmware_version      TEXT,                       -- first firmware exposing the field
  is_deprecated             INTEGER NOT NULL DEFAULT 0 CHECK (is_deprecated IN (0,1)),
  is_experimental           INTEGER NOT NULL DEFAULT 0 CHECK (is_experimental IN (0,1)),
  is_semitruck              INTEGER NOT NULL DEFAULT 0 CHECK (is_semitruck IN (0,1)),
  source                    TEXT    NOT NULL,           -- proto | proto+csv
  CHECK (collected = 0 OR collection_tier <> 'never'),
  -- An event field must actually record readings; a once-only field must go to
  -- the snapshot table. This keeps tier and storage location consistent.
  CHECK (collection_tier <> 'once' OR collected = 1),
  -- A broken field must never be collected.
  CHECK (is_broken = 0 OR collected = 0)
);

CREATE INDEX idx_tesla_field_catalog_collected ON tesla_field_catalog (collected, category);
CREATE INDEX idx_tesla_field_catalog_category  ON tesla_field_catalog (category);
CREATE INDEX idx_tesla_field_catalog_sensitivity ON tesla_field_catalog (sensitivity);

-- The legal values of every enum field, so a decoded reading can be rendered
-- and validated without shipping the proto to the browser.
CREATE TABLE tesla_field_enum_value (
  enum_name   TEXT    NOT NULL,
  value_int   INTEGER NOT NULL,
  value_label TEXT    NOT NULL,
  PRIMARY KEY (enum_name, value_int)
);

CREATE TABLE tesla_field_enum_def (
  enum_name    TEXT PRIMARY KEY,
  description  TEXT,
  value_count  INTEGER
);

-- REST endpoints the platform may call. The registry covers the COMPLETE Fleet
-- API surface including families not enabled at MVP, so enabling a family later
-- is a flag change (F03-R05/R06).
CREATE TABLE tesla_endpoint_catalog (
  endpoint_key    TEXT PRIMARY KEY,      -- 'vehicle.list', 'fleet_telemetry_config.create'
  family          TEXT NOT NULL
                  CHECK (family IN ('auth','partner','vehicle','vehicle_data',
                                    'fleet_telemetry','fleet_telemetry_config',
                                    'vehicle_command','energy','energy_command',
                                    'energy_product','enterprise','user','charging')),
  method          TEXT NOT NULL CHECK (method IN ('GET','POST','PUT','DELETE')),
  path_template   TEXT NOT NULL,         -- '/api/1/vehicles'
  scope           TEXT,                  -- required OAuth scope
  requires_auth   TEXT NOT NULL DEFAULT 'partner'
                  CHECK (requires_auth IN ('partner','user','both','none')),
  is_command      INTEGER NOT NULL DEFAULT 0 CHECK (is_command IN (0,1)),
  enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  description     TEXT,
  doc_url         TEXT,
  refinement      TEXT                   -- undocumented shape, captured from a live response
);

CREATE INDEX idx_tesla_endpoint_catalog_family ON tesla_endpoint_catalog (family, enabled);

-- Alert dictionary: 18,436 reference rows, not member data.
--
-- The key is the composite (signal_name, models), NOT signal_name alone: 853
-- signal names carry up to three model-specific variants that are genuinely
-- different content, not duplicates. Keying on signal_name would silently drop
-- 857 rows of safety text (F03-R04a).
CREATE TABLE tesla_alert_catalog (
  signal_name          TEXT NOT NULL,
  models               TEXT NOT NULL,      -- model list this variant applies to
  condition            TEXT,
  clear_condition      TEXT,
  description          TEXT,
  potential_impact     TEXT,
  customer_message_1   TEXT,
  customer_message_2   TEXT,
  audiences            TEXT,               -- service / service-fix / customer;service-fix ...
  source_row           INTEGER,            -- 1-based CSV line, for traceability
  PRIMARY KEY (signal_name, models)
);

CREATE INDEX idx_tesla_alert_catalog_signal   ON tesla_alert_catalog (signal_name);
CREATE INDEX idx_tesla_alert_catalog_audience ON tesla_alert_catalog (audiences);
CREATE INDEX idx_tesla_alert_catalog_models   ON tesla_alert_catalog (models);

-- Every catalog load is recorded with its source checksum so staleness is
-- auditable and a re-load can be proven a no-op (F03-R08/R09).
CREATE TABLE tesla_catalog_load (
  catalog_name     TEXT NOT NULL,          -- 'field','alert','endpoint'
  source_name      TEXT NOT NULL,          -- file name or upstream URL
  source_sha256    TEXT NOT NULL,
  source_rows      INTEGER,
  loaded_rows      INTEGER,
  loaded_at        TEXT NOT NULL,
  loader_version   TEXT NOT NULL,
  PRIMARY KEY (catalog_name, source_sha256, loaded_at)
);

CREATE INDEX idx_tesla_catalog_load_recent ON tesla_catalog_load (catalog_name, loaded_at);

-- ---------------------------------------------------------------------------
-- F01: Member, vehicle, consent
-- ---------------------------------------------------------------------------

CREATE TABLE tesla_member (
  member_id      TEXT PRIMARY KEY,
  -- TOCA membership reference. NULL means the member has not yet been verified
  -- as a TOCA member, which is material because non-members are charged.
  toca_member_id TEXT UNIQUE,
  toca_status    TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (toca_status IN ('unknown','verified_toca','non_member','lapsed')),
  email          TEXT,
  display_name   TEXT,
  -- Tesla identity as returned by the id_token. The `sub` claim is the stable
  -- identifier; the email is not stable enough to key on.
  tesla_sub      TEXT UNIQUE,
  tesla_email    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_tesla_member_toca  ON tesla_member (toca_status);
CREATE INDEX idx_tesla_member_email ON tesla_member (email);

-- One member can have several Teslas. `vin` is globally unique.
CREATE TABLE tesla_vehicle (
  vin             TEXT PRIMARY KEY,
  member_id       TEXT REFERENCES tesla_member (member_id),
  display_name    TEXT,
  model           TEXT,
  car_type        TEXT,                 -- CarTypeValue label, once-only field
  trim            TEXT,
  efficiency_pkg  TEXT,                 -- EfficiencyPackage, once-only field
  hardware_gen    TEXT,                 -- 'HW3' | 'HW4' | ... resolved at onboarding
  min_firmware    TEXT,                 -- firmware seen, drives FSD field availability
  tesla_id        TEXT,                 -- Tesla's numeric vehicle id
  tesla_id_s       TEXT,                -- Tesla's opaque string id
  is_energy_site  INTEGER NOT NULL DEFAULT 0 CHECK (is_energy_site IN (0,1)),
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT
);

CREATE INDEX idx_tesla_vehicle_member ON tesla_vehicle (member_id);

-- Vehicle attributes that only change when the car is re-flashed or the member
-- changes a setting. Storing these here instead of as facts is what stops
-- CarType/Version from being written once per telemetry observation forever.
CREATE TABLE tesla_vehicle_snapshot (
  vin             TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  field_key       TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  value_text      TEXT,
  value_kind      TEXT NOT NULL DEFAULT 'text'
                  CHECK (value_kind IN ('text','int','real','bool','json')),
  observed_at     TEXT NOT NULL,
  PRIMARY KEY (vin, field_key)
);

-- Snapshot history: the current value lives in tesla_vehicle_snapshot, and a
-- change (e.g. a firmware update altering `Version`) appends here so the timing
-- of a field-availability change is reconstructable.
CREATE TABLE tesla_vehicle_snapshot_history (
  vin             TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  field_key       TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  value_text      TEXT,
  observed_at     TEXT NOT NULL,
  PRIMARY KEY (vin, field_key, observed_at)
);

-- Virtual key / pairing state. The public key is committed to the repo; the
-- private key lives only in Bitwarden Secrets and MUST NOT appear here.
CREATE TABLE tesla_vehicle_key (
  vin          TEXT PRIMARY KEY REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  key_role     TEXT NOT NULL DEFAULT 'fleet_telemetry'
               CHECK (key_role IN ('fleet_telemetry')),
  paired_at    TEXT,
  key_state    TEXT NOT NULL DEFAULT 'unpaired'
               CHECK (key_state IN ('unpaired','paired','fault','unpaired_by_owner')),
  last_error   TEXT,
  updated_at   TEXT NOT NULL
);

-- Consent is a versioned record, not a boolean on the member row (F01-R02/R03).
-- Revocation appends a row; the earlier grant stays readable for audit.
CREATE TABLE tesla_consent (
  consent_id        TEXT PRIMARY KEY,
  member_id         TEXT NOT NULL REFERENCES tesla_member (member_id),
  vin               TEXT REFERENCES tesla_vehicle (vin),
  scope_granted     TEXT NOT NULL,       -- space-separated OAuth scopes
  policy_version    TEXT NOT NULL,
  purposes          TEXT NOT NULL,       -- JSON array: insurance, energy, analytics
  granted_at        TEXT NOT NULL,
  revoked_at        TEXT,
  revoke_reason     TEXT,                -- member_revoked | admin | policy_change | key_removed
  evidence_ref      TEXT                 -- R2 key of the signed consent artifact
);

CREATE INDEX idx_tesla_consent_member ON tesla_consent (member_id, granted_at);
CREATE INDEX idx_tesla_consent_active ON tesla_consent (member_id) WHERE revoked_at IS NULL;

CREATE TABLE tesla_auth_session (
  session_id    TEXT PRIMARY KEY,
  member_id     TEXT REFERENCES tesla_member (member_id),
  vin           TEXT,
  scope         TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  user_agent    TEXT
);

CREATE INDEX idx_tesla_auth_session_expiry ON tesla_auth_session (expires_at);

-- ---------------------------------------------------------------------------
-- F04: Telemetry collection
-- ---------------------------------------------------------------------------

-- One row per vehicle telemetry configuration. A vehicle accepts only three
-- configs in total, so this table stays tiny and the constraint is asserted.
CREATE TABLE tesla_telemetry_config (
  config_id         TEXT PRIMARY KEY,
  vin               TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  state             TEXT NOT NULL
                    CHECK (state IN ('pending','active','skipped','failed','removed')),
  skip_reason       TEXT
                    CHECK (skip_reason IS NULL OR skip_reason IN
                           ('missing_key','unsupported_hardware','unsupported_firmware','max_configs')),
  sync_interval     TEXT NOT NULL DEFAULT '6 hours',
  hostname          TEXT NOT NULL,       -- relay host Tesla connects to
  port              INTEGER NOT NULL DEFAULT 443,
  ca_file           TEXT,                -- unset in production: Tesla's CA is embedded in fleet-telemetry
  fields_json       TEXT NOT NULL,       -- the exact config sent to Tesla, verbatim
  config_version    INTEGER NOT NULL DEFAULT 1,
  applied_at        TEXT,
  verified_at       TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_tesla_telemetry_config_vin   ON tesla_telemetry_config (vin);
CREATE INDEX idx_tesla_telemetry_config_state ON tesla_telemetry_config (state);
-- At most one live config per vehicle; superseded configs are marked 'removed'.
CREATE UNIQUE INDEX idx_tesla_telemetry_config_live
  ON tesla_telemetry_config (vin) WHERE state IN ('pending','active');

-- Raw inbound payloads. ONE table, reference + checksum only: the body itself
-- belongs in R2, and storing it here too would double the largest object in the
-- database. `processed_at IS NULL` is the work queue.
CREATE TABLE tesla_telemetry_batch (
  batch_id         TEXT PRIMARY KEY,
  vin              TEXT,
  received_at      TEXT NOT NULL,
  payload_bytes    INTEGER,
  r2_key           TEXT NOT NULL,
  payload_sha256   TEXT NOT NULL,
  datum_count      INTEGER,
  is_resend        INTEGER NOT NULL DEFAULT 0 CHECK (is_resend IN (0,1)),
  content_type     TEXT,
  idempotency_key  TEXT UNIQUE,          -- set when the relay supplies one
  processed_at     TEXT,
  process_error    TEXT
);

CREATE INDEX idx_tesla_telemetry_batch_unprocessed ON tesla_telemetry_batch (received_at)
  WHERE processed_at IS NULL;
CREATE INDEX idx_tesla_telemetry_batch_vin ON tesla_telemetry_batch (vin, received_at);

-- The narrow fact table: one row per field observation.
--
-- `field_key` + `observed_at` + `batch_id` is the natural identity; the unique
-- index makes re-delivery of a batch idempotent, which matters because Tesla
-- retries and the relay may re-POST.
--
-- `collection_tier` and `value_kind` are denormalised from the catalog on
-- purpose: the fact table is the largest object in the database and must be
-- queryable for "which fields did we actually collect in this period" without a
-- join. A trigger keeps them consistent with `tesla_field_catalog` on insert.
CREATE TABLE tesla_telemetry_fact (
  fact_id        TEXT PRIMARY KEY,
  vin            TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  field_key      TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  observed_at    TEXT NOT NULL,          -- Tesla `created_at`
  received_at    TEXT NOT NULL,          -- when our relay accepted it
  value_real     REAL,
  value_int      INTEGER,
  value_text     TEXT,
  value_bool     INTEGER CHECK (value_bool IS NULL OR value_bool IN (0,1)),
  value_json     TEXT,                   -- Location {} and other structured values
  value_kind     TEXT NOT NULL
                 CHECK (value_kind IN ('real','int','text','bool','json','invalid')),
  collection_tier TEXT NOT NULL
                 CHECK (collection_tier IN ('event','on_change')),
  batch_id       TEXT REFERENCES tesla_telemetry_batch (batch_id),
  is_resend      INTEGER NOT NULL DEFAULT 0 CHECK (is_resend IN (0,1)),
  -- Exactly one value column may be populated, and it must match value_kind.
  -- Note `invalid`: Tesla sends Value{invalid:true} when a signal is
  -- unsupported or unavailable, which is a datum worth storing, not an error.
  CHECK (
    (value_kind = 'real' AND value_real IS NOT NULL AND value_int IS NULL
       AND value_text IS NULL AND value_bool IS NULL AND value_json IS NULL)
    OR (value_kind = 'int' AND value_int IS NOT NULL AND value_real IS NULL
       AND value_text IS NULL AND value_bool IS NULL AND value_json IS NULL)
    OR (value_kind = 'text' AND value_text IS NOT NULL AND value_real IS NULL
       AND value_int IS NULL AND value_bool IS NULL AND value_json IS NULL)
    OR (value_kind = 'bool' AND value_bool IS NOT NULL AND value_real IS NULL
       AND value_int IS NULL AND value_text IS NULL AND value_json IS NULL)
    OR (value_kind = 'json' AND value_json IS NOT NULL AND value_real IS NULL
       AND value_int IS NULL AND value_text IS NULL AND value_bool IS NULL)
    OR (value_kind = 'invalid' AND value_real IS NULL AND value_int IS NULL
       AND value_text IS NULL AND value_bool IS NULL AND value_json IS NULL)
  )
);

CREATE UNIQUE INDEX idx_tesla_telemetry_fact_identity
  ON tesla_telemetry_fact (vin, field_key, observed_at, batch_id);
CREATE INDEX idx_tesla_telemetry_fact_vin_field_time
  ON tesla_telemetry_fact (vin, field_key, observed_at);
CREATE INDEX idx_tesla_telemetry_fact_time
  ON tesla_telemetry_fact (observed_at);

-- Change-only fields (SentryMode, PinToDriveEnabled, ...) are recorded as
-- transitions rather than readings, so their history stays readable without a
-- row per poll.
CREATE TABLE tesla_state_change (
  change_id     TEXT PRIMARY KEY,
  vin           TEXT NOT NULL,
  field_key     TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  previous_text TEXT,
  new_text      TEXT,
  changed_at    TEXT NOT NULL,
  batch_id      TEXT REFERENCES tesla_telemetry_batch (batch_id)
);

CREATE INDEX idx_tesla_state_change_vin ON tesla_state_change (vin, field_key, changed_at);

-- Signal counter, for reconciling our row count against Tesla's billing. Tesla
-- bills per signal pushed, so a stored count is the cheapest way to notice a
-- runaway config before the invoice does.
CREATE TABLE tesla_signal_counter (
  counter_id    TEXT PRIMARY KEY,
  vin           TEXT,
  period_start  TEXT NOT NULL,           -- UTC day
  signals       INTEGER NOT NULL DEFAULT 0,
  data_requests INTEGER NOT NULL DEFAULT 0,
  wakes         INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  UNIQUE (vin, period_start)
);

-- Billing-limit safety. Exceeding the limit strips every telemetry config and
-- Tesla does not restore them (FRS-010 F02-R13 / R-07), so the state is
-- tracked explicitly rather than inferred.
CREATE TABLE tesla_billing_guard (
  guard_id          TEXT PRIMARY KEY,
  checked_at        TEXT NOT NULL,
  limit_usd         REAL,
  usage_usd         REAL,
  projected_month   REAL,
  margin_ratio      REAL,                -- limit / projected; MUST stay >= 10
  alert_80_sent_at  TEXT,
  alert_100_sent_at TEXT,
  breach_detected_at TEXT,
  remediation_state TEXT
                    CHECK (remediation_state IS NULL OR remediation_state IN
                           ('none','detected','configs_reapplied','verified'))
);

-- ---------------------------------------------------------------------------
-- F05: Derived driver profile
-- ---------------------------------------------------------------------------

CREATE TABLE tesla_driver_profile (
  profile_id           TEXT PRIMARY KEY,
  member_id            TEXT NOT NULL REFERENCES tesla_member (member_id),
  vin                  TEXT NOT NULL REFERENCES tesla_vehicle (vin),
  period_start         TEXT NOT NULL,
  period_end           TEXT NOT NULL,
  odometer_km          REAL,
  distance_km          REAL,             -- MilesSinceReset converted to km
  fsd_km               REAL,             -- SelfDrivingMilesSinceReset converted to km
  -- How FSD distance was obtained. 'measured' means both counters were present;
  -- anything else MUST NOT be presented as FSD usage (FRS-010 F05-R11).
  fsd_availability     TEXT NOT NULL DEFAULT 'unavailable'
                       CHECK (fsd_availability IN ('measured','partial','unavailable')),
  fsd_note             TEXT,             -- why it is partial/unavailable (hardware, firmware, reset)
  counter_reset_count  INTEGER NOT NULL DEFAULT 0,
  derivation_version   TEXT NOT NULL,
  source_fact_min      TEXT,
  source_fact_max      TEXT,
  derived_at           TEXT NOT NULL
);

CREATE INDEX idx_tesla_driver_profile_member ON tesla_driver_profile (member_id, period_end);

-- Every time a counter is seen to decrease, the vehicle reset it (software
-- update, computer replacement, factory reset). Recording the event is what
-- lets a since-reset ratio be labelled honestly.
CREATE TABLE tesla_counter_reset (
  reset_id      TEXT PRIMARY KEY,
  vin           TEXT NOT NULL,
  field_key     TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  value_before  REAL,
  value_after   REAL,
  detected_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- F06 / F07: Release, quote package, audit
-- ---------------------------------------------------------------------------

CREATE TABLE tesla_release (
  release_id        TEXT PRIMARY KEY,
  release_type      TEXT NOT NULL
                    CHECK (release_type IN ('group_analytics','quote_package')),
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  aggregation_level TEXT                    -- 'postcode' for group releases
                    CHECK (aggregation_level IS NULL OR aggregation_level IN ('postcode','individual')),
  row_count         INTEGER,
  artifact_sha256   TEXT,
  r2_key            TEXT,
  derivation_version TEXT NOT NULL,
  policy_version    TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  created_by        TEXT
);

CREATE TABLE tesla_quote_request (
  quote_request_id  TEXT PRIMARY KEY,
  member_id         TEXT NOT NULL REFERENCES tesla_member (member_id),
  vin               TEXT NOT NULL REFERENCES tesla_vehicle (vin),
  underwriter_ref   TEXT,
  product           TEXT NOT NULL DEFAULT 'motor'
                    CHECK (product IN ('motor','home','contents','energy','other')),
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','accepted','declined','expired','withdrawn')),
  consent_id        TEXT REFERENCES tesla_consent (consent_id),
  release_id        TEXT REFERENCES tesla_release (release_id),
  requested_at      TEXT NOT NULL,
  decided_at        TEXT,
  decision_reason   TEXT
);

-- Access log for released data. Every read of a release must be attributable.
CREATE TABLE tesla_release_access (
  access_id     TEXT PRIMARY KEY,
  release_id    TEXT NOT NULL REFERENCES tesla_release (release_id),
  actor         TEXT NOT NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('member','underwriter','admin','system')),
  action        TEXT NOT NULL CHECK (action IN ('issue_token','download','view','revoke')),
  occurred_at   TEXT NOT NULL,
  ip_hash       TEXT,
  user_agent    TEXT
);

CREATE INDEX idx_tesla_release_access_release ON tesla_release_access (release_id, occurred_at);

-- Launch token for a report download. Stored hashed: the token itself is shown
-- once and never persisted in the clear.
CREATE TABLE tesla_download_token (
  token_id     TEXT PRIMARY KEY,
  release_id   TEXT NOT NULL REFERENCES tesla_release (release_id),
  token_hash   TEXT NOT NULL UNIQUE,
  issued_to    TEXT,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  max_uses     INTEGER NOT NULL DEFAULT 1,
  use_count    INTEGER NOT NULL DEFAULT 0,
  revoked_at   TEXT
);

CREATE INDEX idx_tesla_download_token_expiry ON tesla_download_token (expires_at);

-- ---------------------------------------------------------------------------
-- F09 / F10: Admin, lifecycle, audit
-- ---------------------------------------------------------------------------

CREATE TABLE tesla_admin_user (
  admin_id      TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('viewer','operator','owner')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at   TEXT
);

CREATE TABLE tesla_audit_event (
  event_id     TEXT PRIMARY KEY,
  occurred_at  TEXT NOT NULL,
  actor        TEXT,
  actor_type   TEXT CHECK (actor_type IS NULL OR actor_type IN ('member','admin','system','tesla')),
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  detail_json  TEXT,
  batch_id     TEXT
);

CREATE INDEX idx_tesla_audit_event_time ON tesla_audit_event (occurred_at);
CREATE INDEX idx_tesla_audit_event_subject ON tesla_audit_event (subject_type, subject_id);

-- Deletion ledger. A purge must be provable after the fact, so the record of
-- what was removed outlives the data itself.
CREATE TABLE tesla_erasure_log (
  erasure_id      TEXT PRIMARY KEY,
  member_id       TEXT,
  vin             TEXT,
  scope           TEXT NOT NULL,         -- facts | facts+profiles | everything
  facts_deleted   INTEGER NOT NULL DEFAULT 0,
  profiles_deleted INTEGER NOT NULL DEFAULT 0,
  r2_objects_deleted INTEGER NOT NULL DEFAULT 0,
  requested_at    TEXT NOT NULL,
  completed_at    TEXT,
  requested_by    TEXT,
  reason          TEXT,
  -- Retention conflicts: an active policy requires the connection to stay live
  -- until the policy expires, so an erasure can be legitimately partial.
  retention_hold_until TEXT,
  is_partial      INTEGER NOT NULL DEFAULT 0 CHECK (is_partial IN (0,1))
);

CREATE INDEX idx_tesla_erasure_log_member ON tesla_erasure_log (member_id);

-- ---------------------------------------------------------------------------
-- Ingestion guards
--
-- Declared last because SQLite resolves the trigger's target table at creation
-- time, so every referenced table must already exist.
-- ---------------------------------------------------------------------------

-- A fact may only be written for a field that is actually part of the collected
-- subset. Without this, widening the field set in the Worker without seeding the
-- catalog would write facts the platform has no definition for, and the failure
-- would only surface much later as unreportable data (F03 AC5).
CREATE TRIGGER trg_tesla_fact_requires_collected_field
BEFORE INSERT ON tesla_telemetry_fact
FOR EACH ROW
WHEN (SELECT collected FROM tesla_field_catalog WHERE field_key = NEW.field_key) <> 1
BEGIN
  SELECT RAISE(ABORT, 'field is not marked collected in tesla_field_catalog');
END;

-- A once-only field belongs in the snapshot table; an event/on_change field must
-- never be written to the snapshot table. This stops the two storage paths from
-- drifting into each other.
CREATE TRIGGER trg_tesla_snapshot_requires_once_field
BEFORE INSERT ON tesla_vehicle_snapshot
FOR EACH ROW
WHEN (SELECT collection_tier FROM tesla_field_catalog WHERE field_key = NEW.field_key) <> 'once'
BEGIN
  SELECT RAISE(ABORT, 'snapshot rows are only valid for once-only fields');
END;

-- Consent states are append-only: a grant is revoked by setting revoked_at, and
-- an already-revoked grant cannot be un-revoked. Rewriting history here would
-- destroy the audit trail F01-R02 depends on.
CREATE TRIGGER trg_tesla_consent_append_only
BEFORE UPDATE ON tesla_consent
FOR EACH ROW
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a revoked consent cannot be re-granted; insert a new consent row');
END;

-- A download token may not exceed its use limit (F07 release control).
CREATE TRIGGER trg_tesla_download_token_use_limit
BEFORE UPDATE ON tesla_download_token
FOR EACH ROW
WHEN NEW.use_count > NEW.max_uses
BEGIN
  SELECT RAISE(ABORT, 'download token use_count would exceed max_uses');
END;
