#!/usr/bin/env python3
"""
AFIRMICO Auto — telemetry relay forwarder (SDD-010 section 5).

WHAT THIS IS
  fleet-telemetry terminates Tesla's vehicle mTLS on :443 and hands each received
  payload to its `logger` dispatcher, which writes ONE JSON object per line to
  stdout. Nothing ships that stdout anywhere. This is the component that does.

  Architecture (SDD-010):

    vehicle --mTLS--> fleet-telemetry :443 --stdout JSONL--> THIS --HTTPS--> Tier 1
                                                                   /ingest/telemetry

  podman writes the container's stdout to a JSON-lines log file; this process
  tails that file, rebuilds the payload shape Tier 1 expects, and POSTs it.

BOUNDARY (SDD-010 section 2)
  The relay is a span port. It owns no database, no schema, no derivation, and no
  business logic. It must not resolve consent, decide collection tiers, or filter
  fields -- Tier 1 does all of that. Everything here is transport.

WHY IT REBUILDS THE PAYLOAD RATHER THAN FORWARDING A LINE
  fleet-telemetry does not emit the raw Tesla payload. It emits a logrus log line
  from datastore/simple/logger.go:

    {"activity":true,"data":{"Vin":"5YJ..","CreatedAt":"2026-..","IsResend":false,
     "Odometer":{"doubleValue":12345.6},"CarType":"model3"},"level":"info",
     "msg":"record_payload","time":".."}

  Tier 1's extractDatums() expects the Tesla envelope:

    {"vin":"5YJ..","data":[{"key":"Odometer","value":{"doubleValue":12345.6}}]}

  So each line is transformed here: `Vin` -> `vin`, `CreatedAt` -> each datum's
  `createdAt`, and every remaining key becomes a datum. `IsResend` is not a field
  and is dropped.

  THIS IS THE RELAY'S ONLY INTERPRETATION, AND THE REPO CANNOT EXPRESS IT.
  fleet-telemetry's `logger.verbose` (=> includeTypes) defaults to FALSE, and when
  it is false the transformer flattens values to bare scalars. It emits enums and
  invalid values as PLAIN STRINGS -- notably an invalid signal becomes the literal
  string "<invalid>". Tier 1's classifyValue() handles the object form correctly
  ({"invalid":true} -> "invalid") but would store the string form as VALID TEXT,
  turning "the vehicle declined this signal" into a measurement.

  server_config.json therefore sets verbose: true, which makes every value an
  object. That is why this file does not need to guess scalar types. The one
  remaining string-valued case is an enum, and enums are mapped explicitly to
  {"stringValue": ...} below. An unrecognised shape is NOT guessed: it is reported
  and counted, because inventing a value type here would manufacture data.

FAILURE POLICY
  Tier 1 returns 200 for any payload it understood -- including one where every
  datum was rejected -- so a non-2xx means the batch must be retried. Batches are
  buffered in memory ONLY for the duration of one POST; there is no on-disk queue,
  so a relay restart drops buffered lines. That is deliberate and matches the
  span-port boundary: fleet-telemetry does not retain payloads either, and the
  alternative (a durable queue on the relay) would put member data at rest on a
  box that is specified to hold none. Lines that cannot be forwarded are counted
  and reported so the loss is visible rather than silent.

NO SECRETS IN THIS FILE
  INGEST_SHARED_SECRET is read from the environment (systemd EnvironmentFile,
  mode 0600). It is never written here, never logged, and never included in an
  error message.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

# --------------------------------------------------------------------------- #
# Configuration (environment only -- no secrets in this file)
# --------------------------------------------------------------------------- #

INGEST_URL = os.environ.get(
    "INGEST_URL", "https://auto.afirmi.co/ingest/telemetry"
)
INGEST_SECRET = os.environ.get("INGEST_SHARED_SECRET", "")
CONTAINER_LOG = os.environ.get("CONTAINER_LOG", "/opt/relay/logs/fleet-telemetry.log")
STATE_DIR = os.environ.get("STATE_DIR", "/opt/relay/logs")

# Must stay below Tier 1's independent 512 KiB body cap (src/index.ts). This is
# the relay's own guard, not a substitute for that one.
MAX_BATCH_BYTES = int(os.environ.get("MAX_BATCH_BYTES", str(400 * 1024)))

# Lines are flushed when the batch is this old even if it has not filled, so a
# quiet vehicle still reports (6-hour config interval, SDD-010 section 1.1).
FLUSH_INTERVAL_SECONDS = float(os.environ.get("FLUSH_INTERVAL_SECONDS", "30"))

# Poll cadence when the log is idle.
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "1.0"))

REQUEST_TIMEOUT_SECONDS = float(os.environ.get("REQUEST_TIMEOUT_SECONDS", "30"))

HEARTBEAT_SECONDS = float(os.environ.get("HEARTBEAT_SECONDS", "300"))

# fleet-telemetry writes one line per record with these at the top level. They are
# log metadata or already represented elsewhere, never telemetry fields.
RESERVED_KEYS = frozenset({"activity", "level", "msg", "time", "data"})

# Inside `data`, fleet-telemetry's transformer uses these for payload metadata.
META_KEYS = frozenset({"Vin", "CreatedAt", "IsResend"})

# Enum-valued fields: fleet-telemetry emits these as STRINGS (carType, sentryModeState,
# ...). Tier 1's classifyValue() only accepts a string in object form, so each must be
# wrapped as {"stringValue": ...}.
#
# These are FIELD KEYS (the name the telemetry record uses), not the enum TYPE name.
# The list previously held enum type names -- "SentryModeState", "SpeedAssistLevel",
# "ShiftState", "WindowState" and 20 others -- none of which are field keys, while
# omitting the real keys. The two that mattered for us are included here correctly:
# the field is `SentryMode` (type `SentryModeState`) and the field is
# `SpeedLimitWarning` (type `SpeedAssistLevel`). Because the wrong names were listed,
# a bare-string enum value for those fields fell through to the unmapped counter and
# was dropped -- see the dict branch below, which is where the values actually arrive.
#
# Source of truth: `SELECT field_key FROM tesla_field_catalog WHERE value_type='enum'`.
ENUM_FIELDS: frozenset[str] = frozenset({
    "BMSState",
    "CabinOverheatProtectionMode",
    "CabinOverheatProtectionTemperatureLimit",
    "CarType",
    "CenterDisplay",
    "ChargePort",
    "ChargePortLatch",
    "ChargingCableType",
    "ClimateKeeperMode",
    "CruiseFollowDistance",
    "DefrostMode",
    "DetailedChargeState",
    "DiStateF",
    "DiStateR",
    "DiStateREL",
    "DiStateRER",
    "DoorState",
    "FastChargerType",
    "FdWindow",
    "ForwardCollisionWarning",
    "FpWindow",
    "Gear",
    "GuestModeMobileAccessState",
    "HvacAutoMode",
    "HvacPower",
    "Hvil",
    "LaneDepartureAvoidance",
    "LightsTurnSignal",
    "MediaPlaybackStatus",
    "PassengerSeatBelt",
    "PowershareStatus",
    "PowershareStopReason",
    "PowershareType",
    "RdWindow",
    "RpWindow",
    "ScheduledChargingMode",
    "SemitruckPassengerSeatFoldPosition",
    "SemitruckTractorParkBrakeStatus",
    "SemitruckTrailerParkBrakeStatus",
    "SentryMode",
    "SettingChargeUnit",
    "SettingDistanceUnit",
    "SettingTemperatureUnit",
    "SettingTirePressureUnit",
    "SpeedLimitWarning",
    "SunroofInstalled",
    "TonneauPosition",
    "TonneauTentMode",
    "TpmsHardWarnings",
    "TpmsSoftWarnings",
})

# Value type indicates the payload carries a signal we collected, so a value we cannot
# classify is data loss rather than noise. Used to escalate the unmapped counter.
COLLECTED_FIELDS: frozenset[str] = frozenset({
    "Odometer",
    "MilesSinceReset",
    "SelfDrivingMilesSinceReset",
    "SentryMode",
    "SpeedLimitMode",
    "SpeedLimitWarning",
    "PinToDriveEnabled",
    "AutomaticBlindSpotCamera",
    "AutomaticEmergencyBrakingOff",
    "BlindSpotCollisionWarningChime",
    "EmergencyLaneDepartureAvoidance",
    "CarType",
    "Version",
    "EfficiencyPackage",
})

# Payload values that ARE objects once verbose is on. Anything else that is not a
# scalar falls through to the unmapped counter rather than being guessed at.
OBJECT_VALUED_FIELDS = frozenset({"Location", "Doors", "Tires", "Time", "GpsState"})


class Stats:
    """Counters surfaced on every heartbeat so loss is visible, not inferred."""

    def __init__(self) -> None:
        self.lines_seen = 0
        self.datums_forwarded = 0
        self.batches_ok = 0
        self.batches_failed = 0
        self.retries = 0
        self.unmapped = 0
        self.skipped_nondata = 0
        self.dropped_after_retries = 0

    def snapshot(self) -> dict:
        return {
            "lines_seen": self.lines_seen,
            "datums_forwarded": self.datums_forwarded,
            "batches_ok": self.batches_ok,
            "batches_failed": self.batches_failed,
            "retries": self.retries,
            "unmapped": self.unmapped,
            "skipped_nondata": self.skipped_nondata,
            "dropped_after_retries": self.dropped_after_retries,
        }


STATS = Stats()


def log(message: str, **fields: object) -> None:
    """Emit a JSON line, matching the container's own log format."""
    record: dict[str, object] = {
        "level": "info",
        "component": "relay-forwarder",
        "msg": message,
    }
    record.update(fields)
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def transform_datum(datum_key: str, value: object) -> "dict | None":
    """
    Convert one fleet-telemetry value into Tier 1's TelemetryDatum.value shape.

    Returns None when the shape is not recognised. The caller counts that and
    omits the datum: a guessed value type would be manufactured data, and a wrong
    type is worse than a missing one because it is indistinguishable from a real
    reading.
    """
    # Already in Tier 1's object form -- verbose mode produces this.
    if isinstance(value, dict):
        if value.get("invalid") is True:
            return {"invalid": True}
        for wrapper in (
            "doubleValue",
            "intValue",
            "stringValue",
            "booleanValue",
            "locationValue",
        ):
            if wrapper in value:
                return {wrapper: value[wrapper]}

        # Enum fields arrive wrapped under their ENUM TYPE name, not as a plain
        # scalar: CarType is {"carType": "CarTypeModel3"}, SentryMode is
        # {"sentryModeState": "SentryModeStateOff"}, SpeedLimitWarning is
        # {"speedAssistLevel": "SpeedAssistLevelNone"}.
        #
        # These are the `oneof` members generated from the proto, so the wrapper
        # key is inside the value and cannot be known from the field key alone.
        # Every one of them was previously dropped: this branch only knew the five
        # value wrappers above, so an enum fell through to `return None` and the
        # field was silently discarded as `unmapped`. Three of our fourteen
        # consented fields were lost that way -- including the vehicle model.
        #
        # Accepting a single-entry dict whose value is a string or an integer is
        # the general rule rather than a wrapper-name list, because the wrapper is
        # the enum type name and there are 43 of them. Enums arrive as a label
        # ("CarTypeModel3") or occasionally as an ordinal ({"gear": 3}), so both
        # scalars are accepted. A multi-key dict is NOT accepted: that is the
        # location object, handled below.
        if len(value) == 1:
            only_value = next(iter(value.values()))
            # bool is a subclass of int, so exclude it explicitly -- a boolean
            # signal arrives as {"booleanValue": ...} and is handled above.
            if isinstance(only_value, str):
                return {"stringValue": only_value}
            if isinstance(only_value, int) and not isinstance(only_value, bool):
                return {"intValue": only_value}
            if isinstance(only_value, float):
                return {"doubleValue": only_value}

        # e.g. {"latitude":.., "longitude":..} from the location transformer.
        if "latitude" in value and "longitude" in value:
            return {"locationValue": value}
        return None

    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, str):
        # verbose mode still emits enum values as bare strings.
        if datum_key in ENUM_FIELDS:
            return {"stringValue": value}
        # The non-verbose "<invalid>" sentinel. verbose is true in our config so
        # this should not occur; if it does the config drifted, and treating it as
        # a measurement is exactly the failure we are guarding against.
        if value == "<invalid>":
            return {"invalid": True}
        return None
    if isinstance(value, int):
        return {"intValue": value}
    if isinstance(value, float):
        return {"doubleValue": value}

    return None


