#!/usr/bin/env python3
"""
Offline end-to-end test of the relay forwarder's loop.

test_relay.py pins the transform. This proves the whole process: a log line
appended to a file is picked up, transformed, and POSTed to the ingest endpoint
with the shared secret -- using a local HTTP server, so no network and no real
Tier 1 and no real secret are involved.

Run:  python3 infra/telemetry-relay/test_relay_loop.py
"""

import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RELAY = os.path.join(HERE, "relay.py")

SECRET = "test-shared-secret"


class CaptureHandler(http.server.BaseHTTPRequestHandler):
    received = []

    def do_POST(self):  # noqa: N802 - stdlib naming
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        CaptureHandler.received.append(
            {
                "path": self.path,
                "secret": self.headers.get("x-ingest-secret"),
                "content_type": self.headers.get("content-type"),
                "body": body,
            }
        )
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"datumsAccepted":2}')

    def log_message(self, *args):  # silence
        pass


class TestForwarderLoop(unittest.TestCase):
    def setUp(self):
        CaptureHandler.received = []
        self.server = http.server.HTTPServer(("127.0.0.1", 0), CaptureHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        self.tmp = tempfile.TemporaryDirectory()
        self.log_path = os.path.join(self.tmp.name, "fleet-telemetry.log")
        open(self.log_path, "w").close()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def start_forwarder(self):
        env = dict(os.environ)
        env.update(
            {
                "INGEST_URL": f"http://127.0.0.1:{self.port}/ingest/telemetry",
                "INGEST_SHARED_SECRET": SECRET,
                "CONTAINER_LOG": self.log_path,
                "FLUSH_INTERVAL_SECONDS": "1",
                "POLL_INTERVAL_SECONDS": "0.1",
                "REQUEST_TIMEOUT_SECONDS": "5",
                "HEARTBEAT_SECONDS": "600",
                # MAX_BATCH_BYTES large enough that the two lines batch together,
                # which is the case under test.
                "MAX_BATCH_BYTES": str(400 * 1024),
            }
        )
        return subprocess.Popen(
            [sys.executable, RELAY],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    def wait_for(self, predicate, timeout=15.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return True
            time.sleep(0.1)
        return False

    def test_line_is_forwarded_with_secret_and_correct_shape(self):
        proc = self.start_forwarder()
        try:
            # Give the forwarder time to open the file and seek to the end.
            time.sleep(1.0)
            line = json.dumps(
                {
                    "activity": True,
                    "level": "info",
                    "msg": "record_payload",
                    "time": "2026-10-02T21:00:00Z",
                    "data": {
                        "Vin": "5YJ3E1EA7KF000001",
                        "CreatedAt": "2026-10-02T21:00:00Z",
                        "IsResend": False,
                        "Odometer": {"doubleValue": 12345.6},
                        "CarType": "model3",
                    },
                }
            )
            with open(self.log_path, "a") as handle:
                handle.write(line + "\n")

            self.assertTrue(
                self.wait_for(lambda: len(CaptureHandler.received) >= 1),
                "forwarder never POSTed the line",
            )
        finally:
            proc.terminate()
            proc.wait(timeout=10)

        request = CaptureHandler.received[0]
        self.assertEqual(request["path"], "/ingest/telemetry")
        self.assertEqual(request["secret"], SECRET, "shared secret missing or wrong")
        self.assertEqual(request["content_type"], "application/json")

        payload = json.loads(request["body"])
        self.assertEqual(payload["vin"], "5YJ3E1EA7KF000001")
        by_key = {d["key"]: d["value"] for d in payload["data"]}
        self.assertEqual(by_key["Odometer"], {"doubleValue": 12345.6})
        self.assertEqual(by_key["CarType"], {"stringValue": "model3"})
        # Metadata must not have been forwarded as telemetry fields.
        self.assertNotIn("Vin", by_key)
        self.assertNotIn("IsResend", by_key)

    def test_multiple_lines_batch_into_one_request(self):
        proc = self.start_forwarder()
        try:
            time.sleep(1.0)
            with open(self.log_path, "a") as handle:
                for mileage in (100.0, 200.0):
                    handle.write(
                        json.dumps(
                            {
                                "activity": True,
                                "level": "info",
                                "msg": "record_payload",
                                "time": "2026-10-02T21:00:00Z",
                                "data": {
                                    "Vin": "5YJ3E1EA7KF000002",
                                    "CreatedAt": "2026-10-02T21:00:00Z",
                                    "Odometer": {"doubleValue": mileage},
                                },
                            }
                        )
                        + "\n"
                    )

            self.assertTrue(
                self.wait_for(lambda: len(CaptureHandler.received) >= 1),
                "forwarder never POSTed",
            )
            # Batched, not one request per line.
            time.sleep(1.5)
        finally:
            proc.terminate()
            proc.wait(timeout=10)

        self.assertEqual(
            len(CaptureHandler.received),
            1,
            "two lines should batch into a single request, got %d" % len(CaptureHandler.received),
        )
        payload = json.loads(CaptureHandler.received[0]["body"])
        # Two envelopes -> the array form Tier 1's extractDatums() handles.
        self.assertIsInstance(payload, list)
        self.assertEqual(len(payload), 2)

    def test_non_data_records_are_not_forwarded(self):
        proc = self.start_forwarder()
        try:
            time.sleep(1.0)
            with open(self.log_path, "a") as handle:
                handle.write(
                    json.dumps(
                        {
                            "activity": True,
                            "level": "info",
                            "msg": "record_connectivity",
                            "time": "2026-10-02T21:00:00Z",
                            "data": {"Vin": "5YJ3E1EA7KF000003", "ConnectionStatus": "connected"},
                        }
                    )
                    + "\n"
                )
            time.sleep(3.0)
        finally:
            proc.terminate()
            proc.wait(timeout=10)

        # Connectivity records carry no telemetry datums; forwarding them would
        # create empty batches that still consume ingest runs.
        self.assertEqual(CaptureHandler.received, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
