"""
APA Purchase Price (PP) Analysis — Lender criteria validation.

Extracts purchase price fields from JSON-LD with DOM fallback,
validates against per-lender criteria (LVR, postcode, fees).
Pure function — no side effects, deterministic.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from jsonld_extractor import JSONLDSnapshot
from state_cache import PageSnapshot as StateSnapshot

logger = logging.getLogger('state-engine.pp_analysis')

# Default lender criteria directory
LENDER_CRITERIA_DIR = Path(__file__).parent / "lender_criteria"

# Required PP fields
PP_FIELDS = [
    'purchasePrice',
    'loanAmount',
    'deposit',
    'lvr',
    'stampDuty',
    'lmi',
    'legalFees',
    'totalCosts',
]


class LenderConfigNotFoundError(Exception):
    """Raised when a lender config file is not found."""
    pass


class PPAnalysisResult:
    """Result of PP analysis with extraction, validation, and confidence."""

    def __init__(
        self,
        extracted: Dict[str, Any],
        validation: List[Dict[str, Any]],
        warnings: List[str],
        confidence: float,
    ):
        self.extracted = extracted
        self.validation = validation
        self.warnings = warnings
        self.confidence = max(0.0, min(1.0, confidence))

    def to_dict(self) -> Dict[str, Any]:
        return {
            'extracted': self.extracted,
            'validation': self.validation,
            'warnings': self.warnings,
            'confidence': self.confidence,
        }

    @classmethod
    def empty(cls) -> "PPAnalysisResult":
        return cls(
            extracted={f: None for f in PP_FIELDS},
            validation=[],
            warnings=['No data extracted'],
            confidence=0.0,
        )


class LenderCriteria:
    """Lender-specific validation criteria loaded from JSON."""

    def __init__(self, lender_id: str, data: Dict[str, Any]):
        self.lender_id = lender_id
        self.max_lvr = data.get('max_lvr', 0.8)
        self.postcode_blacklist = set(data.get('postcode_blacklist', []))
        self.fee_schedule = data.get('fee_schedule', {})

    @classmethod
    def load(cls, lender_id: str, criteria_dir: Path = LENDER_CRITERIA_DIR) -> "LenderCriteria":
        """Load lender criteria from JSON file."""
        path = criteria_dir / f"{lender_id}.json"
        if not path.exists():
            raise LenderConfigNotFoundError(f"Lender config not found: {path}")
        data = json.loads(path.read_text())
        return cls(lender_id, data)


def _to_float(value: Any) -> Optional[float]:
    """Convert a JSON-LD value to float, handling strings."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(',', '').replace('$', '').strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def extract_from_jsonld(snapshot: JSONLDSnapshot) -> Dict[str, Any]:
    """Extract PP fields from JSONLDSnapshot."""
    result = {f: None for f in PP_FIELDS}

    # Search for Offer entity (primary source for price)
    offers = snapshot.find_by_type('Offer')
    if offers:
        offer = offers[0]
        props = offer.get('properties', {})

        # Price specification
        price_spec = props.get('priceSpecification', {})
        if isinstance(price_spec, dict):
            result['purchasePrice'] = _to_float(price_spec.get('price') or price_spec.get('value'))
        else:
            result['purchasePrice'] = _to_float(props.get('price') or props.get('amount'))

        # Other Offer fields
        result['loanAmount'] = _to_float(props.get('loanAmount'))
        result['deposit'] = _to_float(props.get('deposit'))
        result['lvr'] = _to_float(props.get('lvr'))

    # Search for RealEstateListing
    listings = snapshot.find_by_type('RealEstateListing')
    if listings and result['purchasePrice'] is None:
        listing = listings[0]
        props = listing.get('properties', {})
        result['purchasePrice'] = _to_float(props.get('price') or props.get('offers', {}).get('price'))

    # Search for Product (fallback)
    products = snapshot.find_by_type('Product')
    if products and result['purchasePrice'] is None:
        product = products[0]
        props = product.get('properties', {})
        offers = props.get('offers', {})
        if isinstance(offers, dict):
            result['purchasePrice'] = _to_float(offers.get('price'))

    # Stamp duty / LMI / legal fees / total costs from Salestrekker vocab
    deals = snapshot.find_by_type('Deal')
    if deals:
        deal = deals[0]
        props = deal.get('properties', {})
        result['stampDuty'] = _to_float(props.get('stampDuty'))
        result['lmi'] = _to_float(props.get('lmi'))
        result['legalFees'] = _to_float(props.get('legalFees'))
        result['totalCosts'] = _to_float(props.get('totalCosts'))

    return result


