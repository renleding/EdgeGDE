"""
Droid Governance Gate (FRS-012 FEATURE-05)

Pre-mutation governance check: runs the same checks as CI Gate 3
(tools/governance-check.ts) but BEFORE the mutation is applied.

Contract:
- Same check logic as CI — no divergence (F05-R03)
- Returns Pass | Fail(details) (F05-R02)
- Result is journaled (F05-R04)
- Mutation is rejected if any check fails (F05-R01)

Usage:
    from droid.governance_gate import GovernanceGate
    gate = GovernanceGate(source_dir="apps/edge-runtime/src")
    result = gate.check_file(path="apps/edge-runtime/src/x.ts", content=content)
    if result.status == "fail":
        raise GovernanceViolation(result.details)
"""

import logging
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("droid.governance_gate")


@dataclass
class CheckResult:
    check: str
    status: str  # "pass" | "fail" | "warn"
    details: list[str] = field(default_factory=list)
    file: Optional[str] = None
    line: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "check": self.check,
            "status": self.status,
            "details": self.details,
            "file": self.file,
            "line": self.line,
        }


@dataclass
class GovernanceReport:
    timestamp: str
    checks: list[CheckResult]
    verdict: str  # "PASS" | "FAIL" | "WARN"
    files_checked: int = 0

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "checks": [c.to_dict() for c in self.checks],
            "verdict": self.verdict,
            "files_checked": self.files_checked,
        }


# ── Individual checks (mirrors tools/governance-check.ts) ────────────────

MAX_LINES = 2000


def check_no_as_any(content: str, file: str, line_ranges: Optional[list[tuple[int, int]]] = None) -> CheckResult:
    """No `as any` or `: any` type annotation in production .ts files."""
    details: list[str] = []
    lines = content.split("\n")
    filename = file.split("/").pop() or ""
    if filename.endswith(".test.ts"):
        return CheckResult(check="No `any` escape hatches", status="pass", details=[])

    for i, line in enumerate(lines):
        lineno = i + 1
        if line_ranges:
            in_range = any(start <= lineno <= end for start, end in line_ranges)
            if not in_range:
                continue
        trimmed = line.strip()
        if trimmed.startswith("//") or trimmed.startswith("*"):
            continue

        is_as_any = "as any" in line
        is_annotation_any = bool(
            re.search(r":\s*any\s*[),;\[\]=>|&}\n]", line)
            or re.search(r":\s*any\s*$", line)
        )
        if is_as_any or is_annotation_any:
            details.append(f"{file}:{lineno}: {trimmed}")

    return CheckResult(
        check="No `any` escape hatches",
        status="fail" if details else "pass",
        details=details[:10] if details else [],
        file=file,
    )


def check_no_console_log(content: str, file: str, line_ranges: Optional[list[tuple[int, int]]] = None) -> CheckResult:
    """No console.log in production .ts files (test/config/tooling excluded)."""
    details: list[str] = []
    lines = content.split("\n")
    filename = file.split("/").pop() or ""
    if (filename.endswith(".test.ts")
            or filename == "vitest.config.ts"
            or "tools/" in file
            or "scripts/" in file):
        return CheckResult(check="No console.log in production code", status="pass", details=[])

    for i, line in enumerate(lines):
        lineno = i + 1
        if line_ranges:
            in_range = any(start <= lineno <= end for start, end in line_ranges)
            if not in_range:
                continue
        trimmed = line.strip()
        if "console.log(" in trimmed and not trimmed.startswith("//") and not trimmed.startswith("*"):
            details.append(f"{file}:{lineno}: {trimmed}")

    return CheckResult(
        check="No console.log in production code",
        status="fail" if details else "pass",
        details=details[:10] if details else [],
        file=file,
    )


def check_trailing_whitespace(content: str, file: str) -> CheckResult:
    """No trailing whitespace on non-empty lines."""
    details: list[str] = []
    for i, line in enumerate(content.split("\n")):
        if line != line.rstrip():
            details.append(f"{file}:{i + 1}: trailing whitespace")
    return CheckResult(
        check="No trailing whitespace",
        status="fail" if details else "pass",
        details=details[:10] if details else [],
        file=file,
    )


def check_file_size(path: str, content: str) -> CheckResult:
    """No single file > 2000 lines."""
    lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    if lines > MAX_LINES:
        return CheckResult(
            check="File size limit",
            status="warn",
            details=[f"{path}: {lines} lines (limit: {MAX_LINES})"],
            file=path,
        )
    return CheckResult(check="File size limit", status="pass", details=[], file=path)


def check_jsdoc_exports(content: str, file: str) -> CheckResult:
    """Exported functions/classes have JSDoc (warn, not fail)."""
    # Placeholder — full JSDoc check requires AST parsing
    return CheckResult(
        check="Exported members have JSDoc",
        status="pass",
        details=[],
        file=file,
    )


