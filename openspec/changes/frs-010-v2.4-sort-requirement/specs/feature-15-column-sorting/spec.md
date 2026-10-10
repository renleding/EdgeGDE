# FEATURE-15: Configurator Column Sorting

## Requirements

### F15-R01: Column sorting SHALL be available on the telemetry configuration table

The telemetry configuration table (config-table) SHALL support ascending and descending sort on every column: Name, Capability, Property, Type, Description, Transport, Tesla Package, and Sampling (s).

#### Scenario: Sort by numeric column
- Given: the operator views the telemetry configurator at global scope
- When: the operator clicks the "Sampling (s)" column header
- Then: the table rows SHALL be sorted by the numeric value of the sampling interval in ascending order
- And: the "Sampling (s)" header SHALL display an ascending indicator (▲)

#### Scenario: Sort by text column
- Given: the operator views the telemetry configurator
- When: the operator clicks the "Name" column header
- Then: the table rows SHALL be sorted alphabetically by the field name in ascending order

#### Scenario: Toggle sort direction
- Given: the table is sorted ascending on "Capability"
- When: the operator clicks the "Capability" header again
- Then: the sort SHALL reverse to descending order
- And: the indicator SHALL change to ▼

#### Scenario: Sort indicator state
- Given: the table is sorted on "Name" ascending
- When: the operator clicks "Type" header
- Then: the "Name" indicator SHALL clear
- And: the "Type" header SHALL display ▲

### F15-R02: Column sorting SHALL be available on the catalog enrolment table

The "Add fields from the Tesla catalog" table (enrol-table) SHALL support sorting on Field, Category, and Description columns.

#### Scenario: Sort enrolment by field
- Given: the operator views the configurator with enrolable fields present
- When: the operator clicks the "Field" column header in the enrolment table
- Then: the enrolment table rows SHALL be sorted alphabetically by field key

### F15-R03: Numeric columns SHALL sort numerically

Columns with numeric content (Sampling (s)) SHALL sort by numeric value, not lexicographic string order.

#### Scenario: Numeric sort
- Given: sampling values of 180, 21600, and 604800 exist in the table
- When: the operator sorts the "Sampling (s)" column ascending
- Then: the rows SHALL appear in the order 180, 21600, 604800 (not lexicographic)

### F15-R04: Sort indicators SHALL be visible

Each sortable column header SHALL display a visible indicator element. The active sort indicator SHALL show ▲ for ascending or ▼ for descending. Inactive indicators SHALL be empty.

#### Scenario: Indicator visibility
- Given: the configurator page loads
- When: no sort has been applied
- Then: all sortable headers SHALL render an empty indicator span
- And: the indicator span SHALL have CSS display:inline-block

### F15-R05: Sorting SHALL be client-side and deterministic

Sorting SHALL execute in the browser without server requests. The same input table SHALL produce the same sorted output for the same column and direction.

#### Scenario: No network request on sort
- Given: the operator clicks a sortable header
- When: the sort executes
- Then: no HTTP request SHALL be made to the server
- And: the page URL SHALL not change

### F15-R06: The sort script SHALL be syntactically valid JavaScript

Every inline script delivered in admin pages SHALL parse without error. This requirement is verified by CI extracting all inline scripts and running a JavaScript syntax check.

#### Scenario: Script syntax validation
- Given: an admin page renders inline script content
- When: CI extracts the script and runs node --check
- Then: the check SHALL exit with code 0
- And: CI SHALL fail if the check exits non-zero

### F15-R07: Click targets SHALL have pointer cursor

Sortable column headers SHALL display a pointer cursor to indicate clickability.

#### Scenario: Pointer cursor
- Given: the operator hovers over a sortable header
- When: the cursor is over the header
- Then: the cursor SHALL be style:pointer

## Non-Functional Requirements

### F15-N01: Performance
Sorting SHALL complete within 50ms for tables up to 500 rows.

### F15-N02: Accessibility
Sortable headers SHALL be reachable via keyboard navigation.