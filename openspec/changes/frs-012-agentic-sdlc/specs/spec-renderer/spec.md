# Capability: Spec Renderer

## ADDED Requirements

### Requirement: AGS-S01: The renderer SHALL produce HTML from markdown specs

`render_from_markdown()` SHALL return a `RenderResult` with the full HTML document, extracted title, and section list.

#### Scenario: FRS-012 renders with title and sections
- Given: `docs/FRS-012-agentic-sdlc-v1.md`
- When: rendered
- Then: `title` SHALL be the document's H1
- And: `sections` SHALL contain 9 entries
- And: `html` SHALL be a complete HTML document

### Requirement: AGS-S02: The HTML SHALL include a table of contents

The rendered HTML SHALL embed a TOC with anchors to every extracted section.

#### Scenario: TOC links to sections
- Given: a spec with an `## Acceptance criteria` section
- When: rendered
- Then: the TOC SHALL contain an anchor link to `acceptance-criteria`

### Requirement: AGS-S03: Rendered output SHALL match its source

The HTML SHALL be generated from the same markdown source as the text spec — updating the markdown and re-rendering SHALL update the HTML (no drift).

#### Scenario: Re-render reflects edits
- Given: a rendered spec artifact
- When: the markdown is edited and re-rendered
- Then: the new HTML SHALL contain the edited text
- And: the old text SHALL be absent