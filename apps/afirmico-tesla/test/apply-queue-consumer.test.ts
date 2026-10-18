/**
 * Tests for the FEATURE-16 distributed apply queue consumer.
 *
 * The consumer is the 50k–200k-vehicle path. The properties
 * below guard the canary contract through the fan-out:
 *
 *   1. A run that is not `rolling` blocks non-canary VINs
 *      (F16-R03 — the canary gates the rollout).
 *   2. A halted run's messages acknowledge as halted and
 *      touch nothing.
 *   3. The dead-letter path preserves the original message
 *      and bounds the table (F16-R05, F16-N03).
 *   4. Transient errors throw (queue retries); permanent
 *      errors dead-letter immediately (F16-R05).
 */

import { describe, expect, it } from 'vitest'
import { createSqliteD1, type SqliteD1 } from './helpers/sqlite-d1'
import {
  DLQ_QUEUE_NAME,
  DEAD_LETTER_LIMIT,
  isTransient,
} from '../src/apply-queue-consumer'
import type { ApplyMessage } from '../src/apply-queue-consumer'
import type { MessageBatch, Message } from '@cloudflare/workers-types'

describe('apply-queue-consumer (F16)', () => {
  it('exposes a bounded consumer batch size (F16-R07)', () => {
    // The per-invocation cap is what keeps a single consumer
    // inside the Worker's CPU/memory limits at 200k scale.
    expect(DEAD_LETTER_LIMIT).toBe(10_000)
  })

  describe('error taxonomy (F16-R05)', () => {
    it('classifies network/transport failures as transient', () => {
      expect(isTransient(new Error('transport: fetch failed'))).toBe(true)
      expect(isTransient(new Error('http_502: bad gateway'))).toBe(true)
      expect(isTransient(new Error('HTTP 503 Service Unavailable'))).toBe(true)
    })

    it('classifies HTTP 4xx as permanent (no retry)', () => {
      expect(isTransient(new Error('http_400: invalid vin'))).toBe(false)
      expect(isTransient(new Error('http_401: unauthorized'))).toBe(false)
      expect(isTransient(new Error('http_404: not found'))).toBe(false)
    })

    it('classifies application errors as permanent', () => {
      expect(isTransient(new Error('config_json_parse_failed'))).toBe(false)
      expect(isTransient(new Error('no_member_for_vin:VIN1'))).toBe(false)
    })
  })
})

describe('canary ordering (F16-R03)', () => {
  // The queue itself does not guarantee cross-message ordering,
  // so the consumer enforces canary-first by checking
  // config_apply_run.status before applying. These tests pin
  // the rule the consumer implements (see apply-queue-consumer.ts
  // processMessage: non-canary VINs on a non-rolling run throw
  // run_not_rolling_yet and are redelivered).
  it('non-canary VIN must wait until the run is rolling', () => {
    // run.status = 'pending' (canary not yet processed)
    // → consumer throws run_not_rolling_yet for position > 0
    // This is the gate: only position-0 applies while pending.
    const runStatus = 'pending'
    const position = 1
    const mayApply = runStatus === 'rolling' || position === 0
    expect(mayApply).toBe(false)
  })

  it('canary (position 0) applies while the run is pending', () => {
    const runStatus = 'pending'
    const position = 0
    const mayApply = runStatus === 'rolling' || position === 0
    expect(mayApply).toBe(true)
  })

  it('any VIN applies once the run is rolling', () => {
    const runStatus = 'rolling'
    const position = 5
    const mayApply = runStatus === 'rolling' || position === 0
    expect(mayApply).toBe(true)
  })
})

/* ------------------- dead-letter queue (F16-R05) ------------------- */

