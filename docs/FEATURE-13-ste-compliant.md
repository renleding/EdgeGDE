# FEATURE-13: Data Export & Scheduled Reporting (STE-compliant)

## Summary

The operator exports telemetry and driver-profile data for all vehicles, a group, or an individual vehicle in CSV, Excel, or PDF format. The operator chooses a time range (hour, week, month, year, all). The operator schedules recurring exports with calendar-style recurrence. Recurrence options: hourly, daily, weekly, monthly, yearly, specific date, or specific weekdays. Email delivers exports. The export file is an attachment. Templated text is configurable. All settings are visible and editable in the admin console.

## Functional Requirements

| ID | Requirement | Must/Should |
|----|-------------|-------------|
| F13-R01 | The platform shall support exporting telemetry and driver-profile data in CSV, Excel (.xlsx), and PDF formats. | Must |
| F13-R02 | Exports shall be scopeable to all vehicles, a group (as defined in FEATURE-12), or an individual vehicle (by VIN). | Must |
| F13-R03 | Exports shall support configurable time ranges: hour (last hour), week (last 7 days), month (last 30 days), year (last 365 days), and all (entire history). | Must |
| F13-R04 | The platform shall support scheduled exports with calendar-style recurrence. Recurrence options: hourly, daily, weekly, monthly, yearly, on a specific date, or on specific days of the week. | Must |
| F13-R05 | Email shall deliver scheduled exports. The export file shall be an attachment. Templated text (subject and body) shall be configurable by the operator. | Must |
| F13-R06 | All export settings (scope, time range, format, schedule, recipients, email template) shall be visible and editable in the admin console. | Must |
| F13-R07 | Scheduled exports shall be audited. Each run shall record the schedule ID, run timestamp, scope, format, row count, file size, delivery status, and any error detail. | Must |
| F13-R08 | A failed scheduled export shall be retried up to 3 times with exponential backoff (5 min, 15 min, 60 min). After all retries are exhausted, the failure is recorded and an alert is sent to the operator. | Should |
| F13-R09 | The export file shall include a header/metadata section recording: generation timestamp (UTC and local), scope (all/group/vehicle), time range, row count, and SHA-256 hash of the data payload for integrity verification. | Must |
| F13-R10 | PDF exports shall include a cover page with the report title, generation timestamp, scope, time range, and a data-quality disclaimer noting any caveats. | Should |

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| F13-N01 | Export generation time: < 30 s for 100,000 rows. < 2 min for 1,000,000 rows. | — |
| F13-N02 | Scheduled export reliability: 99.9% of scheduled runs complete successfully or are retried within the retry window. | — |
| F13-N03 | Email delivery: attachment size < 25 MB (SMTP limit). Larger exports are split into multiple emails with part numbering. | — |
| F13-N04 | Schedule reliability: missed schedules (e.g., during downtime) are detected and run at next opportunity with a "catch-up" flag. | — |
| F13-N05 | Audit completeness: every export run (ad-hoc or scheduled) is recorded in the audit trail with full metadata. | — |

## Acceptance Criteria

```text
AC1: An ad-hoc export for all vehicles, "month" range, CSV format, returns a valid .csv file with correct headers, row count matching the query, and a metadata header row.
AC2: An ad-hoc export for a single vehicle, "week" range, PDF format, returns a valid .pdf with a cover page showing the vehicle VIN, time range, and data-quality disclaimer.
AC3: A scheduled export configured as "daily at 02:00 UTC, CSV, all vehicles, last day" runs at the scheduled time, generates the file, emails it to the configured recipients with the templated subject/body, and records the audit row with status "delivered".
AC4: A scheduled export that fails (e.g., SMTP timeout) is retried 3 times with exponential backoff; after 3 failures the audit record shows "failed" and an alert is sent to the operator.
AC5: An export for a group (FEATURE-12 group scope) returns only the vehicles in that group.
AC6: An export with "all" time range includes all historical data up to the generation timestamp.
AC7: The admin console shows a list of all schedules with their next run time, last run status, and allows editing, enabling, disabling, and deleting each schedule.
AC8: The email template supports placeholders: {{scope}}, {{time_range}}, {{timestamp}}, {{row_count}}, {{file_name}}.
AC9: An export exceeding 25 MB is split into multiple emails with part numbering (Part 1 of N...).
AC10: A missed scheduled run (e.g., due to downtime) is detected on startup and re-run with a "catch-up" flag in the audit record.
```

## Out of Scope

- Editing the field catalog (F03/F08).
- Editing consent.
- Modifying the telemetry configuration (FEATURE-12).
- Real-time streaming exports (the platform is not a live-tracking system).