def line_to_payload(line: str) -> "dict | None":
    """
    Turn one fleet-telemetry log line into a Tier 1 ingest payload.

    Returns None when the line is not a vehicle-data record.
    """
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        STATS.skipped_nondata += 1
        return None

    if not isinstance(entry, dict):
        STATS.skipped_nondata += 1
        return None

    # Only the vehicle-data record carries telemetry. The same logger also emits
    # alerts, errors and connectivity records, which Tier 1's extractDatums()
    # would find no datums in -- forwarding them would produce empty batches that
    # still consume ingest runs.
    if entry.get("msg") != "record_payload":
        STATS.skipped_nondata += 1
        return None

    data = entry.get("data")
    if not isinstance(data, dict):
        STATS.skipped_nondata += 1
        return None

    vin = data.get("Vin")
    if not isinstance(vin, str) or not vin:
        # Without a VIN Tier 1 cannot resolve the vehicle or its consent, and the
        # payload would be recorded as `unknown_vehicle`. Not forwarding it is
        # the honest outcome; the counter makes it visible.
        STATS.skipped_nondata += 1
        return None

    created_at = data.get("CreatedAt")
    datums: list[dict] = []

    for key, value in data.items():
        if key in META_KEYS:
            continue
        transformed = transform_datum(key, value)
        if transformed is None:
            STATS.unmapped += 1
            # A field we collected that cannot be classified is LOST DATA, not
            # noise -- exactly how CarType, SentryMode and SpeedLimitWarning went
            # missing for three days while every counter looked calm. Log it at
            # warn so it is separable from the connection-record chatter above.
            level = "warn" if key in COLLECTED_FIELDS else "info"
            log("unmapped_value", level=level, field=key, python_type=type(value).__name__)
            continue
        datum: dict = {"key": key, "value": transformed}
        if isinstance(created_at, str) and created_at:
            datum["createdAt"] = created_at
        datums.append(datum)

    if not datums:
        return None

    STATS.lines_seen += 1
    return {"vin": vin, "data": datums}


