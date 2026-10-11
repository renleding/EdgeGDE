"""
Unit tests for MitmproxyClient (Phase 1 of APA mitmproxy layer).

Uses unittest.mock to avoid launching a real daemon in CI.
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mitmproxy_client import (
    MitmproxyClient,
    install_ca_into_cft,
    MITMPROXY_CA_CERT,
)


class TestMitmproxyClientInit(unittest.IsolatedAsyncioTestCase):
    async def test_default_port(self):
        client = MitmproxyClient()
        self.assertEqual(client.port, 8080)

    async def test_custom_port(self):
        client = MitmproxyClient(port=9090)
        self.assertEqual(client.port, 9090)

    async def test_context_manager(self):
        with mock.patch.object(MitmproxyClient, "start") as mock_start, \
             mock.patch.object(MitmproxyClient, "stop") as mock_stop:
            async with MitmproxyClient() as client:
                mock_start.assert_called_once()
            mock_stop.assert_called_once()


class TestHARCorrelation(unittest.IsolatedAsyncioTestCase):
    async def test_correlate_empty(self):
        client = MitmproxyClient()
        result = client.correlate("nonexistent_frame")
        self.assertEqual(result, [])

    async def test_correlate_returns_entries(self):
        client = MitmproxyClient()
        entry = {"request": {"method": "GET"}, "_cdp_frame_id": "F123"}
        client._frame_id_map["F123"] = [entry]
        result = client.correlate("F123")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["_cdp_frame_id"], "F123")

    async def test_get_all_har(self):
        client = MitmproxyClient()
        client._har_entries = [{"request": {"method": "GET"}}]
        result = client.get_all_har()
        self.assertEqual(len(result), 1)


class TestHARSummary(unittest.IsolatedAsyncioTestCase):
    async def test_empty_summary(self):
        client = MitmproxyClient()
        summary = client.get_har_summary()
        self.assertEqual(summary["total_entries"], 0)
        self.assertEqual(summary["unique_frame_ids"], 0)

    async def test_summary_with_entries(self):
        client = MitmproxyClient()
        client._har_entries = [
            {
                "request": {"method": "GET", "bodySize": 100},
                "response": {"status": 200, "bodySize": 200},
            },
            {
                "request": {"method": "POST", "bodySize": 50},
                "response": {"status": 201, "bodySize": 300},
            },
        ]
        client._frame_id_map = {"F1": [], "F2": []}
        summary = client.get_har_summary()
        self.assertEqual(summary["total_entries"], 2)
        self.assertEqual(summary["by_method"]["GET"], 1)
        self.assertEqual(summary["by_method"]["POST"], 1)
        self.assertEqual(summary["by_status"][200], 1)
        self.assertEqual(summary["by_status"][201], 1)
        self.assertEqual(summary["total_bytes"], 650)
        self.assertEqual(summary["unique_frame_ids"], 2)


class TestAddonWriting(unittest.IsolatedAsyncioTestCase):
    async def test_embedded_addon_is_valid_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            addon_path = Path(tmp) / "mitmproxy_addon.py"
            client = MitmproxyClient()
            client._write_embedded_addon(addon_path)
            content = addon_path.read_text()
            self.assertIn("class FrameIDCorrelator", content)
            self.assertIn('flow.request.headers.get("X-CDP-Frame-ID")', content)
            # Syntax check
            compile(content, str(addon_path), "exec")


class TestCAInstall(unittest.IsolatedAsyncioTestCase):
    async def test_install_ca_into_cft_success(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(return_value={"result": {}})
        result = await install_ca_into_cft(mock_cdp)
        self.assertTrue(result)
        mock_cdp.send.assert_called_once_with(
            "Security.setIgnoreCertificateErrors", {"ignore": True}
        )

    async def test_install_ca_into_cft_failure(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(side_effect=Exception("CDP error"))
        result = await install_ca_into_cft(mock_cdp)
        self.assertFalse(result)


if __name__ == "__main__":
    unittest.main()