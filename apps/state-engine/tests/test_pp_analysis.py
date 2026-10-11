"""
Unit tests for PP Analysis (Phase 3 of APA mitmproxy layer).
"""

import json
import unittest
from pathlib import Path
from unittest import mock

from jsonld_extractor import JSONLDSnapshot
from state_cache import PageSnapshot
from pp_analysis import (
    PPAnalysisResult,
    LenderCriteria,
    LenderConfigNotFoundError,
    analyze_pp,
    analyze_pp_all_lenders,
    compute_confidence,
    validate_lvr,
    validate_postcode,
    validate_fees,
    extract_from_jsonld,
    extract_from_dom,
    PP_FIELDS,
)


class TestLenderCriteria(unittest.TestCase):
    def test_load_existing(self):
        criteria = LenderCriteria.load("cba", Path(__file__).parent.parent / "lender_criteria")
        self.assertEqual(criteria.lender_id, "cba")
        self.assertEqual(criteria.max_lvr, 0.8)
        self.assertIn("2000", criteria.postcode_blacklist)

    def test_load_missing(self):
        with self.assertRaises(LenderConfigNotFoundError):
            LenderCriteria.load("nonexistent", Path(__file__).parent / "lender_criteria")


class TestExtractFromJSONLD(unittest.TestCase):
    def test_extract_offer_price(self):
        snap = JSONLDSnapshot(
            entities=[{
                "@type": "Offer",
                "properties": {
                    "priceSpecification": {"price": "875000"},
                    "loanAmount": "700000",
                }
            }],
            extraction_url="https://example.com",
            timestamp="2026-10-11T00:00:00Z",
        )
        result = extract_from_jsonld(snap)
        self.assertEqual(result['purchasePrice'], 875000.0)
        self.assertEqual(result['loanAmount'], 700000.0)

    def test_extract_realestatelisting(self):
        snap = JSONLDSnapshot(
            entities=[{
                "@type": "RealEstateListing",
                "properties": {
                    "price": "875000",
                    "offers": {"price": "875000"}
                }
            }],
            extraction_url="",
            timestamp="",
        )
        result = extract_from_jsonld(snap)
        self.assertEqual(result['purchasePrice'], 875000.0)

    def test_extract_salestrekker_deal(self):
        snap = JSONLDSnapshot(
            entities=[{
                "@type": "salestrekker:Deal",
                "properties": {
                    "stampDuty": 35000,
                    "lmi": 12000,
                    "legalFees": 2000,
                    "totalCosts": 924000,
                }
            }],
            extraction_url="",
            timestamp="",
        )
        result = extract_from_jsonld(snap)
        self.assertEqual(result['stampDuty'], 35000.0)
        self.assertEqual(result['lmi'], 12000.0)


class TestExtractFromDOM(unittest.TestCase):
    def test_extract_from_body_text(self):
        state = PageSnapshot(body_text="Purchase Price: $875,000. Loan Amount: $700,000. Deposit: $175,000. LVR: 80%")
        result = extract_from_dom(state)
        self.assertEqual(result['purchasePrice'], 875000.0)
        self.assertEqual(result['loanAmount'], 700000.0)
        self.assertEqual(result['deposit'], 175000.0)
        self.assertEqual(result['lvr'], 0.8)

    def test_empty_state(self):
        state = PageSnapshot(body_text="")
        result = extract_from_dom(state)
        self.assertEqual(result['purchasePrice'], None)


class TestValidateLVR(unittest.TestCase):
    def test_lvr_pass(self):
        criteria = LenderCriteria("test", {"max_lvr": 0.8})
        extracted = {"purchasePrice": 875000, "loanAmount": 700000}
        results = validate_lvr(extracted, criteria)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['status'], 'PASS')

    def test_lvr_fail(self):
        criteria = LenderCriteria("test", {"max_lvr": 0.8})
        extracted = {"purchasePrice": 875000, "loanAmount": 750000}
        results = validate_lvr(extracted, criteria)
        self.assertEqual(results[0]['status'], 'FAIL')


class TestValidatePostcode(unittest.TestCase):
    def test_postcode_pass(self):
        criteria = LenderCriteria("test", {"postcode_blacklist": ["2000"]})
        extracted = {"postcode": "2001"}
        results = validate_postcode(extracted, criteria)
        self.assertEqual(results[0]['status'], 'PASS')

    def test_postcode_fail(self):
        criteria = LenderCriteria("test", {"postcode_blacklist": ["2000"]})
        extracted = {"postcode": "2000"}
        results = validate_postcode(extracted, criteria)
        self.assertEqual(results[0]['status'], 'FAIL')


