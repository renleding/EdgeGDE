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

    # --- enum wrappers: the defect that lost three collected fields -----------
    #
    # fleet-telemetry's verbose transformer does NOT emit an enum as a bare
    # string. It emits it wrapped under the enum TYPE name, which is the proto
    # `oneof` member: CarType -> {"carType": ...}, SentryMode ->
    # {"sentryModeState": ...}, SpeedLimitWarning -> {"speedAssistLevel": ...}.
    # The dict branch only knew doubleValue/intValue/stringValue/booleanValue/
    # locationValue, so every one of these returned None and was dropped.
    #
    # Observed live: the vehicle sent 14 fields, the relay forwarded 11, and
    # CarType / SentryMode / SpeedLimitWarning were lost silently. These tests
    # use the exact shapes captured from the vehicle payload.

    def test_cartype_enum_wrapper_is_preserved(self):
        # The real payload shape. This is the vehicle MODEL -- losing it meant the
        # admin console had no model to show.
        self.assertEqual(
            relay.transform_datum("CarType", {"carType": "CarTypeModel3"}),
            {"stringValue": "CarTypeModel3"},
        )

    def test_sentrymode_enum_wrapper_is_preserved(self):
        self.assertEqual(
            relay.transform_datum("SentryMode", {"sentryModeState": "SentryModeStateOff"}),
            {"stringValue": "SentryModeStateOff"},
        )

    def test_speedlimitwarning_enum_wrapper_is_preserved(self):
        self.assertEqual(
            relay.transform_datum(
                "SpeedLimitWarning", {"speedAssistLevel": "SpeedAssistLevelNone"}
            ),
            {"stringValue": "SpeedAssistLevelNone"},
        )

    def test_enum_wrapper_with_numeric_value_is_int(self):
        # An enum delivered as an ordinal rather than a label must survive as an
        # int rather than being dropped for not being a string.
        self.assertEqual(
            relay.transform_datum("Gear", {"gear": 3}), {"intValue": 3}
        )

    def test_multi_key_dict_is_not_treated_as_an_enum(self):
        # Guard the general rule against swallowing the location object.
        self.assertIsNone(
            relay.transform_datum("Weird", {"a": "x", "b": "y"})
        )

    def test_enum_fields_are_real_field_keys_not_enum_type_names(self):
        # The set listed enum TYPE names ("SentryModeState", "SpeedAssistLevel",
        # "ShiftState", ...) none of which are field keys, while omitting the real
        # ones. Pin the entries that matter so they cannot regress.
        for key in ("CarType", "SentryMode", "SpeedLimitWarning"):
            self.assertIn(key, relay.ENUM_FIELDS, f"{key} is a field key and must be listed")
        for type_name in ("SentryModeState", "SpeedAssistLevel", "ShiftState"):
            self.assertNotIn(
                type_name,
                relay.ENUM_FIELDS,
                f"{type_name} is an enum TYPE name, not a field key",
            )

    def test_every_collected_enum_field_is_classifiable(self):
        # The class-level guard: each collected enum-typed field, in its real
        # wrapped shape, must classify. Adding a collected enum without handling
        # its wrapper should fail here rather than silently at runtime.
        collected_enum_shapes = {
            "CarType": {"carType": "CarTypeModel3"},
            "SentryMode": {"sentryModeState": "SentryModeStateOff"},
            "SpeedLimitWarning": {"speedAssistLevel": "SpeedAssistLevelNone"},
        }
        for key, shape in collected_enum_shapes.items():
            with self.subTest(field=key):
                self.assertIsNotNone(
                    relay.transform_datum(key, shape),
                    f"collected field {key} would be dropped as unmapped",
                )

    def test_every_collected_field_is_declared_for_loss_escalation(self):
        # COLLECTED_FIELDS drives warn-level logging when a value cannot be
        # classified. It must name every field we collect, or loss stays quiet.
        for key in (
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
        ):
            self.assertIn(key, relay.COLLECTED_FIELDS)

    def test_location_dict_is_wrapped(self):
        value = {"latitude": -33.86, "longitude": 151.21}
        self.assertEqual(relay.transform_datum("Location", value), {"locationValue": value})

    def test_multi_key_dict_with_scalars_is_refused(self):
        # The guard is about AMBIGUOUS STRUCTURE, not about single scalars. A
        # multi-key dict is a genuinely different shape (the location object is
        # handled separately above) and must not be guessed at.
        #
        # A single-key dict holding a scalar is, by contrast, the enum shape in
        # this protocol -- see the enum-wrapper tests above. This test previously
        # used {"somethingElse": 1} and asserted None, which became wrong once the
        # enum wrapper was handled: that shape is indistinguishable from
        # {"gear": 3}, a real enum ordinal. Being permissive here is safe because
        # Tier 1 is the gate -- resolveTiers()/normalise() drop any field that is
        # not catalogued and collected -- so the relay classifying more shapes
        # cannot manufacture stored data.
        self.assertIsNone(relay.transform_datum("Weird", {"somethingElse": "x", "other": 2}))

    def test_single_key_scalar_dict_is_enum_shaped_and_accepted(self):
        # Documents the rule the change above rests on, so the two are read
        # together: one key with a scalar value is how enums arrive.
        self.assertEqual(relay.transform_datum("Gear", {"gear": 3}), {"intValue": 3})
        self.assertEqual(
            relay.transform_datum("SomeEnum", {"someEnumType": "SomeValue"}),
            {"stringValue": "SomeValue"},
        )

    def test_unrecognised_dict_returns_none(self):
        # A nested/opaque dict is still refused rather than coerced.
        self.assertIsNone(relay.transform_datum("Weird", {"nested": {"a": 1}}))

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