def post_batch(payload: object, attempt: int) -> bool:
    """POST one batch. Returns True when Tier 1 accepted it."""
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        INGEST_URL,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            # F04-R13: the relay proves itself to Tier 1 with a shared secret.
            "x-ingest-secret": INGEST_SECRET,
            "user-agent": "afirmico-telemetry-relay/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if 200 <= response.status < 300:
                return True
            log("ingest_rejected", status=response.status, attempt=attempt)
            return False
    except urllib.error.HTTPError as error:
        # 4xx means Tier 1 could not process it at all and a retry will fail
        # identically; 5xx is transient. The body is read for diagnosis but is
        # never logged wholesale, since it may echo payload content.
        detail = ""
        try:
            detail = error.read(200).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - diagnosis must never mask the failure
            pass
        log(
            "ingest_http_error",
            status=error.code,
            attempt=attempt,
            transient=error.code >= 500,
            detail=detail,
        )
        return False
    except Exception as error:  # noqa: BLE001 - network layer
        log("ingest_transport_error", error=type(error).__name__, attempt=attempt)
        return False


def flush(batch: "list[dict]", deadline: float) -> None:
    """Forward the batched payloads as a single request, with bounded retries."""
    if not batch:
        return

    # Tier 1 accepts either one envelope or an array of them.
    payload: object = batch[0] if len(batch) == 1 else batch
    datum_count = sum(len(entry.get("data", [])) for entry in batch)

    for attempt in range(1, 4):
        if post_batch(payload, attempt):
            STATS.batches_ok += 1
            STATS.datums_forwarded += datum_count
            log(
                "batch_forwarded",
                payloads=len(batch),
                datums=datum_count,
                attempt=attempt,
            )
            return
        STATS.retries += 1
        time.sleep(min(2 ** attempt, 10))

    STATS.batches_failed += 1
    STATS.dropped_after_retries += len(batch)
    log(
        "batch_dropped",
        payloads=len(batch),
        datums=datum_count,
        reason="retries_exhausted",
        dropped_total=STATS.dropped_after_retries,
    )


