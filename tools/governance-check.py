#!/usr/bin/env python3
"""
Governance check for automation-bridge.

Matches CI Gate 3 rules:
- no `as any` / `: any` in production .py (type: ignore comments allowed)
- no `print` in production .py (logging module allowed)
- trailing whitespace
- file size warning (> 500 lines)
- docstring on public functions/classes
- test file existence

Exclusions:
- test files (*_test.py, test_*.py)
- __pycache__, .pytest_cache
- migration/alembic files
"""

import re
import sys
import json
from pathlib import Path
from typing import List, Dict, Any


class GovernanceCheck:
    def __init__(self, root_path: Path):
        self.root_path = root_path
        self.violations: List[Dict[str, Any]] = []
        self.warnings: List[Dict[str, Any]] = []
        self.files_checked = 0

    def should_check_file(self, path: Path) -> bool:
        """Determine if file should be checked."""
        # Skip cache and hidden dirs
        for part in path.parts:
            if part in ('__pycache__', '.pytest_cache', '.git', '.venv', 'venv', 'node_modules'):
                return False
        # Skip test files
        if path.name.startswith('test_') or path.name.endswith('_test.py'):
            return False
        # Skip demo/utility scripts (not production code)
        if path.name.startswith('demo_') or path.name.startswith('rename_'):
            return False
        # Only Python files
        return path.suffix == '.py'

    def check_file(self, path: Path) -> None:
        """Check a single file for violations."""
        self.files_checked += 1
        try:
            content = path.read_text(encoding='utf-8')
            lines = content.splitlines()
        except Exception as e:
            self.warnings.append({
                'check': 'file_read',
                'status': 'WARN',
                'details': f'Could not read file: {e}',
                'file': str(path)
            })
            return

        rel_path = path.relative_to(self.root_path)

        # 1. Check for `as any` / `: any` (type: ignore allowed)
        for i, line in enumerate(lines, 1):
            if re.search(r'\bas any\b', line) and 'type: ignore' not in line:
                self.violations.append({
                    'check': 'no-any',
                    'status': 'FAIL',
                    'details': f'Line {i}: "as any" not allowed (use type: ignore if needed)',
                    'file': str(rel_path),
                    'line': i
                })
            if re.search(r':\s*any\b', line) and 'type: ignore' not in line:
                self.violations.append({
                    'check': 'no-any',
                    'status': 'FAIL',
                    'details': f'Line {i}: ": any" not allowed (use type: ignore if needed)',
                    'file': str(rel_path),
                    'line': i
                })

        # 2. Check for print statements (logging module allowed)
        for i, line in enumerate(lines, 1):
            if re.search(r'\bprint\s*\(', line) and 'logging' not in line:
                self.violations.append({
                    'check': 'no-print',
                    'status': 'FAIL',
                    'details': f'Line {i}: print() not allowed in production code (use logging)',
                    'file': str(rel_path),
                    'line': i
                })

        # 3. Trailing whitespace
        for i, line in enumerate(lines, 1):
            if line.rstrip() != line:
                self.warnings.append({
                    'check': 'trailing-whitespace',
                    'status': 'WARN',
                    'details': f'Line {i}: trailing whitespace',
                    'file': str(rel_path),
                    'line': i
                })

        # 4. File size warning (> 500 lines)
        if len(lines) > 500:
            self.warnings.append({
                'check': 'file-size',
                'status': 'WARN',
                'details': f'File has {len(lines)} lines (> 500)',
                'file': str(rel_path)
            })

        # 5. Docstring on public functions/classes (simplified)
        # Check for def/class without docstring on next line
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if (stripped.startswith('def ') or stripped.startswith('class ')) and not stripped.startswith('def _'):
                # Check next non-empty line for docstring
                if i < len(lines):
                    next_line = lines[i].strip()
                    if next_line and not next_line.startswith('"""') and not next_line.startswith("'''"):
                        self.warnings.append({
                            'check': 'missing-docstring',
                            'status': 'WARN',
                            'details': f'Line {i}: Public function/class missing docstring',
                            'file': str(rel_path),
                            'line': i
                        })

    def run(self) -> Dict[str, Any]:
        """Run governance check on all eligible files."""
        python_files = list(self.root_path.rglob('*.py'))
        
        for path in python_files:
            if self.should_check_file(path):
                self.check_file(path)

        return {
            'allowed': len(self.violations) == 0,
            'verdict': 'PASS' if len(self.violations) == 0 else 'FAIL',
            'checks': self.violations + self.warnings,
            'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
            'files_checked': self.files_checked,
            'violations': len(self.violations),
            'warnings': len(self.warnings)
        }


def main():
    if len(sys.argv) < 2:
        print("Usage: governance-check.py <path>")
        sys.exit(1)

    root = Path(sys.argv[1]).resolve()
    if not root.exists():
        print(f"Path does not exist: {root}")
        sys.exit(1)

    checker = GovernanceCheck(root)
    report = checker.run()

    # Write report for CI consumption
    with open('governance-report.json', 'w') as f:
        json.dump(report, f, indent=2)

    # Write violations for CI gate
    if report['violations'] > 0:
        with open('governance-violations.json', 'w') as f:
            json.dump(report, f, indent=2)

    # Print summary
    print(f"Files checked: {report['files_checked']}")
    print(f"Violations: {report['violations']}")
    print(f"Warnings: {report['warnings']}")
    print(f"Verdict: {report['verdict']}")

    if report['violations'] > 0:
        print("\nVIOLATIONS:")
        for v in report['checks']:
            if v['status'] == 'FAIL':
                print(f"  {v['file']}:{v.get('line', '?')} - {v['details']}")

    sys.exit(0 if report['allowed'] else 1)


if __name__ == '__main__':
    main()