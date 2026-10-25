#!/usr/bin/env python3
"""Validate the Orca-Resolver bridge contract artifacts.

Checks:
1. Every examples/*.json validates against its schema (request-* vs
   orca-resolver-request.schema.json, response-* vs
   orca-resolver-response.schema.json).
2. Every response-error-* example ALSO validates against
   orca-resolver-error.schema.json.
3. Every examples/invalid/* example FAILS validation against the request schema.
4. mcp-tool.json inputSchema equals the request schema and outputSchema equals
   the response schema (deep equality, no drift).
5. Error code enums agree across the response schema, the standalone error
   schema, and the error-codes.json registry.
6. Every error code in the registry documents retry semantics.

Exit 0 when all checks pass, 1 otherwise. Requires jsonschema>=4.18.
"""
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    sys.exit("jsonschema is required: pip install jsonschema")

BASE = Path(__file__).resolve().parent.parent
SCHEMAS = BASE / "schemas"
EXAMPLES = BASE / "examples"


def load(name):
    return json.loads((SCHEMAS / name).read_text())


def check(label, fn):
    try:
        fn()
        print(f"PASS  {label}")
        return True
    except AssertionError as e:
        print(f"FAIL  {label}: {e}")
        return False


def main():
    req_schema = load("orca-resolver-request.schema.json")
    resp_schema = load("orca-resolver-response.schema.json")
    err_schema = load("orca-resolver-error.schema.json")
    registry = load("error-codes.json")
    tool = json.loads((BASE / "mcp-tool.json").read_text())

    req_val = Draft202012Validator(req_schema, format_checker=FormatChecker())
    resp_val = Draft202012Validator(resp_schema, format_checker=FormatChecker())
    err_val = Draft202012Validator(err_schema, format_checker=FormatChecker())

    failures = []

    # 1-2. Positive examples
    for path in sorted(EXAMPLES.glob("*.json")):
        doc = json.loads(path.read_text())
        name = path.name
        if name.startswith("request-"):
            errs = list(req_val.iter_errors(doc))
            assert not errs, f"{name}: {[e.message for e in errs]}"
        elif name.startswith("response-error-"):
            errs = list(resp_val.iter_errors(doc)) + list(err_val.iter_errors(doc))
            assert not errs, f"{name}: {[e.message for e in errs]}"
        elif name.startswith("response-"):
            errs = list(resp_val.iter_errors(doc))
            assert not errs, f"{name}: {[e.message for e in errs]}"
        else:
            raise AssertionError(f"unclassified example file: {name}")
        print(f"PASS  examples/{name} validates")

    # 3. Negative examples must fail
    for path in sorted((EXAMPLES / "invalid").glob("*.json")):
        doc = json.loads(path.read_text())
        errs = list(req_val.iter_errors(doc))
        assert errs, f"invalid/{path.name} unexpectedly VALID"
        print(f"PASS  examples/invalid/{path.name} correctly rejected ({len(errs)} violation(s))")

    # 4. MCP tool definition consistency
    assert tool["inputSchema"] == req_schema, "mcp-tool.json inputSchema drifted from request schema"
    assert tool["outputSchema"] == resp_schema, "mcp-tool.json outputSchema drifted from response schema"
    print("PASS  mcp-tool.json schemas match schema files (deep equality)")

    # 5. Error code enum agreement
    resp_codes = set(resp_schema["properties"]["error"]["properties"]["code"]["enum"])
    err_codes = set(err_schema["properties"]["error"]["properties"]["code"]["enum"])
    reg_codes = {c["code"] for c in registry["codes"]}
    assert resp_codes == err_codes, f"response/error schema code mismatch: {resp_codes ^ err_codes}"
    assert reg_codes == resp_codes, f"registry/schema code mismatch: {reg_codes ^ resp_codes}"
    print(f"PASS  error codes agree across response schema, error schema, registry ({len(reg_codes)} codes)")

    # 6. Retry semantics completeness
    mandated = {"STALE_NODE", "ELEMENT_NOT_RESOLVABLE", "RESOLVER_TIMEOUT", "ACTION_REJECTED"}
    assert mandated <= reg_codes, f"registry missing mandated codes: {mandated - reg_codes}"
    for c in registry["codes"]:
        assert c["retry_policy"] in {"none", "recapture", "reattach", "backoff"}, c["code"]
        if c["retry_policy"] == "backoff":
            assert c["retry_backoff_ms"], f"{c['code']}: backoff policy needs a ladder"
        assert isinstance(c["retryable"], bool)
        assert c["caller_action"], f"{c['code']}: caller_action missing"
    print("PASS  retry semantics documented for every code")

    # 7. Idempotency + version constants
    assert req_schema["properties"]["schema_version"]["const"] == "1.0.0"
    assert resp_schema["properties"]["schema_version"]["const"] == "1.0.0"
    assert registry["contract_version"] == "1.0.0"
    assert tool["contract"]["version"] == "1.0.0"
    print("PASS  contract version 1.0.0 consistent across all artifacts")

    print("\nAll contract validation checks passed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\nVALIDATION FAILED: {e}")
        sys.exit(1)
