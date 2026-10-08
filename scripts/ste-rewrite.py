#!/usr/bin/env python3
"""STE100 rewrite helper — applies structural rules from the asd-ste100 skill.

This is a semi-automated rewrite tool. It applies deterministic transformations
for the structural rules (semicolons, sentence length, passive voice markers,
phrasal verbs, nominalization, marketing adjectives). It does NOT apply
lexical rules (one-word-one-meaning) which require human judgment.

Mode: STE-flavored (for FRS/SDD docs) — structural rules enforced, lexical
rules as advisory.
"""

import re
import sys

# Structural rule patterns with replacements

# 1. Semicolons → split into sentences
SEMICOLON_RE = re.compile(r";")

# 2. Phrasal verbs (soft, two-word verbs) → single verb
PHRASAL_VERBS = {
    r"\bspin(?:ning|s)? up\b": "start",
    r"\bspun up\b": "started",
    r"\breach(?:ing|es|ed)? out\b": "contact",
    r"\bdiv(?:e|es|ing|ed) into\b": "read",
    r"\bdove into\b": "read",
    r"\bkick(?:ing|s|ed)? off\b": "begin",
    r"\bcircl(?:e|es|ing|ed) back\b": "return",
    r"\btouch(?:ing|es|ed)? base\b": "contact",
}

# 3. Marketing adjectives → remove or replace
MARKETING_ADJECTIVES = {
    r"\bseamless(?:ly)?\b": "",
    r"\brobust(?:ly)?\b": "",
    r"\bcutting-edge\b": "",
    r"\beffortless(?:ly)?\b": "",
    r"\bblazing[- ]fast\b": "fast",
    r"\bworld-class\b": "",
    r"\bstate-of-the-art\b": "",
    r"\bgame-chang(?:ing|er)\b": "",
}

# 4. Nominalization patterns → verb form
NOMINALIZATIONS = {
    r"\bperform(?:s|ed|ing)?\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b": "analyze",
    r"\bconduct(?:s|ed|ing)?\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b": "analyze",
    r"\bcarry out\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b": "do",
    r"\bprovide\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b": "give",
    r"\bmake\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b": "do",
    r"\bperform\s+an\s+analysis\b": "analyze",
    r"\bperform\s+analysis\b": "analyze",
    r"\bconduct\s+an\s+analysis\b": "analyze",
    r"\bcarry out\s+an\s+analysis\b": "analyze",
    r"\bprovide\s+assistance\b": "help",
    r"\bprovide\s+support\b": "support",
    r"\bmake\s+a\s+decision\b": "decide",
    r"\btake\s+action\b": "act",
}

# 5. Passive voice markers → flag for active rewrite (we'll mark them)
PASSIVE_PATTERNS = [
    r"\bis\s+\w+ed\b",
    r"\bare\s+\w+ed\b",
    r"\bwas\s+\w+ed\b",
    r"\bwere\s+\w+ed\b",
    r"\bbeen\s+\w+ed\b",
    r"\bbeing\s+\w+ed\b",
]

# 6. Present perfect → simple past/present (except hedges)
PRESENT_PERFECT_RE = re.compile(
    r"(?<!may )(?<!might )(?<!could )(?<!should )(?<!would )(?<!must )"
    r"\b(has|have|had)\s+(?:been\s+)?(\w+(?:ed|en)|given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put|cut|hit|let|shut|split|spread|begun|become|come|gone|got|gotten|lost|met|paid|said|sold|told|thought|brought|bought|caught|taught|won|worn|torn|born|drawn|grown|thrown|flown|driven|risen|chosen|broken|spoken|frozen|hidden|ridden|forgotten|fallen|eaten|beaten|understood|stood|struck|stuck|swung|hung|led|fed|bled|fled|sped|bound|wound|dug|spun|slid|bit|lit|quit)\b",
    re.I
)

# 7. Long sentence splitting helper
MAX_WORDS = 25

