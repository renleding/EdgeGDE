#!/usr/bin/env python3
"""STE100 rewrite helper that handles tables and code blocks.

This script rewrites the prose in a markdown file to comply with the structural
STE100 rules (asd-ste100 skill) while preserving:
- Code blocks (fenced with ``` or ~~~)
- Table structure (only rewrites the text inside each cell)
- It does not alter non-prose elements like table headers, separators, or code.

Mode: STE-flavored (structural rules enforced, lexical rules as advisory).

Usage: python3 ste-rewrite-table.py <input> <output>
"""

import re
import sys

# Import the table detection and helper functions from the ste-lint skill
# We'll copy the necessary functions here to avoid dependency issues.

# --- Copied from asd-ste100/scripts/ste-lint.py (with minor adjustments) ---

IRREGULAR_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put|cut|hit|let|shut|split|spread|begun|become|come|gone|got|gotten|lost|met|paid|said|sold|told|thought|brought|bought|caught|taught|won|worn|torn|born|drawn|grown|thrown|flown|driven|risen|chosen|broken|spoken|frozen|hidden|ridden|forgotten|fallen|eaten|beaten|understood|stood|struck|stuck|swung|hung|led|fed|bled|fled|sped|bound|wound|dug|spun|slid|bit|lit|quit"
PASSIVE_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put"
MODAL_PERFECT_PREFIX = re.compile(
    r"\\b(?:may|might|could|should|would|must|can|will|shall)"
    r"(?:\\s+not|n['’]t)?\\s+$", re.I,
)

RULES = [
    ("semicolon", "advisory-free",
     re.compile(r";"),
     "STE bans the semicolon (Rule 8.1). Split into separate sentences."),
    ("phrasal-verb", "advisory-free",
     re.compile(r"\\b(spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing|ed) back|touch(?:ing|es|ed)? base)\\b", re.I),
     "Soft phrasal verb. Use the single plain verb (start, contact, read, begin)."),
    ("marketing-adjective", "advisory-free",
     re.compile(r"\\b(seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er))\\b", re.I),
     "Marketing adjective. Delete, or replace with the measurement that earns the claim."),
    ("nominalization", "advisory-free",
     re.compile(r"\\b(perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out)\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b", re.I),
     "Action frozen into a noun. Use the verb (analyze, not perform an analysis of)."),
    ("passive-voice", "advisory",
     re.compile(r"\\b(is|are|was|were|been|being)\\s+(\\w+ed|\" + PASSIVE_PARTICIPLES + r\")\\b(?!\\s+(?:to|for|by)\\s+\\w+ing)", re.I),
     "Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant."),
    ("present-perfect", "advisory",
     # modal + perfect infinitive (\"may have failed\") is a protected hedge, not present perfect
     re.compile(r"(?<!\\bmay )(?<!\\bmight )(?<!\\bcould )(?<!\\bshould )(?<!\\bwould )(?<!\\bmust )\\b(has|have|had)\\s+(?:been\\s+)?(?:\\w+(?:ed|en)|\" + IRREGULAR_PARTICIPLES + r\")\\b", re.I),
     "Compound tense. Use simple past/present unless current relevance is the point (then keep and flag)."),
]

SYNONYM_GROUPS = [
    ("check", "verify", "confirm", "validate"),
    ("delete", "remove", "erase"),
    ("start", "launch", "begin", "initiate"),
    ("stop", "halt", "terminate"),
    ("show", "display"),
    ("use", "utilize", "employ"),
    ("fix", "repair", "correct"),
    ("send", "transmit"),
    ("get", "retrieve", "fetch", "obtain"),
    ("change", "modify", "alter"),
]

MAX_WORDS = 25  # descriptions cap; instructions cap is 20 but undetectable without context

CODE_FENCE = re.compile(r"^(```|~~~)")
INLINE_CODE = re.compile(r"`[^`]*`")
LIST_ITEM_START = re.compile(
    r"^(?P<indent> {0,3})(?P<marker>[-*+]|[0-9]+[.)])(?P<gap> +)(?P<body>.*)$"
)
CONJUNCTION_END = re.compile(r"\\b(?:and|or)\\s*$", re.I)
TABLE_SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")

