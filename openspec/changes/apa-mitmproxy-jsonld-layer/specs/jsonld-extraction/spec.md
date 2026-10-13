# Capability: JSON-LD Extraction

## ADDED Requirements

### Requirement: APA-J01: The system SHALL inject a JSON-LD extraction script before page load

The State Engine SHALL register the extraction script via CDP `Page.addScriptToEvaluateOnNewDocument` so it runs before any page script on every navigation.

#### Scenario: Script runs before page scripts
- Given: the extraction script is registered
- When: a page navigation starts
- Then: the script SHALL execute before any page script
- And: the script SHALL have access to the full DOM

#### Scenario: Script survives navigation
- Given: the script is registered once
- When: the page navigates to a new URL
- Then: the script SHALL execute again on the new document

### Requirement: APA-J02: The extraction script SHALL extract all JSON-LD entities

The script SHALL walk `document.querySelectorAll('[itemtype], [property], [typeof]')` and all `<script type="application/ld+json">` elements, producing a normalized entity list.

#### Scenario: Extract schema.org Product
- Given: the page contains `<script type="application/ld+json">` with `@type: Product`
- When: the extraction script runs
- Then: the entity list SHALL contain one entity with `@type: "Product"`

#### Scenario: Extract microdata attributes
- Given: the page contains `<div itemscope itemtype="https://schema.org/Offer">`
- When: the extraction script runs
- Then: the entity list SHALL contain an entity with `@type: "Offer"`

#### Scenario: No entities yields empty list
- Given: the page contains no JSON-LD or microdata
- When: the extraction script runs
- Then: the entity list SHALL be empty

### Requirement: APA-J03: The system SHALL normalize entities to a JSONLDSnapshot

Each extracted entity SHALL be normalized to `{ @context, @type, @id?, properties: Record<string, any> }`. The snapshot SHALL include `extraction_url` and ISO 8601 `timestamp`.

#### Scenario: Entity normalization
- Given: a raw JSON-LD entity with `@context: "https://schema.org"`, `@type: "Offer"`, `price: "875000"`
- When: the system normalizes it
- Then: the normalized entity SHALL have `@context`, `@type`, and `properties.price = "875000"`

#### Scenario: Snapshot metadata
- Given: extraction completes
- When: the snapshot is built
- Then: `extraction_url` SHALL match the page URL
- And: `timestamp` SHALL be ISO 8601 format

### Requirement: APA-J04: The system SHALL recognize Salestrekker custom vocabulary

The extractor SHALL recognize `salestrekker:Deal` and `salestrekker:SecurityProperty` entity types in addition to `schema.org` types.

#### Scenario: Custom vocabulary extraction
- Given: a script tag contains `@type: "salestrekker:Deal"`
- When: extraction runs
- Then: the entity SHALL be extracted with `@type: "salestrekker:Deal"`