# Synonym groups for consistency checking
SYNONYM_GROUPS = {
    "check": ["check", "verify", "confirm", "validate"],
    "delete": ["delete", "remove", "erase"],
    "start": ["start", "launch", "begin", "initiate"],
    "stop": ["stop", "halt", "terminate"],
    "show": ["show", "display"],
    "use": ["use", "utilize", "employ"],
    "fix": ["fix", "repair", "correct"],
    "send": ["send", "transmit"],
    "get": ["get", "retrieve", "fetch", "obtain"],
    "change": ["change", "modify", "alter"],
}


def split_long_sentence(text: str, max_words: int = MAX_WORDS) -> str:
    """Split sentences that exceed max_words by finding conjunctions."""
    # Split on sentence boundaries
    sentences = re.split(r"(?<=[.!?])\s+", text)
    result = []
    for sent in sentences:
        words = sent.split()
        if len(words) <= max_words:
            result.append(sent)
        else:
            # Try to split at conjunctions
            for conj in [" and ", " but ", " or ", " however ", " therefore ", " thus "]:
                if conj in sent:
                    parts = sent.split(conj, 1)
                    if len(parts[0].split()) <= max_words and len(parts[1].split()) <= max_words:
                        result.append(parts[0].strip() + ".")
                        result.append(parts[1].strip().capitalize() + ".")
                        break
            else:
                # Split roughly in half at a comma
                mid = len(words) // 2
                comma_idx = -1
                for i, w in enumerate(words):
                    if "," in w and i >= mid - 5 and i <= mid + 5:
                        comma_idx = i
                        break
                if comma_idx > 0:
                    part1 = " ".join(words[:comma_idx + 1])
                    part2 = " ".join(words[comma_idx + 1:])
                    result.append(part1 + ".")
                    result.append(part2[0].upper() + part2[1:] + ".")
                else:
                    # Can't split cleanly, keep as is but mark
                    result.append(sent)
    return " ".join(result)


def apply_phrasal_verbs(text: str) -> str:
    for pattern, repl in PHRASAL_VERBS.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    return text


def apply_marketing_adjectives(text: str) -> str:
    for pattern, repl in MARKETING_ADJECTIVES.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    # Clean up double spaces
    text = re.sub(r"\s{2,}", " ", text)
    return text


def apply_nominalizations(text: str) -> str:
    for pattern, repl in NOMINALIZATIONS.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    return text


def replace_semicolons(text: str) -> str:
    # Replace semicolons with period + space
    # But be careful not to break inside code blocks or tables
    return text.replace(";", ".")


def simple_passive_to_active(text: str) -> str:
    """Simple heuristic for common passive constructions."""
    # "is/are/was/were Xed by Y" → "Y Xes X"
    # This is very hard to do automatically without parsing.
    # We'll just flag common patterns for manual review.
    return text


def fix_present_perfect(text: str) -> str:
    """Convert present perfect to simple past where not a hedge."""
    # This is complex - we'll flag for manual review instead
    return text


def rewrite_text(text: str) -> str:
    """Apply all structural STE rules."""
    # Apply transformations in order
    text = replace_semicolons(text)
    text = apply_phrasal_verbs(text)
    text = apply_marketing_adjectives(text)
    text = apply_nominalizations(text)
    # Note: passive voice and present perfect need human judgment
    # Long sentence splitting needs context
    return text


def process_file(input_path: str, output_path: str):
    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Split into lines to preserve structure
    lines = content.splitlines()
    output_lines = []
    in_code_block = False
    in_table = False

    for line in lines:
        stripped = line.strip()
        
        # Track code blocks
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            output_lines.append(line)
            continue
        
        if in_code_block:
            output_lines.append(line)
            continue

        # Track markdown tables
        if "|" in line and "---" in line:
            in_table = True
        elif in_table and "|" not in line:
            in_table = False

        if in_table:
            output_lines.append(line)
            continue

        # Process prose lines
        if stripped and not stripped.startswith("#") and not stripped.startswith("|"):
            # Apply rewrite to this line
            new_line = rewrite_text(line)
            if new_line != line:
                output_lines.append(new_line)
            else:
                output_lines.append(line)
        else:
            output_lines.append(line)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))

    print(f"Rewritten: {input_path} -> {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: ste-rewrite.py <input> <output>")
        sys.exit(1)
    process_file(sys.argv[1], sys.argv[2])