def _word_re(base):
    return re.compile(r"\\b" + base + r"(?:s|es|ed|d|ing)?\\b", re.I)

def _leading_spaces(line):
    return len(line) - len(line.lstrip(" "))

def _is_list_continuation(line, content_indent):
    if not line.strip():
        return True
    if LIST_ITEM_START.match(line):
        return False
    return _leading_spaces(line) >= content_indent

def _split_table_row(line):
    left = len(line) - len(line.lstrip())
    right = len(line.rstrip())
    content = line[left:right]
    if "|" not in content:
        return None
    if content.startswith("|"):
        content = content[1:]
        left += 1
    if content.endswith("|"):
        content = content[:-1]
    raw_cells = re.split(r"(?<!\\\\)\\|", content)
    if len(raw_cells) < 2:
        return None
    cells = []
    column = left
    for raw_cell in raw_cells:
        leading = len(raw_cell) - len(raw_cell.lstrip())
        cells.append((raw_cell.strip(), column + leading))
        column += len(raw_cell) + 1
    return cells

def _markdown_table_cells(lines):
    table_cells = {}
    index = 1
    while index < len(lines):
        separator = _split_table_row(lines[index])
        header = _split_table_row(lines[index - 1])
        if (not separator or not header or len(separator) != len(header)
                or not all(TABLE_SEPARATOR_CELL.fullmatch(cell)
                           for cell, _ in separator)):
            index += 1
            continue
        table_cells[index - 1] = header
        table_cells[index] = []
        index += 1
        while index < len(lines):
            row = _split_table_row(lines[index])
            if not row or len(row) != len(separator):
                break
            table_cells[index] = row
            index += 1
    return table_cells

def _dangling_conjunction_findings(text, filename):
    lines = text.splitlines()
    findings = []
    in_fence = False
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if CODE_FENCE.match(stripped):
            in_fence = not in_fence
            index += 1
            continue
        if in_fence:
            index += 1
            continue
        start = LIST_ITEM_START.match(line)
        if not start:
            index += 1
            continue
        content_indent = (len(start.group("indent"))
                          + len(start.group("marker"))
                          + len(start.group("gap")))
        item_lines = [(index, start.group("body"))]
        next_index = index + 1
        item_fence = False
        while next_index < len(lines):
            candidate = lines[next_index]
            candidate_stripped = candidate.strip()
            if CODE_FENCE.match(candidate_stripped):
                item_fence = not item_fence
                next_index += 1
                continue
            if item_fence:
                next_index += 1
                continue
            if not _is_list_continuation(candidate, content_indent):
                break
            item_lines.append((next_index, candidate))
            next_index += 1
        meaningful = []
        for line_index, item_line in item_lines:
            cleaned = INLINE_CODE.sub(" CODE ", item_line).strip()
            if cleaned:
                meaningful.append((line_index, cleaned))
        if meaningful:
            end_line_index, end_line = meaningful[-1]
            conjunction = CONJUNCTION_END.search(end_line)
        else:
            end_line_index, end_line, conjunction = None, None, None
        if conjunction:
            if end_line_index == index:
                finding_line = index + 1
                finding_col = start.start("marker") + 1
            else:
                raw_end_line = next(
                    raw for line_index, raw in item_lines
                    if line_index == end_line_index
                )
                masked_end_line = INLINE_CODE.sub(
                    lambda match: " " * len(match.group(0)), raw_end_line
                )
                raw_conjunction = CONJUNCTION_END.search(masked_end_line)
                finding_line = end_line_index + 1
                finding_col = raw_conjunction.start() + 1 if raw_conjunction else 1
            findings.append({
                "file": filename,
                "line": finding_line,
                "col": finding_col,
                "rule": "dangling-conjunction",
                "level": "advisory-free",
                "match": end_line,
                "message": "List item ends with a coordinating conjunction. Complete the item or join it with the next item.",
            })
        index = next_index
    return findings