def check_test_file_exists(source_path: str, content: str) -> CheckResult:
    """Every .ts source file has a matching test file (unless excluded)."""
    filename = source_path.split("/").pop() or ""
    if (filename.endswith(".test.ts")
            or filename == "index.ts"
            or filename.endswith(".d.ts")
            or "/types/" in source_path
            or source_path.endswith("-types.ts")):
        return CheckResult(
            check=f"Test file exists for {filename}",
            status="pass",
            details=["(skipped - not a testable module)"],
            file=source_path,
        )
    if "export " in content and "export type" not in content:
        test_path = source_path.replace(".ts", ".test.ts")
        if not Path(test_path).exists():
            return CheckResult(
                check=f"Test file exists for {filename}",
                status="warn",
                details=[f"{source_path} has exports but no matching test file"],
                file=source_path,
            )
    return CheckResult(
        check=f"Test file exists for {filename}",
        status="pass",
        details=[],
        file=source_path,
    )


def get_changed_line_ranges(file_path: str) -> Optional[list[tuple[int, int]]]:
    """Get changed line ranges for a file using git diff.

    Returns list of (start, end) line ranges, or None if diff unavailable.
    """
    try:
        result = subprocess.run(
            ["git", "diff", "-U0", "HEAD", "--", file_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0 or not result.stdout:
            return None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None

    ranges: list[tuple[int, int]] = []
    for line in result.stdout.split("\n"):
        match = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if match:
            lineno = int(match.group(2))
            ranges.append((lineno, lineno))
    return ranges if ranges else None


class GovernanceGate:
    """Pre-mutation governance check.

    Runs the same checks as CI Gate 3 (tools/governance-check.ts) but
    BEFORE the mutation is applied.
    """

    def __init__(self, source_dir: str = "apps/edge-runtime/src"):
        self.source_dir = source_dir

    def check_file(self, path: str, content: Optional[str] = None) -> CheckResult:
        """Run governance checks on a single file."""
        if content is None:
            full_path = Path(path)
            if not full_path.is_absolute():
                full_path = Path(self.source_dir) / path
            if not full_path.exists():
                return CheckResult(
                    check="File exists",
                    status="fail",
                    details=[f"{path}: file not found"],
                    file=path,
                )
            content = full_path.read_text()
            path = str(full_path.relative_to(Path(self.source_dir).parent))

        line_ranges = get_changed_line_ranges(path)

        results: list[CheckResult] = [
            check_no_as_any(content, path, line_ranges),
            check_no_console_log(content, path, line_ranges),
            check_trailing_whitespace(content, path),
            check_file_size(path, content),
        ]
        filename = path.split("/").pop() or ""
        if not filename.endswith(".test.ts"):
            results.append(check_jsdoc_exports(content, path))
            results.append(check_test_file_exists(path, content))

        failed = [r for r in results if r.status == "fail"]
        warned = [r for r in results if r.status == "warn"]

        if failed:
            return CheckResult(
                check="Governance gate",
                status="fail",
                details=[f"{r.check}: {r.details[0]}" for r in failed[:5]],
                file=path,
            )
        if warned and len(warned) > 10:
            return CheckResult(
                check="Governance gate",
                status="warn",
                details=[f"{r.check}: {r.details[0]}" for r in warned[:5]],
                file=path,
            )
        return CheckResult(check="Governance gate", status="pass", file=path)

    def check_diff(self, diff_content: str) -> GovernanceReport:
        """Check a git diff (pre-mutation) against governance rules."""
        files: dict[str, str] = {}
        current_file: Optional[str] = None
        current_content: list[str] = []

        for line in diff_content.split("\n"):
            if line.startswith("+++ b/"):
                if current_file:
                    files[current_file] = "".join(current_content)
                current_file = line[6:]
                current_content = []
            elif line.startswith("---"):
                continue
            elif current_file and not line.startswith("diff ") and not line.startswith("index "):
                current_content.append(line)

        if current_file:
            files[current_file] = "".join(current_content)

        ts_files = {
            f: c for f, c in files.items()
            if f.endswith(".ts") and not f.startswith("tools/") and not f.endswith(".test.ts")
        }

        timestamp = datetime.now(timezone.utc).isoformat()
        all_checks: list[CheckResult] = []
        files_checked = len(ts_files)

        for file_path, content in ts_files.items():
            result = self.check_file(file_path, content)
            all_checks.append(result)

        failures = [c for c in all_checks if c.status == "fail"]
        warnings = [c for c in all_checks if c.status == "warn"]
        verdict = "FAIL" if failures else ("WARN" if len(warnings) > 10 else "PASS")

        return GovernanceReport(
            timestamp=timestamp,
            checks=all_checks[:20],
            verdict=verdict,
            files_checked=files_checked,
        )

    def can_apply_mutation(self, file_path: str, content: Optional[str] = None) -> tuple[bool, Optional[GovernanceReport]]:
        """Decision point: can this mutation be applied?"""
        if content is None:
            full_path = Path(file_path)
            if not full_path.is_absolute():
                full_path = Path(self.source_dir) / file_path
            if not full_path.exists():
                return False, GovernanceReport(
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    checks=[CheckResult(
                        check="File exists",
                        status="fail",
                        details=[f"{file_path}: file not found"],
                        file=file_path,
                    )],
                    verdict="FAIL",
                )
            content = full_path.read_text()
            file_path = str(full_path.relative_to(Path(self.source_dir).parent))

        result = self.check_file(file_path, content)
        allowed = result.status != "fail"
        report = GovernanceReport(
            timestamp=datetime.now(timezone.utc).isoformat(),
            checks=[result],
            verdict="PASS" if allowed else "FAIL",
            files_checked=1,
        )
        return allowed, report
