# Mission-Level Drift Dashboards — SigNoz Configuration

**Status:** Panels 4-5 created in SigNoz UI (awaiting lifecycle data to populate)  
**Data source:** `signoz_traces.signoz_index_v3`  
**Prerequisite:** Lifecycle code (FRS-1/3) deployed and producing reconcile/compensate spans

---

## SQL Queries for ClickHouse

### Panel 1: Drift Events Over Time

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL 1 HOUR) AS event_time,
  count() AS drift_events,
  countIf(statusCode = 2) AS compensation_triggers,
  countIf(statusCode = 1) AS warnings
FROM signoz_traces.signoz_index_v3
WHERE spanKind = 2  -- Internal span type for reconcile/drift
  AND spanName LIKE 'mission.reconcile.%'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY event_time
ORDER BY event_time
```

### Panel 2: Actions by Drift Category

```sql
SELECT
  spanName,
  count() AS total,
  countIf(has(tags, 'drift.score')) AS with_drift_score,
  avg(cast(extract(tags, '"drift.score":"?([0-9.]+)"') AS Float64)) AS avg_drift_score
FROM signoz_traces.signoz_index_v3
WHERE spanKind = 2
  AND spanName LIKE 'mission.reconcile.%'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY spanName
ORDER BY total DESC
```

### Panel 3: Compensations by Status

```sql
SELECT
  spanName,
  countIf(statusCode = 1) AS errors,
  countIf(statusCode = 2) AS compensations,
  countIf(has(tags, 'compensation.status')) AS with_status
FROM signoz_traces.signoz_index_v3
WHERE spanKind = 2
  AND (spanName LIKE 'action.compensate.%' OR spanName LIKE 'mission.reconcile.%')
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY spanName
```

### Panel 4: Top Drifted Actions

```sql
SELECT
  extract(tags, '"http.route":"?([^"]+)"') AS action_route,
  count() AS occurrences,
  countIf(statusCode = 2) AS errors,
  countIf(statusCode = 1) AS ok,
  round(countIf(statusCode = 2) / count() * 100, 1) AS error_rate_pct
FROM signoz_traces.signoz_index_v3
WHERE spanKind = 2
  AND spanName LIKE 'action.compensate.%'
  AND timestamp > now() - INTERVAL 7 DAY
  AND action_route != ''
GROUP BY action_route
ORDER BY error_rate_pct DESC
```

### Panel 5: Mission Health Summary

```sql
SELECT
  spanName,
  count() AS total_missions,
  countIf(statusCode = 1) AS healthy,
  countIf(spanName LIKE '%compensated%') AS compensated,
  countIf(spanName LIKE '%failed%') AS failed,
  round(countIf(statusCode = 1) / count() * 100, 1) AS health_pct
FROM signoz_traces.signoz_index_v3
WHERE spanKind = 2
  AND spanName LIKE 'mission.%'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY spanName
ORDER BY total_missions DESC
```

---

## Dashboard Panels (to configure in SigNoz UI)

| Panel | Chart Type | Query | Refresh |
|-------|-----------|-------|---------|
| Drift Events Over Time | Time series (bar) | Panel 1 | 5m |
| Actions by Drift Category | Table | Panel 2 | 5m |
| Compensations by Status | Pie | Panel 3 | 5m |
| Top Drifted Actions | Table (sorted) | Panel 4 | 5m |
| Mission Health Summary | Stat + Table | Panel 5 | 5m |

---

## How to Create in SigNoz

1. Log into `http://localhost:8080` (use the credentials from initial setup)
2. Navigate to **Dashboards** → **New Dashboard**
3. Name it: **EdgeGDE Mission Drift**
4. For each panel above:
   - Click **Add Panel** → **+ Add Query**
   - Select **ClickHouse** as data source
   - Paste the SQL query
   - Choose the chart type
   - Set the time range (default: last 1 hour)
5. Save the dashboard

---

## Variables (Optional)

Add SigNoz dashboard variables for filtering:

| Variable | Type | Query |
|----------|------|-------|
| `service` | Query | `SELECT DISTINCT serviceName FROM signoz_traces.signoz_index_v3 WHERE spanKind = 2` |
| `mission_type` | Query | `SELECT DISTINCT spanName FROM signoz_traces.signoz_index_v3 WHERE spanName LIKE 'mission.%'` |
| `drift_threshold` | Constant | `0.5` |

---

## Verification

After the lifecycle code is deployed and a mission executes:

```sql
-- Check if any reconcile spans exist
SELECT count(), spanName
FROM signoz_traces.signoz_index_v3
WHERE spanName LIKE 'mission.reconcile.%'
GROUP BY spanName
```

Expected: at least 1 row with `mission.reconcile.{missionType}`.

If zero rows, the lifecycle code is either not deployed or not producing OTel spans.
