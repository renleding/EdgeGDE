#!/usr/bin/env python3
"""
Tests for the relay forwarder's line transformer (infra/telemetry-relay/relay.py).

The transformer exists because fleet-telemetry's log line is NOT Tier 1's payload
shape, and getting the mapping wrong produces data that looks fine and is wrong.
These tests pin the transform against fixtures built from the fleet-telemetry
source (datastore/simple/transformers/payload.go, datastore/simple/logger.go).

Run:  python3 infra/telemetry-relay/test_relay.py
"""

import importlib.util
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def load_relay():
    spec = importlib.util.spec_from_file_location("relay", os.path.join(HERE, "relay.py"))
    module = importlib.util.module_from_spec(spec)
    # relay.py reads config from the environment at import; give it a dummy secret
    # so importing does not depend on the real one.
    os.environ.setdefault("INGEST_SHARED_SECRET", "test-only")
    spec.loader.exec_module(module)
    return module


relay = load_relay()


def logline(data, msg="record_payload", **extra):
    entry = {
        "activity": True,
        "data": data,
        "level": "info",
        "msg": msg,
        "time": "2026-10-02T21:00:00Z",
    }
    entry.update(extra)
    return json.dumps(entry)


class TestTransformDatum(unittest.TestCase):
    """verbose:true shapes -- what our server_config.json actually produces."""

    def test_double_passes_through_as_object(self):
        self.assertEqual(
            relay.transform_datum("Odometer", {"doubleValue": 12345.6}),
            {"doubleValue": 12345.6},
        )

    def test_int_passes_through(self):
        self.assertEqual(relay.transform_datum("Soc", {"intValue": 55}), {"intValue": 55})

    def test_bool_passes_through(self):
        self.assertEqual(
            relay.transform_datum("SentryMode", {"booleanValue": True}),
            {"booleanValue": True},
        )

    def test_invalid_object_is_preserved_as_invalid(self):
        # Critical: an invalid signal means the vehicle declined to report it.
        # If this became a value, Tier 1 would store a measurement that never
        # happened.
        self.assertEqual(relay.transform_datum("Odometer", {"invalid": True}), {"invalid": True})

    def test_enum_bare_string_is_wrapped_as_stringValue(self):
        # verbose:false output for an enum; also defended in case the flag drifts.
        self.assertEqual(
            relay.transform_datum("CarType", "model3"), {"stringValue": "model3"}
        )

    def test_bare_invalid_sentinel_is_not_a_measurement(self):
        # The literal "<invalid>" is what verbose:false emits for an invalid value.
        # Treating it as text is the exact silent-corruption case.
        self.assertEqual(relay.transform_datum("Odometer", "<invalid>"), {"invalid": True})

    def test_unknown_bare_string_is_reported_not_guessed(self):
        # A non-enum bare string we cannot type-check must not be invented.
        self.assertIsNone(relay.transform_datum("MysteryField", "some-string"))

    def test_location_dict_is_wrapped(self):
        value = {"latitude": -33.86, "longitude": 151.21}
        self.assertEqual(relay.transform_datum("Location", value), {"locationValue": value})

    def test_unrecognised_dict_returns_none(self):
        self.assertIsNone(relay.transform_datum("Weird", {"somethingElse": 1}))

    def test_none_returns_none(self):
        self.assertIsNone(relay.transform_datum("Odometer", None))