def extract_from_dom(state: StateSnapshot) -> Dict[str, Any]:
    """Extract PP fields from DOM StateSnapshot (fallback).

    Looks for common Salestrekker DOM patterns.
    """
    result = {f: None for f in PP_FIELDS}

    if not state or not state.body_text:
        return result

    text = state.body_text

    import re

    # Purchase price patterns
    price_patterns = [
        r'purchase\s*price[:\s]*\$?([\d,]+\.?\d*)',
        r'property\s*value[:\s]*\$?([\d,]+\.?\d*)',
        r'\$([\d,]+\.?\d*)\s*(?:purchase|property)',
    ]
    for pat in price_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                result['purchasePrice'] = float(m.group(1).replace(',', ''))
                break
            except ValueError:
                pass

    # Loan amount
    loan_patterns = [
        r'loan\s*amount[:\s]*\$?([\d,]+\.?\d*)',
        r'borrow[:\s]*\$?([\d,]+\.?\d*)',
    ]
    for pat in loan_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                result['loanAmount'] = float(m.group(1).replace(',', ''))
                break
            except ValueError:
                pass

    # Deposit
    dep_patterns = [
        r'deposit[:\s]*\$?([\d,]+\.?\d*)',
        r'down\s*payment[:\s]*\$?([\d,]+\.?\d*)',
    ]
    for pat in dep_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                result['deposit'] = float(m.group(1).replace(',', ''))
                break
            except ValueError:
                pass

    # LVR
    lvr_patterns = [
        r'lvr[:\s]*([\d.]+)%?',
        r'loan\s*to\s*value[:\s]*([\d.]+)%?',
    ]
    for pat in lvr_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1))
                result['lvr'] = val / 100 if val > 1 else val
                break
            except ValueError:
                pass

    # Postcode from address
    postcode_m = re.search(r'\b(\d{4})\b', text)
    if postcode_m:
        result['postcode'] = postcode_m.group(1)

    # Compute missing derived fields
    if result['purchasePrice'] and result['deposit']:
        result['loanAmount'] = result['loanAmount'] or max(0, result['purchasePrice'] - result['deposit'])
    if result['purchasePrice'] and result['loanAmount']:
        result['lvr'] = result['lvr'] or (result['loanAmount'] / result['purchasePrice'])

    return result


def validate_lvr(extracted: Dict[str, Any], criteria: LenderCriteria) -> List[Dict[str, Any]]:
    """Validate LVR against lender criteria."""
    results = []
    purchase = extracted.get('purchasePrice')
    loan = extracted.get('loanAmount')
    if purchase and loan and purchase > 0:
        lvr = loan / purchase
        if lvr > criteria.max_lvr:
            results.append({
                'check': 'lvr',
                'status': 'FAIL',
                'message': f'LVR {lvr:.1%} exceeds max_lvr {criteria.max_lvr:.0%}',
                'actual': lvr,
                'expected_max': criteria.max_lvr,
            })
        else:
            results.append({
                'check': 'lvr',
                'status': 'PASS',
                'message': f'LVR {lvr:.1%} within limit {criteria.max_lvr:.0%}',
            })
    return results


def validate_postcode(extracted: Dict[str, Any], criteria: LenderCriteria) -> List[Dict[str, Any]]:
    """Validate postcode against blacklist."""
    results = []
    postcode = extracted.get('postcode')
    if postcode and postcode in criteria.postcode_blacklist:
        results.append({
            'check': 'postcode',
            'status': 'FAIL',
            'message': f'Postcode {postcode} is blacklisted',
            'actual': postcode,
        })
    else:
        results.append({
            'check': 'postcode',
            'status': 'PASS',
            'message': f'Postcode {postcode or "unknown"} not blacklisted',
        })
    return results