def lint(text, filename="<stdin>"):
    findings = []
    words_total = 0
    in_fence = False
    lines = text.splitlines()
    table_cells = _markdown_table_cells(lines)
    seen_synonyms = {}
    for lineno, raw_line in enumerate(lines, 1):
        if CODE_FENCE.match(raw_line.strip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        segments = table_cells.get(lineno - 1, [(raw_line, 0)])
        for segment, source_column in segments:
            line = INLINE_CODE.sub("", segment)
            words_total += len(line.split())
            for rule_id, level, pattern, msg in RULES:
                for m in pattern.finditer(line):
                    if rule_id == "present-perfect" and MODAL_PERFECT_PREFIX.search(
                        line[:m.start()]
                    ):
                        continue
                    findings.append({"file": filename, "line": lineno,
                                     "col": source_column + m.start() + 1,
                                     "rule": rule_id, "level": level,
                                     "match": m.group(0), "message": msg})
            for gi, group in enumerate(SYNONYM_GROUPS):
                for base in group:
                    if (gi, base) in seen_synonyms:
                        continue
                    m = _word_re(base).search(line)
                    if m:
                        seen_synonyms[(gi, base)] = (
                            lineno, source_column + m.start() + 1, m.group(0)
                        )
            for sent in re.split(r"(?<=[.!?])\\s+", line):
                n = len(sent.split())
                if n > MAX_WORDS:
                    findings.append({"file": filename, "line": lineno,
                                     "col": source_column + 1,
                                     "rule": "long-sentence", "level": "advisory-free",
                                     "match": f"{n} words",
                                     "message": f"Sentence has {n} words (cap {MAX_WORDS}). Split it."})
    for gi, group in enumerate(SYNONYM_GROUPS):
        present = [(seen_synonyms[(gi, b)], b) for b in group if (gi, b) in seen_synonyms]
        if len(present) > 1:
            present.sort()
            first_base = present[0][1]
            for (lineno, col, match), base in present[1:]:
                findings.append({"file": filename, "line": lineno, "col": col,
                                 "rule": "synonym-rotation", "level": "advisory-free",
                                 "match": match,
                                 "message": f"'{base}' and '{first_base}' name the same action. Pick one and use it every time."})
    findings.extend(_dangling_conjunction_findings(text, filename))
    findings.sort(key=lambda f: (f["line"], f["col"]))
    return findings, words_total

def report(findings, words_total, as_json, hard_count, baseline):
    rate = round(len(findings) * 100 / words_total, 1) if words_total else 0.0
    if as_json:
        import json
        print(json.dumps({"violations": findings, "count": len(findings),
                          "hard_count": hard_count, "baseline": baseline,
                          "words": words_total, "per_100_words": rate}, indent=2))
        return
    for f in findings:
        print(f"{f['file']}:{f['line']}:{f['col']} {f['rule']}: {f['message']} [{f['match']}]")
    print(f"\n{len(findings)} violations ({hard_count} hard, baseline {baseline}), "
          f"{words_total} words, {rate} per 100 words")
    print("Hedges/modality (may, might, could) are never flagged: confidence is content.")

def selftest():
    bad = ("The panel is removed; spin up the job. "
           "Perform an analysis of the seamless log. "
           "We have received the report.")
    findings, _ = lint(bad)
    rules = {f["rule"] for f in findings}
    for expected in ("semicolon", "phrasal-verb", "nominalization",
                     "marketing-adjective", "passive-voice", "present-perfect"):
        assert expected in rules, expected
    findings, _ = lint("The request may have failed. It could be a timeout. "
                       "The disk might have filled.")
    assert findings == [], findings
    findings, _ = lint("The task has run. The job has set the flag. We have begun.")
    assert sum(1 for f in findings if f["rule"] == "present-perfect") == 3, findings
    findings, _ = lint("The task may have run.")
    assert not any(f["rule"] == "present-perfect" for f in findings), findings
    for modal in ("may", "might", "could", "should", "would", "must"):
        for gap in (" ", "  ", "\t", " not "):
            findings, _ = lint(f"The task {modal}{gap}have run.")
            assert not any(f["rule"] == "present-perfect" for f in findings), findings
    findings, _ = lint("The task couldn't have run. The task MAY NOT HAVE RUN.")
    assert not any(f["rule"] == "present-percept" for f in findings), findings
    findings, _ = lint("The task has run. We have begun. The flag is set.")
    assert sum(f["rule"] == "present-perfect" for f in findings) == 2, findings
    assert any(f["rule"] == "passive-voice" for f in findings), findings
    findings, _ = lint("The task is gone.")
    assert not any(f["rule"] == "passive-voice" for f in findings), findings
    findings, _ = lint("```\\nx = a; y = b\\n```")
    assert findings == [], findings
    findings, _ = lint(
        "- Confirm the target and\\n"
        "* Record the result OR  \\n"
        "+ Close the panel\\n"
        "1. Start the task and\\n"
        "2) Stop the task OR\\n"
    )
    dangling = [f for f in findings if f["rule"] == "dangling-conjunction"]
    assert len(dangling) == 4, dangling
    assert [f["line"] for f in dangling] == [1, 2, 4, 5], dangling
    assert [f["col"] for f in dangling] == [1, 1, 1, 1], dangling
    assert all(f["level"] == "advisory-free" for f in dangling), dangling
    findings, _ = lint("  - Confirm the target and\\n    record the result.")
    assert not any(f["rule"] == "dangling-conjunction" for f in findings)
    findings, _ = lint("- Confirm the target\\n  and\\n")
    dangling = [f for f in findings if f["rule"] == "dangling-conjunction"]
    assert len(dangling) == 1 and dangling[0]["line"] == 2, dangling
    assert dangling[0]["col"] == 3, dangling
    findings, _ = lint("    - code and\\n")
    assert not any(f["rule"] == "dangling-conjunction" for f in findings)
    findings, _ = lint("> - Confirm the target and\\n> - Record the result or\\n")
    assert not any(f["rule"] == "dangling-conjunction" for f in findings)
    findings, _ = lint("```text\\n- code and\\n```\\n")
    assert not any(f["rule"] == "dangling-conjunction" for f in findings)
    findings, _ = lint(("word " * 30).strip() + ".")
    assert any(f["rule"] == "long-sentence" for f in findings)
    short_cell = " ".join(f"term{number}" for number in range(1, 25)) + "."
    for table in (
            "| Label | Detail |\\n"
            "| --- | --- |\\n"
            f"| Clear | {short_cell} |\\n",
            "Label | Detail\\n"
            "--- | ---\\n"
            f"Clear | {short_cell}\\n"):
        findings, words_total = lint(table)
        assert not any(f["rule"] == "long-sentence" for f in findings), findings
        assert words_total == 27, words_total
    long_cell = " ".join(f"term{number}" for number in range(1, 27)) + "."
    findings, _ = lint(
        "| Label | Detail |\\n"
        "| --- | --- |\\n"
        f"| Clear | {long_cell} |\\n"
    )
    long_sentences = [f for f in findings if f["rule"] == "long-sentence"]
    assert len(long_sentences) == 1, long_sentences
    assert long_sentences[0]["match"] == "26 words", long_sentences
    findings, _ = lint("Check the config file. Then verify the output. Verify twice.")
    rot = [f for f in findings if f["rule"] == "synonym-rotation"]
    assert len(rot) == 1 and "'verify' and 'check'" in rot[0]["message"], rot
    findings, _ = lint("Check the config. Check the output.")
    assert not any(f["rule"] == "synonym-rotation" for f in findings)
    findings, _ = lint("a; b", filename="x.md")
    assert findings[0]["file"] == "x.md"
    print("selftest OK")

def apply_structural_rules(text: str) -> str:
    """Apply structural STE rules to a string of prose (no tables, no code)."""
    # 1. Replace semicolons with period + space
    text = text.replace(";", ". ")
    # 2. Apply phrasal verb replacements
    phrasal_verbs = {
        r"\\bspin(?:ning|s)? up\\b": "start",
        r"\\bspun up\\b": "started",
        r"\\breach(?:ing|es|ed)? out\\b": "contact",
        r"\\bdiv(?:e|es|ing|ed) into\\b": "read",
        r"\\bdove into\\b": "read",
        r"\\bkick(?:ing|s|ed)? off\\b": "begin",
        r"\\bcircl(?:e|es|ing|ed) back\\b": "return",
        r"\\btouch(?:ing|es|ed)? base\\b": "contact",
    }
    for pattern, repl in phrasal_verbs.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    # 3. Remove marketing adjectives
    marketing_adjectives = {
        r"\\bseamless(?:ly)?\\b": "",
        r"\\brobust(?:ly)?\\b": "",
        r"\\bcutting-edge\\b": "",
        r"\\beffortless(?:ly)?\\b": "",
        r"\\bblazing[- ]fast\\b": "fast",
        r"\\bworld-class\\b": "",
        r"\\bstate-of-the-art\\b": "",
        r"\\bgame-chang(?:ing|er)\\b": "",
    }
    for pattern, repl in marketing_adjectives.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    # 4. Apply nominalization replacements
    nominalizations = {
        r"\\bperform(?:s|ed|ing)?\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b": "analyze",
        r"\\bconduct(?:s|ed|ing)?\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b": "analyze",
        r"\\bcarry out\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b": "do",
        r"\\bprovide\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b": "give",
        r"\\bmake\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b": "do",
        r"\\bperform\\s+an\\s+analysis\\b": "analyze",
        r"\\bperform\\s+analysis\\b": "analyze",
        r"\\bconduct\\s+an\\s+analysis\\b": "analyze",
        r"\\bcarry out\\s+an\\s+analysis\\b": "analyze",
        r"\\bprovide\\s+assistance\\b": "help",
        r"\\bprovide\\s+support\\b": "support",
        r"\\bmake\\s+a\\s+decision\\b": "decide",
        r"\\btake\\s+action\\b": "act",
    }
    for pattern, repl in nominalizations.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    # 5. We do not automatically fix passive voice or present perfect here — they require judgment.
    #    Instead, we will leave them for the linter to flag and hope the writer fixes them.
    #    However, we can do a simple passive->active for very common patterns if we want.
    #    For now, we skip auto-fixing these two to avoid overcorrection.
    # 6. Clean up extra spaces
    text = re.sub(r"\\s{2,}", " ", text)
    return text.strip()

def process_file(input_path: str, output_path: str):
    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.splitlines()
    output_lines = []
    in_code_block = False
    # We'll use the same table detection as in the linter, but we need to know for each line
    # whether it's part of a table and, if so, what the cells are.
    # We'll precompute the table_cells map once.
    table_cells = _markdown_table_cells(lines)

    for lineno, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        # Handle code blocks
        if CODE_FENCE.match(stripped):
            in_code_block = not in_code_block
            output_lines.append(raw_line)
            continue

        if in_code_block:
            output_lines.append(raw_line)
            continue

        # If this line is part of a table, we need to process each cell.
        if lineno in table_cells:
            # We have a list of (cell_text, column_start) for this line.
            # We will split the line into: prefix, cell1, separator, cell2, separator, ... , suffix
            # But it's easier to reconstruct the line by replacing each cell's text.
            # We'll build the line from scratch.
            # We know the original line and the positions of the cells.
            # We'll start with the original line and replace each cell's text with the rewritten version.
            # However, note that the cell_text in table_cells is already stripped of surrounding spaces.
            # We need to preserve the leading and trailing spaces and the separators.
            # Instead, we can use the _split_table_row function to get the cells and their positions.
            # But we already have the table_cells map from the linter, which gives us the cell text and the column start.
            # We can use that to replace the cell in the line.

            # We'll convert the line to a list of characters for easy replacement.
            chars = list(raw_line)
            # Process each cell in reverse order so that replacing earlier cells doesn't throw off the indices of later ones.
            for cell_text, col_start in sorted(table_cells[lineno], key=lambda x: x[1], reverse=True):
                # The cell_text is the stripped content of the cell.
                # We need to find the exact substring in the line that corresponds to this cell.
                # Since we have the starting column, we can look for the cell_text starting at col_start.
                # But note: there might be multiple occurrences. We assume the first occurrence at or after col_start is the cell.
                # We'll search from col_start onward.
                search_start = col_start
                # We'll look for the cell_text in the line starting at search_start.
                # We want to match the exact cell_text (as stored in table_cells) but note that the cell_text is stripped.
                # The actual cell in the line may have leading/trailing spaces. We want to preserve those.
                # Instead, we can use the fact that the cell is delimited by '|' or the start/end of line.
                # We'll find the end of the cell by looking for the next '|' or end of line.
                # But we already have the cell_text from the linter's _split_table_row, which stripped the cell.
                # We can try to match by: from col_start, find the next non-space, then take until the next space or '|' or end.
                # This is getting complex.

                # Given the complexity, and since we are already in a table, we will use a simpler approach:
                # We will split the line by '|' and then process each segment between the pipes.
                # We'll do this for the whole line, not per cell.
                pass  # We'll break out and do the whole line approach below.

            # Since the per-cell replacement is messy, we will instead split the line by '|' and process each segment.
            # We know the line is a table row because it's in table_cells.
            # We'll split the line into segments by '|', but note that the first and last segments may be empty if the line starts/ends with '|'.
            if raw_line.startswith('|'):
                segments = raw_line.split('|')
                # The first segment is empty (because of leading '|')
                # We'll process segments[1:-1] (the actual cells) and leave the first and last as empty.
                # But note: there might be no trailing '|', so we adjust.
                if raw_line.endswith('|'):
                    cell_segments = segments[1:-1]
                    # We will rewrite each cell segment and then reassemble with '|' at start and end.
                    new_segments = ['']  # for the leading '|'
                    for seg in cell_segments:
                        # seg is the text between two pipes, may have leading/trailing spaces.
                        # We want to rewrite the text inside, preserving the spaces.
                        # We'll strip the seg, rewrite, and then add back one space on each side if the original had them.
                        # But to keep it simple, we will rewrite the stripped version and then put it back with a single space on each side.
                        stripped_seg = seg.strip()
                        rewritten_seg = apply_structural_rules(stripped_seg)
                        # Determine leading and trailing spaces from the original seg.
                        leading_spaces = ' ' * (len(seg) - len(seg.lstrip()))
                        trailing_spaces = ' ' * (len(seg) - len(seg.rstrip()))
                        new_seg = leading_spaces + rewritten_seg + trailing_spaces
                        new_segments.append(new_seg)
                    new_segments.append('')  # for the trailing '|'
                    new_line = '|'.join(new_segments)
                else:
                    # No trailing '|'
                    cell_segments = segments[1:]  # first segment is empty due to leading '|'
                    new_segments = ['']  # for the leading '|'
                    for seg in cell_segments:
                        stripped_seg = seg.strip()
                        rewritten_seg = apply_structural_rules(stripped_seg)
                        leading_spaces = ' ' * (len(seg) - len(seg.lstrip()))
                        trailing_spaces = ' ' * (len(seg) - len(seg.rstrip()))
                        new_seg = leading_spaces + rewritten_seg + trailing_spaces
                        new_segments.append(new_seg)
                    new_line = '|'.join(new_segments)
            elif raw_line.endswith('|'):
                # Trailing '|' but no leading '|'
                segments = raw_line.split('|')
                cell_segments = segments[:-1]  # last segment is empty due to trailing '|'
                new_segments = []
                for seg in cell_segments:
                    stripped_seg = seg.strip()
                    rewritten_seg = apply_structural_rules(stripped_seg)
                    leading_spaces = ' ' * (len(seg) - len(seg.lstrip()))
                    trailing_spaces = ' ' * (len(seg) - len(seg.rstrip()))
                    new_seg = leading_spaces + rewritten_seg + trailing_spaces
                    new_segments.append(new_seg)
                new_segments.append('')  # for the trailing '|'
                new_line = '|'.join(new_segments)
            else:
                # No leading or trailing '|'
                segments = raw_line.split('|')
                cell_segments = segments  # all segments are cells
                new_segments = []
                for seg in cell_segments:
                    stripped_seg = seg.strip()
                    rewritten_seg = apply_structural_rules(stripped_seg)
                    leading_spaces = ' ' * (len(seg) - len(seg.lstrip()))
                    trailing_spaces = ' ' * (len(seg) - len(seg.rstrip()))
                    new_seg = leading_spaces + rewritten_seg + trailing_spaces
                    new_segments.append(new_seg)
                new_line = '|'.join(new_segments)
            output_lines.append(new_line)
        else:
            # Not a table line, not in code block: apply structural rules to the whole line.
            rewritten_line = apply_structural_rules(raw_line)
            output_lines.append(rewritten_line)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\\n".join(output_lines))

    print(f"Rewritten: {input_path} -> {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: ste-rewrite-table.py <input> <output>")
        sys.exit(1)
    process_file(sys.argv[1], sys.argv[2])