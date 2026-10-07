/**
 * A D1 double backed by REAL SQLite, with the real migrations applied.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin tests used `prepare: vi.fn().mockReturnThis()` — a double that accepts ANY SQL
 * string. A column that does not exist is therefore indistinguishable from one that does,
 * which is why a production endpoint shipped returning 500 while the suite was green:
 *
 *     no such column: observed_at at offset 11: SQLITE_ERROR [code: 7500]
 *
 * `/admin/api/telemetry/latest` read `observed_at` from `tesla_telemetry_batch`, but that
 * column belongs to `tesla_telemetry_fact`. The mock could not tell.
 *
 * A static check was tried first and is NOT sufficient: it can only validate column
 * references written in qualified form (`tesla_x.col`), and the failing query was
 * unqualified. Re-injecting the exact original bug passes that check. Validation has to
 * happen by asking SQLite to prepare the real statement against the real schema — which is
 * what this does.
 *
 * WHAT IT CATCHES THAT A MOCK CANNOT
 * ----------------------------------
 *   - a column that does not exist on the table the query reads
 *   - a table that does not exist, or a renamed one
 *   - a NOT NULL / CHECK / FOREIGN KEY violation in the data a code path writes
 *   - a query whose shape is invalid SQL
 *
 * The constraint failures are the underrated part: the mock accepts `updated_at = NULL`
 * and `toca_status = 'active'`; real SQLite rejects both, because the migrations say so.
 *
 * FIDELITY BOUNDARY — WHAT THIS IS NOT
 * ------------------------------------
 * This is SQLite, not D1. It does not reproduce D1's statement-size cap, its latency, its
 * eventual consistency, or its specific error codes. It is a schema-and-SQL correctness
 * check, not an integration test. Where a test needs D1's actual behaviour, it should use
 * `wrangler` (`getPlatformProxy`) or run against a real database.
 *
 * `node:sqlite` is flagged experimental by Node. It works on Node 22 and under Bun, and the
 * suite pins neither, so if an upgrade ever breaks it the failure will be loud (every
 * migrated test errors) rather than silent.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Where the migrations live, resolved from this file rather than the cwd. */
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

/**
 * Apply every migration, in filename order.
 *
 * Measured at ~10ms for the full set, so this is done per-database rather than cached: a
 * shared schema that tests mutate would leak state between them, and 10ms is not worth the
 * aliasing hazard.
 */
function applyMigrations(db: DatabaseSync): number {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return files.length
}

/** Number of migration files applied — exposed so a test can assert the harness really ran. */
export const MIGRATION_COUNT = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length
/**
 * Create a fresh in-memory database with every migration applied.
 *
 * Each call returns an independent database, so tests cannot leak state into one another
 * through the schema or through seeded rows.
 */
export function createMigratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

/**
 * A D1-compatible adapter over a `DatabaseSync`.
 *
 * Implements exactly the surface the application uses — `prepare`, `bind`, `first`, `all`,
 * `run`, `batch` — verified by grepping the source rather than assumed. `raw` and `exec` are
 * not part of D1's worker API in the way the app uses it, so they are deliberately absent:
 * an adapter that silently accepted them would hide a real API mistake.
 *
 * `batch` is meaningful rather than a stub: the app uses it for multi-statement writes
 * (`ingest` writes facts and snapshots through it), and those must actually execute for a
 * test to observe the rows.
 */
export interface SqliteD1 {
  prepare: (sql: string) => SqliteD1Statement
  batch: (statements: SqliteD1Statement[]) => Promise<unknown[]>
  /** Test-only conveniences. Not part of D1 — never call these from application code. */
  _db: DatabaseSync
  _seed: (sql: string) => void
  _rows: (sql: string, ...args: unknown[]) => unknown[]
}

export interface SqliteD1Statement {
  bind: (...args: unknown[]) => SqliteD1Statement
  first: <T = unknown>() => Promise<T | null>
  all: <T = unknown>() => Promise<{ results: T[] }>
  run: () => Promise<{ success: boolean }>
}

