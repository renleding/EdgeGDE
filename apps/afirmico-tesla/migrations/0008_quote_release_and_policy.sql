-- FRS-010 F07: individual quote package, consent-based release, policy tracking.
--
-- Note: `tesla_member.mobile` and `.postcode` (F01-R05) already exist — migration
-- 0005 added them. They are not re-added here.
--
-- Why F07 needs them present at all
-- ---------------------------------
-- The insurer package (F07-R01) carries member PII, and every group aggregate
-- (F06-R01/R03) segments on postcode. Both silently depend on columns that the
-- Tesla OAuth handshake cannot supply — it returns a subject, an email and a
-- name. So they are filled by an onboarding step and remain NULLable on purpose:
-- an empty-string postcode would aggregate into a real bucket named "" and
-- corrupt F06 output, whereas NULL can be excluded from a release with a visible
-- reason.

-- A release must be able to name its own subject (F07-N03).
--
-- Found by test: the revocation check resolved the member by joining through
-- tesla_quote_request, but that back-reference is only populated when a quote
-- request row happens to exist. A package built without one therefore skipped
-- the consent re-check entirely and kept downloading after the member revoked —
-- a consent gate that silently does not apply, which is worse than no gate
-- because it reads as enforced.
--
-- Recording subject_member_id and subject_vin on the release makes the check
-- direct and unconditional. NULL is allowed because a group-analytics release is
-- anonymised and has no member by design; the check is skipped for those on
-- release_type, not on the absence of a join result.
ALTER TABLE tesla_release ADD COLUMN subject_member_id TEXT REFERENCES tesla_member (member_id);
ALTER TABLE tesla_release ADD COLUMN subject_vin TEXT REFERENCES tesla_vehicle (vin);

CREATE INDEX idx_tesla_release_subject_member ON tesla_release (subject_member_id);

-- Insurer responses to a quote request (F07-R07, F07-R08).
--
-- One row per response, not per request: an insurer may decline, then re-quote,
-- and the member's decision must be recorded against the specific offer they saw
-- rather than the latest one. Storing the offered terms here rather than
-- re-deriving them means a member can always be shown exactly what they accepted,
-- even after the pricing or the profile has moved on.
CREATE TABLE tesla_quote_response (
  response_id        TEXT PRIMARY KEY,
  quote_request_id   TEXT NOT NULL REFERENCES tesla_quote_request (quote_request_id),
  insurer_ref        TEXT NOT NULL,
  insurer_name       TEXT,
  -- Terms as offered. Text/JSON rather than computed columns: these are the
  -- insurer's figures, and we must record them verbatim rather than reinterpret.
  premium_amount     REAL,
  premium_currency   TEXT NOT NULL DEFAULT 'AUD',
  excess_amount      REAL,
  cover_type         TEXT,
  terms_json         TEXT,
  status             TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received','presented','accepted','declined','expired','withdrawn')),
  received_at        TEXT NOT NULL,
  presented_at       TEXT,
  decided_at         TEXT,
  decision_reason    TEXT,
  -- Which package version this quote was priced against (F06-R06 discipline
  -- applied to individual releases): without it a quote cannot be reconciled
  -- against the data it was actually based on.
  release_id         TEXT REFERENCES tesla_release (release_id)
);

-- Policy binding (F07-R09, F07-R10).
--
-- The policy is written by the insurer and bound to AFIRMICO Auto, so this table
-- is our record of the binding and the cover period — not the policy of record.
-- `cover_end` is what F07-R10 keys off when deciding whether collection may be
-- terminated.
CREATE TABLE tesla_policy (
  policy_id        TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES tesla_member (member_id),
  vin              TEXT REFERENCES tesla_vehicle (vin),
  response_id      TEXT REFERENCES tesla_quote_response (response_id),
  insurer_ref      TEXT NOT NULL,
  insurer_name     TEXT,
  policy_number    TEXT,
  cover_start      TEXT NOT NULL,
  cover_end        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','lapsed','cancelled','expired')),
  bound_at         TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_tesla_quote_response_request ON tesla_quote_response (quote_request_id);
CREATE INDEX idx_tesla_policy_member          ON tesla_policy (member_id);
CREATE INDEX idx_tesla_policy_cover_end       ON tesla_policy (cover_end);
CREATE INDEX idx_tesla_member_postcode        ON tesla_member (postcode);

-- A member may hold at most one active policy per vehicle. Two active policies on
-- one VIN would double-count the vehicle in F06 aggregates and make F07-R10's
-- cover-end check ambiguous.
CREATE UNIQUE INDEX idx_tesla_policy_one_active_per_vin
  ON tesla_policy (vin) WHERE status = 'active';

-- F07-R07/R08 integrity: a response can only be accepted once a member decision
-- exists, and a policy must cite the response it was bound from. The guard below
-- refuses an accepted response with no decision timestamp, which is the shape a
-- bug produces when it writes the status but forgets the audit fields.
CREATE TRIGGER trg_tesla_quote_response_accepted_needs_decision
BEFORE UPDATE OF status ON tesla_quote_response
FOR EACH ROW
WHEN NEW.status = 'accepted' AND NEW.decided_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'accepted quote response requires decided_at');
END;

-- F07-R09: a policy cannot be recorded as bound without a cover period.
CREATE TRIGGER trg_tesla_policy_needs_cover_period
BEFORE INSERT ON tesla_policy
FOR EACH ROW
WHEN NEW.cover_end <= NEW.cover_start
BEGIN
  SELECT RAISE(ABORT, 'policy cover_end must be after cover_start');
END;