class TestLineToPayload(unittest.TestCase):
    def test_transforms_a_realistic_line(self):
        line = logline(
            {
                "Vin": "5YJ3E1EA7KF000001",
                "CreatedAt": "2026-10-02T21:00:00Z",
                "IsResend": False,
                "Odometer": {"doubleValue": 12345.6},
                "CarType": "model3",
                "SelfDrivingMilesSinceReset": {"doubleValue": 400},
            }
        )
        payload = relay.line_to_payload(line)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["vin"], "5YJ3E1EA7KF000001")
        by_key = {d["key"]: d for d in payload["data"]}
        self.assertEqual(by_key["Odometer"]["value"], {"doubleValue": 12345.6})
        self.assertEqual(by_key["CarType"]["value"], {"stringValue": "model3"})
        # Payload metadata must not become telemetry fields.
        self.assertNotIn("Vin", by_key)
        self.assertNotIn("CreatedAt", by_key)
        self.assertNotIn("IsResend", by_key)
        # created_at is carried onto each datum so Tier 1 can order observations.
        self.assertEqual(by_key["Odometer"]["createdAt"], "2026-10-02T21:00:00Z")

    def test_non_data_records_are_skipped(self):
        for msg in ("record_connectivity", "alerts", "some_other_log"):
            self.assertIsNone(relay.line_to_payload(logline({"Vin": "V"}, msg=msg)))

    def test_missing_vin_is_skipped(self):
        # Tier 1 cannot resolve a vehicle or its consent without a VIN; forwarding
        # it would be recorded as unknown_vehicle and consume an ingest run.
        self.assertIsNone(relay.line_to_payload(logline({"Odometer": {"doubleValue": 1}})))

    def test_line_with_no_usable_datums_is_skipped(self):
        self.assertIsNone(relay.line_to_payload(logline({"Vin": "V", "IsResend": False})))

    def test_malformed_json_is_skipped_not_raised(self):
        self.assertIsNone(relay.line_to_payload("{not json"))

    def test_non_object_json_is_skipped(self):
        self.assertIsNone(relay.line_to_payload("[1,2,3]"))

    def test_batch_shapes_match_tier1_extractDatums_expectations(self):
        # Tier 1 reads envelope.vin and envelope.data[].key. A regression here is a
        # 200 response with zero datums accepted -- silent, and therefore pinned.
        line = logline({"Vin": "V1", "Odometer": {"doubleValue": 10}})
        payload = relay.line_to_payload(line)
        self.assertIn("vin", payload)
        self.assertIn("data", payload)
        self.assertIsInstance(payload["data"], list)
        self.assertIsInstance(payload["data"][0]["key"], str)
        self.assertIsInstance(payload["data"][0]["value"], dict)


class TestCounters(unittest.TestCase):
    """Unmapped and skipped work must be counted, never silent."""

    def setUp(self):
        relay.STATS.__init__()

    def test_unmapped_value_is_counted(self):
        relay.line_to_payload(logline({"Vin": "V", "Mystery": "cannot-type"}))
        self.assertEqual(relay.STATS.unmapped, 1)

    def test_skipped_nondata_is_counted(self):
        relay.line_to_payload(logline({"Vin": "V"}, msg="record_connectivity"))
        self.assertEqual(relay.STATS.skipped_nondata, 1)


class TestServerConfig(unittest.TestCase):
    """server_config.json settings that silently destroy telemetry if wrong.

    These are asserted here because the failure is invisible from every other
    vantage point: Tesla still receives and bills the signals, the vehicle still
    connects, and the container still looks healthy -- while the forwarder ships
    nothing and every downstream table stays empty.
    """

    def setUp(self):
        import json as _json
        with open(os.path.join(HERE, "server_config.json"), encoding="utf-8") as fh:
            self.config = _json.load(fh)

    def test_log_level_is_info(self):
        # The logger dispatcher emits each vehicle payload as an INFO-level
        # record_payload line. At `warn` none is written, so the forwarder sees
        # nothing and telemetry is lost after Tesla has already billed for it.
        self.assertEqual(
            self.config["log_level"],
            "info",
            "log_level must be 'info': 'warn' suppresses the record_payload lines "
            "that carry the telemetry the forwarder ships.",
        )

    def test_json_log_enable_is_true(self):
        # The forwarder parses JSONL, not logrus text.
        self.assertIs(self.config["json_log_enable"], True)

    def test_logger_verbose_is_true(self):
        # Sets includeTypes so every value is an object; without it an invalid
        # signal is emitted as the string "<invalid>" and stored as valid text.
        self.assertIs(self.config["logger"]["verbose"], True)

    def test_transmit_decoded_records_is_true(self):
        # Emits JSON rather than protobuf, so the forwarder needs no decoder.
        self.assertIs(self.config["transmit_decoded_records"], True)

    def test_vehicle_data_record_routes_to_logger(self):
        # `V` is the only record type carrying vehicle data.
        self.assertEqual(self.config["records"]["V"], ["logger"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