def tail_forever() -> None:
    """
    Follow the container log across rotation.

    podman writes JSON-lines to the configured log path. `--log-opt max-size=10m
    --log-opt max-file=3` rotates it, so the inode can change underneath us; the
    file is re-opened when the open handle stops growing and the path's inode
    differs.
    """
    if not INGEST_SECRET:
        log("fatal", reason="INGEST_SHARED_SECRET not set")
        raise SystemExit(1)

    log("started", ingest_url=INGEST_URL, container_log=CONTAINER_LOG)

    while not os.path.exists(CONTAINER_LOG):
        log("waiting_for_log_file", path=CONTAINER_LOG)
        time.sleep(5)

    handle = open(CONTAINER_LOG, "r", encoding="utf-8", errors="replace")
    handle.seek(0, os.SEEK_END)

    batch: list[dict] = []
    batch_bytes = 0
    batch_opened = time.monotonic()
    inode = os.stat(CONTAINER_LOG).st_ino
    last_heartbeat = time.monotonic()

    while True:
        line = handle.readline()
        now = time.monotonic()

        if line:
            payload = line_to_payload(line.strip())
            if payload is not None:
                encoded = len(json.dumps(payload, separators=(",", ":")))
                if batch and batch_bytes + encoded > MAX_BATCH_BYTES:
                    flush(batch, now)
                    batch, batch_bytes = [], 0
                    batch_opened = now
                batch.append(payload)
                batch_bytes += encoded
            continue

        # No line available. Flush on age, then poll.
        if batch and (
            now - batch_opened >= FLUSH_INTERVAL_SECONDS
            or batch_bytes >= MAX_BATCH_BYTES
        ):
            flush(batch, now)
            batch, batch_bytes = [], 0
            batch_opened = now

        if now - last_heartbeat >= HEARTBEAT_SECONDS:
            log("heartbeat", **STATS.snapshot())
            last_heartbeat = now

        # Handle log rotation: the path now points at a new inode.
        try:
            current_inode = os.stat(CONTAINER_LOG).st_ino
        except FileNotFoundError:
            current_inode = inode
        if current_inode != inode:
            log("log_rotated", old_inode=inode, new_inode=current_inode)
            try:
                handle.close()
            except Exception:  # noqa: BLE001
                pass
            handle = open(CONTAINER_LOG, "r", encoding="utf-8", errors="replace")
            inode = current_inode

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        tail_forever()
    except KeyboardInterrupt:
        log("stopped", reason="interrupt")