/** D1 returns `null` for a missing row; `DatabaseSync.get` does the same. */
export function createSqliteD1(db?: DatabaseSync): SqliteD1 {
  const database = db ?? createMigratedDb()

  const makeStatement = (sql: string): SqliteD1Statement => {
    let args: unknown[] = []
    const statement: SqliteD1Statement = {
      bind(...values: unknown[]) {
        // Support both `.bind(a, b)` and `.bind([a, b])`, because Hono/D1 callers in the
        // wild do both and an adapter that only accepted one would force a silent rewrite
        // of working application code.
        args = values.length === 1 && Array.isArray(values[0]) ? (values[0] as unknown[]) : values
        return statement
      },
      async first<T = unknown>() {
        const row = database.prepare(sql).get(...(args as never[]))
        return (row ?? null) as T | null
      },
      async all<T = unknown>() {
        const rows = database.prepare(sql).all(...(args as never[])) as T[]
        return { results: rows }
      },
      async run() {
        database.prepare(sql).run(...(args as never[]))
        return { success: true }
      },
    }
    return statement
  }

  return {
    prepare: (sql: string) => makeStatement(sql),
    async batch(statements: SqliteD1Statement[]) {
      // Sequential, which is D1's contract: a batch is transactional and ordered, so the
      // assertions in a later statement can depend on an earlier one having run.
      const out: unknown[] = []
      for (const statement of statements) out.push(await statement.run())
      return out
    },
    _db: database,
    _seed: (sql: string) => database.exec(sql),
    _rows: (sql: string, ...args: unknown[]) =>
      database.prepare(sql).all(...(args as never[])),
  }
}

/**
 * Seed the minimum a console page needs to render against real foreign keys.
 *
 * Insertion order matters and is the schema's, not ours: `tesla_vehicle.member_id`
 * references `tesla_member`, and `tesla_telemetry_fact.batch_id` references
 * `tesla_telemetry_batch`, so seeding out of order fails — which is the point. The mock
 * accepted any order.
 */
export function seedBaseline(adapter: SqliteD1, opts?: { vin?: string; memberId?: string }): {
  vin: string
  memberId: string
  batchId: string
} {
  const vin = opts?.vin ?? 'LRW3F7ET1SC584656'
  const memberId = opts?.memberId ?? '01M447GB46KR7NK233HW6E6EBB'
  const batchId = '01M49EEB58M1B68Y8V4DE5FB9Q'
  const now = '2026-10-07T05:06:42.564Z'

  adapter._seed(`
    INSERT INTO tesla_member (member_id, toca_status, email, display_name, created_at, updated_at)
      VALUES ('${memberId}', 'verified_toca', 'owner@example.com', 'Test Owner', '${now}', '${now}');
    INSERT INTO tesla_vehicle (vin, member_id, display_name, first_seen_at)
      VALUES ('${vin}', '${memberId}', 'Drogon', '${now}');
    INSERT INTO tesla_telemetry_batch (batch_id, vin, received_at, r2_key, payload_sha256, datum_count)
      VALUES ('${batchId}', '${vin}', '${now}', 'telemetry/key.json', 'sha256-test', 1);
    INSERT INTO tesla_telemetry_fact
      (fact_id, vin, field_key, observed_at, received_at, value_real, value_kind, collection_tier, batch_id)
      VALUES ('f_odo', '${vin}', 'Odometer', '${now}', '${now}', 21962.3, 'real', 'event', '${batchId}');
  `)
  return { vin, memberId, batchId }
}

/**
 * Guard: fail if a test double accepts arbitrary SQL.
 *
 * The blind spot is not the mock's existence, it is a mock that cannot reject anything. This
 * asserts the opposite property — that the double actually validates — so the suite cannot
 * quietly regress to a permissive stub.
 */
export function assertRejectsInvalidSql(adapter: SqliteD1): void {
  const probe = 'SELECT definitely_not_a_column FROM tesla_telemetry_fact'
  let rejected = false
  try {
    // `prepare` alone resolves columns, which is what production does.
    adapter._db.prepare(probe)
  } catch {
    rejected = true
  }
  if (!rejected) {
    throw new Error(
      'the SQLite D1 double accepted a query with a nonexistent column — it is not ' +
        'validating SQL, and a whole class of production 500s is invisible to this suite',
    )
  }
}