class TestValidateFees(unittest.TestCase):
    def test_fee_within_tolerance(self):
        criteria = LenderCriteria("test", {"fee_schedule": {"stampDuty": 35000}})
        extracted = {"stampDuty": 35200}  # 0.57% variance
        results = validate_fees(extracted, criteria)
        self.assertEqual(results[0]['status'], 'PASS')

    def test_fee_exceeds_tolerance(self):
        criteria = LenderCriteria("test", {"fee_schedule": {"stampDuty": 35000}})
        extracted = {"stampDuty": 40000}  # 14.3% variance
        results = validate_fees(extracted, criteria)
        self.assertEqual(results[0]['status'], 'WARN')


class TestComputeConfidence(unittest.TestCase):
    def test_full_jsonld_high_confidence(self):
        jsonld = {f: 1.0 for f in PP_FIELDS}
        dom = {f: None for f in PP_FIELDS}
        conf = compute_confidence(jsonld, dom)
        # 8 fields filled in JSON-LD: 8/8 * 0.7 = 0.7
        self.assertGreaterEqual(conf, 0.7)

    def test_dom_only_lower_confidence(self):
        jsonld = {f: None for f in PP_FIELDS}
        dom = {f: 1.0 for f in PP_FIELDS}
        conf = compute_confidence(jsonld, dom)
        # 8 fields filled in DOM: 8/8 * 0.3 = 0.3
        self.assertLess(conf, 0.5)


class TestAnalyzePP(unittest.IsolatedAsyncioTestCase):
    async def test_full_analysis_cba(self):
        jsonld = JSONLDSnapshot(
            entities=[{
                "@type": "Offer",
                "properties": {"priceSpecification": {"price": "875000"}, "loanAmount": "700000"}
            }],
            extraction_url="https://example.com",
            timestamp="2026-10-11T00:00:00Z",
        )
        dom = PageSnapshot(body_text="Postcode: 2000")
        result = analyze_pp(jsonld, dom, "cba", Path(__file__).parent.parent / "lender_criteria")
        self.assertEqual(result.extracted['purchasePrice'], 875000.0)
        self.assertIn('postcode', result.extracted)
        self.assertTrue(any(v['check'] == 'postcode' and v['status'] == 'FAIL' for v in result.validation))

    async def test_analysis_anz_passes_lvr(self):
        jsonld = JSONLDSnapshot(
            entities=[{"@type": "Offer", "properties": {"priceSpecification": {"price": "875000"}, "loanAmount": "700000"}}],
            extraction_url="", timestamp="",
        )
        dom = PageSnapshot(body_text="")
        result = analyze_pp(jsonld, dom, "anz", Path(__file__).parent.parent / "lender_criteria")
        # ANZ max_lvr=0.85, 700000/875000=0.8 should pass
        self.assertTrue(all(v['status'] == 'PASS' for v in result.validation if v['check'] == 'lvr'))

    async def test_missing_lender_returns_empty(self):
        jsonld = JSONLDSnapshot(entities=[], extraction_url="", timestamp="")
        dom = PageSnapshot(body_text="")
        result = analyze_pp(jsonld, dom, "nonexistent", Path(__file__).parent.parent / "lender_criteria")
        self.assertEqual(result.confidence, 0.0)
        self.assertIn("not found", result.warnings[0])

    async def test_multi_lender(self):
        jsonld = JSONLDSnapshot(entities=[{"@type": "Offer", "properties": {"priceSpecification": {"price": "875000"}}}], extraction_url="", timestamp="")
        dom = PageSnapshot(body_text="")
        results = analyze_pp_all_lenders(jsonld, dom, ["cba", "anz"], Path(__file__).parent.parent / "lender_criteria")
        self.assertIn("cba", results)
        self.assertIn("anz", results)


class TestPPAnalysisResult(unittest.TestCase):
    def test_to_dict(self):
        result = PPAnalysisResult(
            extracted={"purchasePrice": 875000},
            validation=[{"check": "lvr", "status": "PASS"}],
            warnings=[],
            confidence=0.95,
        )
        d = result.to_dict()
        self.assertIn("extracted", d)
        self.assertIn("validation", d)
        self.assertIn("warnings", d)
        self.assertIn("confidence", d)

    def test_confidence_bounds(self):
        result = PPAnalysisResult(
            extracted={}, validation=[], warnings=[], confidence=1.5
        )
        self.assertEqual(result.confidence, 1.0)

        result2 = PPAnalysisResult(extracted={}, validation=[], warnings=[], confidence=-0.5)
        self.assertEqual(result2.confidence, 0.0)


if __name__ == "__main__":
    unittest.main()