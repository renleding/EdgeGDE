"""
Verification Runner (FRS-012 FEATURE-03)

Executes verification_criteria and returns deterministic pass/fail.
Agents run this to self-validate before reporting success.

Contract:
- Accepts a verification_criteria object
- Returns VerificationResult: status (pass|fail), criterion, result, timestamp
- MUST be deterministic — same inputs -> same result (F03-R02)

Usage:
    from droid.verification_runner import VerificationRunner, VerificationCriteria
    runner = VerificationRunner()
    criteria = VerificationCriteria(
        type="test_command",
        command="npx vitest run --testNamePattern='Configurator'",
        expected={"exit_code": 0},
    )
    result = runner.run(criteria)
    print(result.status, result.result)
"""

import hashlib
import json
import logging
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("droid.verification_runner")


@dataclass
class VerificationCriteria:
    type: str  # test_command | script | http_check | state_check
    command: Optional[str] = None
    script: Optional[str] = None
    endpoint: Optional[str] = None
    path: Optional[str] = None
    expected: dict[str, Any] = field(default_factory=dict)
    timeout: int = 300

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "command": self.command,
            "script": self.script,
            "endpoint": self.endpoint,
            "path": self.path,
            "expected": self.expected,
            "timeout": self.timeout,
        }

    def criterion_key(self) -> str:
        return hashlib.sha256(
            json.dumps(self.to_dict(), sort_keys=True).encode()
        ).hexdigest()


@dataclass
class VerificationResult:
    status: str  # "pass" | "fail"
    criterion: dict[str, Any]
    result: dict[str, Any]
    timestamp: str

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "criterion": self.criterion,
            "result": self.result,
            "timestamp": self.timestamp,
        }


def _check_condition(actual: Any, expected: Any) -> bool:
    """Evaluate a structured condition against actual value."""
    if isinstance(expected, dict):
        # Dict-level comparison first: every key in expected must match
        # the corresponding field in actual. This is the primary path for
        # test_command results ({exit_code: 0}) and state_check results
        # ({exists: true}) where actual is itself a dict.
        if isinstance(actual, dict):
            for key, val in expected.items():
                if key not in actual:
                    return False
                if not _check_condition(actual[key], val):
                    return False
            return True
        # Scalar actual: contains / exists / not_exists apply to the
        # scalar value itself (e.g. a path string from a state check).
        if "contains" in expected:
            return expected["contains"] in str(actual)
        if "exists" in expected:
            return Path(str(actual)).exists() == bool(expected["exists"])
        if "not_exists" in expected:
            return not Path(str(actual)).exists()
        return False
    return actual == expected


class VerificationRunner:
    """Runs verification criteria and returns deterministic pass/fail."""

    def run(self, criteria: VerificationCriteria) -> VerificationResult:
        ts = datetime.now(timezone.utc).isoformat()
        try:
            if criteria.type == "test_command":
                return self._run_test_command(criteria, ts)
            elif criteria.type == "script":
                return self._run_script(criteria, ts)
            elif criteria.type == "http_check":
                return self._run_http_check(criteria, ts)
            elif criteria.type == "state_check":
                return self._run_state_check(criteria, ts)
            else:
                return VerificationResult(
                    status="fail",
                    criterion=criteria.to_dict(),
                    result={"error": f"unknown criteria type: {criteria.type}"},
                    timestamp=ts,
                )
        except Exception as e:
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": str(e)},
                timestamp=ts,
            )

    def _run_test_command(self, criteria: VerificationCriteria, ts: str) -> VerificationResult:
        if not criteria.command:
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": "test_command requires 'command'"},
                timestamp=ts,
            )
        try:
            proc = subprocess.run(
                criteria.command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=criteria.timeout,
            )
            result = {
                "exit_code": proc.returncode,
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
                "stderr": proc.stderr[-5000:] if proc.stderr else "",
            }
        except subprocess.TimeoutExpired:
            result = {"error": f"timeout after {criteria.timeout}s"}
        except Exception as e:
            result = {"error": str(e)}

        status = "pass" if _check_condition(result, criteria.expected) else "fail"
        return VerificationResult(
            status=status,
            criterion=criteria.to_dict(),
            result=result,
            timestamp=ts,
        )

    def _run_script(self, criteria: VerificationCriteria, ts: str) -> VerificationResult:
        if not criteria.script:
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": "script requires 'script' path"},
                timestamp=ts,
            )
        script_path = Path(criteria.script)
        if not script_path.exists():
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": f"script not found: {criteria.script}"},
                timestamp=ts,
            )
        content = script_path.read_text(errors="replace")
        if content.startswith("#!"):
            interpreter = content.split("\n")[0][2:].strip()
            cmd = f"{interpreter} {criteria.script}"
        elif criteria.script.endswith(".py"):
            cmd = f"python3 {criteria.script}"
        elif criteria.script.endswith(".sh"):
            cmd = f"bash {criteria.script}"
        else:
            cmd = criteria.script

        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=criteria.timeout,
            )
            result = {
                "exit_code": proc.returncode,
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
                "stderr": proc.stderr[-5000:] if proc.stderr else "",
            }
        except subprocess.TimeoutExpired:
            result = {"error": f"timeout after {criteria.timeout}s"}
        except Exception as e:
            result = {"error": str(e)}

        status = "pass" if _check_condition(result, criteria.expected) else "fail"
        return VerificationResult(
            status=status,
            criterion=criteria.to_dict(),
            result=result,
            timestamp=ts,
        )

    def _run_http_check(self, criteria: VerificationCriteria, ts: str) -> VerificationResult:
        if not criteria.endpoint:
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": "http_check requires 'endpoint'"},
                timestamp=ts,
            )
        try:
            req = urllib.request.Request(
                criteria.endpoint,
                headers={"User-Agent": "droid-verification-runner/1.0"},
            )
            with urllib.request.urlopen(req, timeout=criteria.timeout) as resp:
                body = resp.read(5000).decode("utf-8", errors="replace")
                result = {"status": resp.status, "body": body}
        except urllib.error.HTTPError as e:
            body = e.read(5000).decode("utf-8", errors="replace") if e.fp else ""
            result = {"status": e.code, "body": body}
        except Exception as e:
            result = {"error": str(e)}

        status = "pass" if _check_condition(result, criteria.expected) else "fail"
        return VerificationResult(
            status=status,
            criterion=criteria.to_dict(),
            result=result,
            timestamp=ts,
        )

    def _run_state_check(self, criteria: VerificationCriteria, ts: str) -> VerificationResult:
        if not criteria.path:
            return VerificationResult(
                status="fail",
                criterion=criteria.to_dict(),
                result={"error": "state_check requires 'path'"},
                timestamp=ts,
            )
        p = Path(criteria.path)
        exists = p.exists()
        is_file = p.is_file() if exists else False
        is_dir = p.is_dir() if exists else False
        content: Optional[str] = None
        if is_file:
            try:
                content = p.read_text(errors="replace")[:5000]
            except Exception:
                content = None

        result = {
            "exists": exists,
            "is_file": is_file,
            "is_dir": is_dir,
            "content": content,
        }

        status = "pass" if _check_condition(result, criteria.expected) else "fail"
        return VerificationResult(
            status=status,
            criterion=criteria.to_dict(),
            result=result,
            timestamp=ts,
        )