def validate_fees(extracted: Dict[str, Any], criteria: LenderCriteria) -> List[Dict[str, Any]]:
    """Validate extracted fees against lender fee schedule (5% tolerance)."""
    results = []
    fee_schedule = criteria.fee_schedule

    fee_fields = ['stampDuty', 'lmi', 'legalFees', 'totalCosts']
    for field in fee_fields:
        expected = fee_schedule.get(field)
        actual = extracted.get(field)
        if expected is not None and actual is not None and expected > 0:
            variance = abs(actual - expected) / expected
            if variance > 0.05:
                results.append({
                    'check': f'fee_{field}',
                    'status': 'WARN',
                    'message': f'{field} variance {variance:.1%} exceeds 5% (expected {expected}, got {actual})',
                    'actual': actual,
                    'expected': expected,
                    'variance': variance,
                })
            else:
                results.append({
                    'check': f'fee_{field}',
                    'status': 'PASS',
                    'message': f'{field} variance {variance:.1%} within tolerance',
                })
    return results


def compute_confidence(jsonld_result: Dict[str, Any], dom_result: Dict[str, Any]) -> float:
    """Compute confidence score based on source quality and completeness."""
    jsonld_filled = sum(1 for v in jsonld_result.values() if v is not None)
    dom_filled = sum(1 for v in dom_result.values() if v is not None)

    # JSON-LD fields count more
    jsonld_score = min(jsonld_filled / len(PP_FIELDS), 1.0) * 0.7
    dom_score = min(dom_filled / len(PP_FIELDS), 1.0) * 0.3

    # Penalty for completely missing critical fields
    critical = ['purchasePrice', 'loanAmount']
    penalty = 0
    for f in critical:
        if jsonld_result.get(f) is None and dom_result.get(f) is None:
            penalty += 0.15

    return max(0.0, min(1.0, jsonld_score + dom_score - penalty))


def analyze_pp(
    jsonld: JSONLDSnapshot,
    dom: StateSnapshot,
    lender_id: str,
    criteria_dir: Path = LENDER_CRITERIA_DIR,
) -> PPAnalysisResult:
    """
    Main PP analysis entry point.

    Args:
        jsonld: JSONLDSnapshot from JSON-LD extraction
        dom: StateSnapshot from StateCache (for DOM fallback)
        lender_id: Lender identifier (e.g., 'cba', 'anz')
        criteria_dir: Directory containing lender JSON configs

    Returns:
        PPAnalysisResult with extracted fields, validation, warnings, confidence
    """
    # Load lender criteria
    try:
        criteria = LenderCriteria.load(lender_id, criteria_dir)
    except LenderConfigNotFoundError as e:
        logger.warning("Lender config not found: %s", e)
        return PPAnalysisResult(
            extracted={f: None for f in PP_FIELDS},
            validation=[],
            warnings=[str(e)],
            confidence=0.0,
        )

    # Extract from JSON-LD (primary)
    jsonld_extracted = extract_from_jsonld(jsonld)

    # Extract from DOM (fallback)
    dom_extracted = extract_from_dom(dom)

    # Merge: prefer JSON-LD, fall back to DOM
    merged = {}
    for field in PP_FIELDS:
        merged[field] = jsonld_extracted.get(field) if jsonld_extracted.get(field) is not None else dom_extracted.get(field)

    # Add postcode from DOM if available
    if 'postcode' in dom_extracted:
        merged['postcode'] = dom_extracted['postcode']

    # Validate
    all_validations = []
    all_validations.extend(validate_lvr(merged, criteria))
    all_validations.extend(validate_postcode(merged, criteria))
    all_validations.extend(validate_fees(merged, criteria))

    # Collect warnings
    warnings = [v['message'] for v in all_validations if v['status'] in ('FAIL', 'WARN')]

    # Confidence
    confidence = compute_confidence(jsonld_extracted, dom_extracted)

    return PPAnalysisResult(
        extracted=merged,
        validation=all_validations,
        warnings=warnings,
        confidence=confidence,
    )


# Convenience function for multi-lender analysis
def analyze_pp_all_lenders(
    jsonld: JSONLDSnapshot,
    dom: StateSnapshot,
    lender_ids: List[str],
    criteria_dir: Path = LENDER_CRITERIA_DIR,
) -> Dict[str, PPAnalysisResult]:
    """Run PP analysis for multiple lenders."""
    results = {}
    for lender_id in lender_ids:
        try:
            results[lender_id] = analyze_pp(jsonld, dom, lender_id, criteria_dir)
        except Exception as e:
            logger.error("PP analysis failed for %s: %s", lender_id, e)
            results[lender_id] = PPAnalysisResult.empty()
    return results