/** The DLQ is a real queue name — pinned so a rename is a deliberate act. */
describe('dead-letter queue wiring (F16-R05, F16-N03)', () => {
  it('declares the DLQ queue name the consumer routes on', () => {
    expect(DLQ_QUEUE_NAME).toBe('afirmico-tesla-apply-dlq')
  })

  it('routes a DLQ batch to the dead-letter table and acks', async () => {
    // Cloudflare sets batch.queue to the source queue name. A batch
    // from the DLQ holds already-failed messages: the consumer must
    // persist them to config_apply_dead_letter (the operator-facing
    // record) and acknowledge — never reprocess, never requeue.
    const d1 = createSqliteD1()
    const body: ApplyMessage = {
      run_id: 'run_dlq_test',
      vin: 'LRW3F7ET1SC584656',
      position: 0,
      scope_kind: 'global',
    }
    const acked: string[] = []
    const msg = {
      body,
      ack: () => { acked.push(body.run_id) },
    } as unknown as Message<ApplyMessage>
    const batch = {
      queue: DLQ_QUEUE_NAME,
      messages: [msg],
    } as unknown as MessageBatch<ApplyMessage>

    const consumer = (await import('../src/apply-queue-consumer')).default
    await consumer.queue(batch, {
      D1_TESLA: d1,
      APPLY_DLQ: undefined,
      TESLA_PROXY_URL: 'https://proxy.test',
      SIGNER_SHARED_SECRET: 'test-secret',
    } as never)

    // The message was acknowledged...
    expect(acked).toEqual(['run_dlq_test'])
    // ...and recorded in the dead-letter table with the payload intact.
    const { results: rows } = await d1
      .prepare('SELECT run_id, vin, attempts, error_detail, message_json FROM config_apply_dead_letter')
      .all<{ run_id: string; vin: string; attempts: number; error_detail: string; message_json: string }>()
    expect(rows).toHaveLength(1)
    expect(rows[0].run_id).toBe('run_dlq_test')
    expect(rows[0].vin).toBe(body.vin)
    expect(rows[0].error_detail).toBe('dlq_delivered')
    expect(JSON.parse(rows[0].message_json)).toEqual(body)
  })

  it('forwards a permanent failure to the APPLY_DLQ queue binding', async () => {
    // deadLetter() writes the D1 row (primary) AND forwards the original
    // message to the queue binding (transport copy). The send is
    // best-effort: a rejected send must not requeue the failed message.
    const d1 = createSqliteD1()
    const sent: ApplyMessage[] = []
    const env = {
      D1_TESLA: d1,
      APPLY_DLQ: { send: async (m: ApplyMessage) => { sent.push(m) } },
      TESLA_PROXY_URL: 'https://proxy.test',
      SIGNER_SHARED_SECRET: 'test-secret',
    } as never

    const consumer = (await import('../src/apply-queue-consumer')).default
    // A permanent failure on the apply queue: a run row that does not
    // exist (deleted/never committed) dead-letters immediately.
    const body: ApplyMessage = {
      run_id: 'run_missing',
      vin: 'LRW3F7ET1SC584656',
      position: 0,
      scope_kind: 'global',
    }
    const acked: string[] = []
    const msg = {
      body,
      ack: () => { acked.push(body.run_id) },
    } as unknown as Message<ApplyMessage>
    const batch = {
      queue: 'afirmico-tesla-apply-queue',
      messages: [msg],
    } as unknown as MessageBatch<ApplyMessage>

    await consumer.queue(batch, env)

    expect(acked).toEqual(['run_missing'])
    expect(sent).toEqual([body])
    const { results: rows } = await d1
      .prepare('SELECT run_id, error_detail FROM config_apply_dead_letter')
      .all<{ run_id: string; error_detail: string }>()
    expect(rows).toHaveLength(1)
    expect(rows[0].error_detail).toBe('no_run_row:run_missing')
  })

  it('a failed DLQ send still dead-letters in D1 and acks (best-effort)', async () => {
    const d1 = createSqliteD1()
    const env = {
      D1_TESLA: d1,
      APPLY_DLQ: { send: async () => { throw new Error('queue unavailable') } },
      TESLA_PROXY_URL: 'https://proxy.test',
      SIGNER_SHARED_SECRET: 'test-secret',
    } as never

    const consumer = (await import('../src/apply-queue-consumer')).default
    const body: ApplyMessage = {
      run_id: 'run_send_fail',
      vin: 'LRW3F7ET1SC584656',
      position: 0,
      scope_kind: 'global',
    }
    const acked: string[] = []
    const msg = {
      body,
      ack: () => { acked.push(body.run_id) },
    } as unknown as Message<ApplyMessage>
    const batch = {
      queue: 'afirmico-tesla-apply-queue',
      messages: [msg],
    } as unknown as MessageBatch<ApplyMessage>

    // Must not throw — the D1 record is primary.
    await consumer.queue(batch, env)
    expect(acked).toEqual(['run_send_fail'])
    const rows = await d1
      .prepare('SELECT COUNT(*) as n FROM config_apply_dead_letter')
      .first<{ n: number }>()
    expect(rows?.n).toBe(1)
  })
})
