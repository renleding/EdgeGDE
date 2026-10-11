"""
Spec Renderer (FRS-012 FEATURE-06)

Render mission specs as HTML/Canvas artifacts for human review.
Single source of truth with text spec — same source, rendered output.

Contract:
- Specs with UI/behavioral impact render as HTML (F06-R01)
- Rendered artifact shows target state: routes, pages, data flow (F06-R02)
- Generated from same source as text spec — no drift (F06-R03)
- Render must not block execution (F01-N02)

Usage:
    from droid.spec_renderer import SpecRenderer
    renderer = SpecRenderer()
    html = renderer.render_from_markdown("docs/FRS-012-agentic-sdlc-v1.md")
    renderer.write(html, "docs/html/mission-42-spec.html")
"""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("droid.spec_renderer")


@dataclass
class RenderResult:
    html: str
    title: str
    sections: list[str]
    timestamp: str


class SpecRenderer:
    """Render mission specs as HTML artifacts.

    DESIGN-LEVEL IMPLEMENTATION.

    Parses markdown spec and produces an HTML page showing:
    - Title and metadata
    - Section headers with TOC
    - Requirements tables
    - Scenario blocks
    - Acceptance criteria
    """

    def __init__(self, base_url: str = ""):
        self.base_url = base_url

    def render_from_markdown(self, path: str) -> RenderResult:
        text = Path(path).read_text(errors="replace")
        return self._render(text, path)

    def _render(self, markdown: str, source_path: str = "") -> RenderResult:
        title = self._extract_title(markdown) or "Untitled Spec"
        sections = self._extract_sections(markdown)
        html = self._build_html(markdown, title, sections, source_path)

        return RenderResult(
            html=html,
            title=title,
            sections=sections,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _extract_title(self, markdown: str) -> str:
        for line in markdown.split("\n"):
            if line.startswith("# ") and not line.startswith("## "):
                return line[2:].strip()
        return ""

    def _extract_sections(self, markdown: str) -> list[str]:
        sections: list[str] = []
        for line in markdown.split("\n"):
            stripped = line.strip()
            if stripped.startswith("## ") and not stripped.startswith("### "):
                sections.append(stripped[3:].strip())
            elif stripped.startswith("# ") and not stripped.startswith("## "):
                sections.append(stripped[2:].strip())
        return sections

    def _markdown_to_html(self, markdown: str) -> str:
        lines = markdown.split("\n")
        result: list[str] = []
        in_table = False

        for line in lines:
            if line.startswith("###### "):
                result.append(f"<h6>{line[7:].strip()}</h6>")
            elif line.startswith("### "):
                result.append(f"<h3>{line[4:].strip()}</h3>")
            elif line.startswith("## "):
                result.append(f"<h2>{line[3:].strip()}</h2>")
            elif line.startswith("# ") and not line.startswith("## "):
                result.append(f"<h1>{line[2:].strip()}</h1>")
            elif line.startswith("|"):
                if not in_table:
                    in_table = True
                    result.append("<table class='spec-table'>")
                if re.match(r"^\|[\s\-:|]+\|$", line):
                    continue
                cells = [c.strip() for c in line.split("|")[1:-1]]
                result.append(
                    "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
                )
            elif line.strip() == "" and in_table:
                in_table = False
                result.append("</table>")
            elif line.startswith("- "):
                result.append(f"<li>{line[2:].strip()}</li>")
            elif line.startswith("* "):
                result.append(f"<li>{line[2:].strip()}</li>")
            elif re.match(r"^\*\*[^*]+\*\*$", line):
                result.append(f"<p><strong>{line[2:-2].strip()}</strong></p>")
            elif line.strip().startswith("```"):
                result.append("</pre>")
            elif line.strip():
                formatted = self._inline_format(line)
                result.append(f"<p>{formatted}</p>")

        if in_table:
            result.append("</table>")

        return "\n".join(result)

    def _inline_format(self, text: str) -> str:
        text = text.replace("**", "<strong>", 1)
        text = text.replace("**", "</strong>", 1)
        text = text.replace("`", "<code>", 1)
        text = text.replace("`", "</code>", 1)
        return text

    def _build_html(
        self, markdown: str, title: str, sections: list[str], source_path: str
    ) -> str:
        body = self._markdown_to_html(markdown)

        toc_items = "\n".join(
            f'<li><a href="#{self._anchor(sec)}">{sec}</a></li>'
            for sec in sections
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{self._escape(title)} — Rendered Spec</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #090909; color: #fff;
           font-family: Arial, Helvetica, sans-serif; line-height: 1.6; }}
  .wrap {{ max-width: 900px; margin: 0 auto; padding: 32px 24px; }}
  h1 {{ font-size: 32px; margin: 0 0 8px; color: #42ff8c; }}
  h2 {{ font-size: 24px; margin: 32px 0 12px; color: #8ab4ff;
         border-bottom: 1px solid #222; padding-bottom: 4px; }}
  h3 {{ font-size: 18px; margin: 24px 0 8px; color: #d5d5d5; }}
  h4 {{ font-size: 16px; margin: 16px 0 6px; }}
  h5 {{ font-size: 14px; margin: 12px 0 4px; }}
  h6 {{ font-size: 13px; margin: 8px 0 4px; color: #8a8a8a; }}
  p {{ margin: 8px 0; color: #d5d5d5; }}
  ul {{ margin: 8px 0; padding-left: 24px; }}
  li {{ color: #d5d5d5; margin: 4px 0; }}
  .spec-table {{ width: 100%; border-collapse: collapse; margin: 12px 0;
                 font-size: 13px; }}
  .spec-table th, .spec-table td {{ padding: 8px 10px; border: 1px solid #222;
                                   text-align: left; vertical-align: top; }}
  .spec-table th {{ background: #151515; color: #8a8a8a;
                    font-weight: 600; text-transform: uppercase;
                    font-size: 11px; letter-spacing: 0.5px; }}
  .spec-table tr:hover td {{ background: #121212; }}
  code {{ background: #1d1d1d; padding: 2px 5px; border-radius: 3px;
         font-family: ui-monospace, Menlo, monospace; font-size: 12px;
         color: #f5c542; }}
  pre {{ background: #151515; padding: 12px; border-radius: 6px;
         overflow-x: auto; font-size: 12px; }}
  a {{ color: #8ab4ff; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .toc {{ background: #151515; padding: 12px 16px; border-radius: 8px;
          margin: 16px 0; font-size: 14px; }}
  .toc h3 {{ margin: 0 0 8px; font-size: 14px; color: #8a8a8a;
             text-transform: uppercase; letter-spacing: 0.5px; }}
  .toc ul {{ margin: 0; padding-left: 18px; }}
  .toc li {{ color: #8ab4ff; }}
  .meta {{ color: #666; font-size: 12px; margin-top: 24px;
           border-top: 1px solid #222; padding-top: 8px; }}
  hr {{ border: none; border-top: 1px solid #222; margin: 24px 0; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>{self._escape(title)}</h1>
  <div class="meta">Rendered from: {self._escape(source_path)}</div>

  <div class="toc">
    <h3>Table of Contents</h3>
    <ul>{toc_items}</ul>
  </div>

  {body}

  <div class="meta">Rendered: {self._escape(
      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))}</div>
</div>
</body>
</html>"""

    def _escape(self, text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def _anchor(self, text: str) -> str:
        return re.sub(r"\s+", "-", text.lower())

    def write(self, result: RenderResult, output_path: str) -> None:
        """Write rendered HTML to a file."""
        Path(output_path).write_text(result.html)
        logger.info("Rendered spec written to %s", output_path)

    def write_from_markdown(self, markdown_path: str, output_path: str) -> None:
        """Convenience: render and write in one call."""
        result = self.render_from_markdown(markdown_path)
        self.write(result, output_path)
