"""
Unit tests for JSON-LD Extractor (Phase 2 of APA mitmproxy layer).
"""

import json
import unittest
from unittest import mock

from jsonld_extractor import (
    EXTRACTOR_SCRIPT,
    JSONLDSnapshot,
    JSONLDExtractor,
)


class TestJSONLDSnapshot(unittest.TestCase):
    def test_from_dict(self):
        data = {
            "entities": [{"@type": "Product", "properties": {"name": "Test"}}],
            "extraction_url": "https://example.com",
            "timestamp": "2026-10-11T00:00:00Z",
        }
        snap = JSONLDSnapshot.from_dict(data)
        self.assertEqual(len(snap.entities), 1)
        self.assertEqual(snap.extraction_url, "https://example.com")

    def test_find_by_type(self):
        snap = JSONLDSnapshot(
            entities=[
                {"@type": "Product", "properties": {}},
                {"@type": "Offer", "properties": {}},
                {"@type": "salestrekker:Deal", "properties": {}},
            ],
            extraction_url="",
            timestamp="",
        )
        self.assertEqual(len(snap.find_by_type("Product")), 1)
        self.assertEqual(len(snap.find_by_type("Offer")), 1)
        self.assertEqual(len(snap.find_by_type("Deal")), 1)
        self.assertEqual(len(snap.find_by_type("Nonexistent")), 0)

    def test_find_property(self):
        snap = JSONLDSnapshot(
            entities=[
                {"@type": "Product", "properties": {"name": "Widget"}},
                {"@type": "Offer", "properties": {"price": "875000"}},
            ],
            extraction_url="",
            timestamp="",
        )
        self.assertEqual(snap.find_property("name"), "Widget")
        self.assertEqual(snap.find_property("price"), "875000")
        self.assertIsNone(snap.find_property("nonexistent"))

    def test_to_dict(self):
        snap = JSONLDSnapshot(
            entities=[{"@type": "Product", "properties": {}}],
            extraction_url="https://example.com",
            timestamp="2026-10-11T00:00:00Z",
        )
        d = snap.to_dict()
        self.assertIn("entities", d)
        self.assertIn("extraction_url", d)
        self.assertIn("timestamp", d)


class TestJSONLDExtractor(unittest.IsolatedAsyncioTestCase):
    async def test_inject_success(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(return_value={"result": {}})
        extractor = JSONLDExtractor(mock_cdp)
        result = await extractor.inject()
        self.assertTrue(result)
        self.assertTrue(extractor.is_injected)
        # Two scripts injected: JSON-LD extractor + frame-ID header injector
        self.assertEqual(mock_cdp.send.call_count, 2)
        # Both calls use Page.addScriptToEvaluateOnNewDocument with a source
        for call in mock_cdp.send.call_args_list:
            self.assertEqual(call.args[0], "Page.addScriptToEvaluateOnNewDocument")
            payload = call.args[1] if len(call.args) > 1 else call.kwargs
            self.assertIn("source", payload)

    async def test_inject_failure(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(side_effect=Exception("CDP error"))
        extractor = JSONLDExtractor(mock_cdp)
        result = await extractor.inject()
        self.assertFalse(result)
        self.assertFalse(extractor.is_injected)

    async def test_extract_with_snapshot(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(return_value={
            "result": {
                "value": {
                    "entities": [{"@type": "Product", "properties": {"name": "Test"}}],
                    "extraction_url": "https://example.com",
                    "timestamp": "2026-10-11T00:00:00Z",
                }
            }
        })
        extractor = JSONLDExtractor(mock_cdp)
        snap = await extractor.extract()
        self.assertEqual(len(snap.entities), 1)
        self.assertEqual(snap.entities[0]["@type"], "Product")

    async def test_extract_empty(self):
        mock_cdp = mock.AsyncMock()
        mock_cdp.send = mock.AsyncMock(return_value={"result": {"value": None}})
        extractor = JSONLDExtractor(mock_cdp)
        snap = await extractor.extract()
        self.assertEqual(len(snap.entities), 0)


class TestExtractorScript(unittest.TestCase):
    def test_script_is_valid_js(self):
        # Basic structural checks — full JS validation needs node
        self.assertIn("window.__extractJSONLD", EXTRACTOR_SCRIPT)
        self.assertIn("application/ld+json", EXTRACTOR_SCRIPT)
        self.assertIn("itemscope", EXTRACTOR_SCRIPT)
        self.assertIn("salestrekker:", EXTRACTOR_SCRIPT)
        self.assertIn("window.addEventListener('load'", EXTRACTOR_SCRIPT)


if __name__ == "__main__":
    unittest.main()