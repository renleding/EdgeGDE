# Capability: Purchase Price (PP) Analysis

## ADDED Requirements

### Requirement: APA-P01: The system SHALL extract purchase price fields from JSON-LD with DOM fallback

The analysis SHALL extract `purchasePrice`, `loanAmount`, `deposit`, `lvr`, `stampDuty`, `lmi`, `legalFees`, `totalCosts` from JSON-LD `Offer`/`RealEstateListing` entities. When JSON-LD is absent or incomplete, the system SHALL fall back to DOM extraction via the Resolver.

#### Scenario: Extract from JSON-LD Offer
- Given: a JSONLDSnapshot with `@type: Offer` and `priceSpecification.price = 875000`
- When: `analyze_pp` runs
- Then: `extracted.purchasePrice` SHALL equal `875000`
- And: `extracted.source` SHALL be `"jsonld"`

#### Scenario: DOM fallback when JSON-LD missing
- Given: a JSONLDSnapshot with no `Offer` entity
- And: a StateSnapshot containing a visible price element with text "$875,000"
- When: `analyze_pp` runs
- Then: `extracted.purchasePrice` SHALL equal `875000`
- And: `extracted.source` SHALL be `"dom"`

### Requirement: APA-P02: The system SHALL load lender criteria from JSON configs

The analysis SHALL load per-lender criteria from `lender_criteria/*.json`. Each config SHALL define `max_lvr`, `postcode_blacklist`, and `fee_schedule`.

#### Scenario: Load lender config
- Given: `lender_criteria/cba.json` exists with `max_lvr: 0.8`
- When: the loader runs for lender `"cba"`
- Then: the loaded criteria SHALL contain `max_lvr = 0.8`

#### Scenario: Missing lender config
- Given: no `lender_criteria/foo.json` exists
- When: the loader runs for lender `"foo"`
- Then: the loader SHALL raise a `LenderConfigNotFoundError`

### Requirement: APA-P03: The system SHALL validate LVR against lender criteria

The analysis SHALL compute `lvr = loanAmount / purchasePrice` and reject loans exceeding the lender's `max_lvr`.

#### Scenario: LVR within limit passes
- Given: `purchasePrice = 875000`, `loanAmount = 700000` (LVR 0.8)
- And: lender `max_lvr = 0.8`
- When: validation runs
- Then: the result SHALL contain no LVR warning

#### Scenario: LVR exceeds limit fails
- Given: `purchasePrice = 875000`, `loanAmount = 750000` (LVR 0.857)
- And: lender `max_lvr = 0.8`
- When: validation runs
- Then: the result SHALL contain a warning with `"LVR exceeds max_lvr"`

### Requirement: APA-P04: The system SHALL validate postcode against blacklist

The analysis SHALL extract the property postcode from the JSON-LD `PostalAddress` or DOM and reject blacklisted postcodes.

#### Scenario: Blacklisted postcode rejected
- Given: property postcode `2000`
- And: lender `postcode_blacklist` contains `2000`
- When: validation runs
- Then: the result SHALL contain a warning with `"postcode blacklisted"`

#### Scenario: Allowed postcode passes
- Given: property postcode `2000`
- And: lender `postcode_blacklist` is empty
- When: validation runs
- Then: the result SHALL contain no postcode warning

### Requirement: APA-P05: The system SHALL validate fees against the lender fee schedule

The analysis SHALL compute expected `stampDuty`, `lmi`, and `legalFees` from the lender `fee_schedule` and flag any variance greater than 5% between extracted and expected values.

#### Scenario: Fee variance within tolerance
- Given: extracted `stampDuty = 35000`
- And: expected `stampDuty = 35200` (variance 0.57%)
- When: fee validation runs
- Then: the result SHALL contain no fee warning

#### Scenario: Fee variance exceeds tolerance
- Given: extracted `stampDuty = 35000`
- And: expected `stampDuty = 40000` (variance 14.3%)
- When: fee validation runs
- Then: the result SHALL contain a warning with `"stampDuty variance > 5%"`

### Requirement: APA-P06: The system SHALL produce a confidence score

The analysis SHALL produce `confidence` in `[0.0, 1.0]`. JSON-LD-sourced values SHALL score higher than DOM-fallback values. Missing fields SHALL lower the score.

#### Scenario: Full JSON-LD yields high confidence
- Given: all 8 PP fields extracted from JSON-LD
- When: `analyze_pp` completes
- Then: `confidence` SHALL be >= 0.9

#### Scenario: DOM fallback yields lower confidence
- Given: all 8 PP fields extracted from DOM
- When: `analyze_pp` completes
- Then: `confidence` SHALL be < 0.9

### Requirement: APA-P07: The analysis result SHALL be deterministic

Given identical `JSONLDSnapshot`, `StateSnapshot`, and lender criteria, `analyze_pp` SHALL produce identical `PPAnalysisResult` output.

#### Scenario: Repeated calls produce same result
- Given: a fixed JSONLDSnapshot and StateSnapshot
- When: `analyze_pp` is called twice
- Then: both results SHALL be deep-equal