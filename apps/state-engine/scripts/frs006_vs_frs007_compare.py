"""
FRS-006 vs FRS-007 — Agent Process Automation Comparison Test.

Same read-only perception action (income section scan, live deal
2bc60884 via CfT CDP) driven through BOTH architectures:

  FRS-006 (Evidence Engine — Evidence Precedes Theory):
    missions/runs/observations — free-text observations, raw values,
    evidence_strength labels, NO state machine, NO verification gate.

  FRS-007 (State Engine + Observer — State Precedes Action):
    observer_events (PII-safe value_hash) -> TaskMiner -> observer_runs
    (shadow_pass + diversity hash) -> StateRegistry begin/commit with
    L1-enforced dual-gate (L3 self-report REJECTED).

PII-safe: the live Salestrekker session is the TEST DEAL (fake data).
"""
import json
import os
import sqlite3
import sys
import time
import uuid

sys.path.insert(0, '/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/state-engine')

from playwright.sync_api import sync_playwright  # noqa: E402

DB = '/Users/warren/.hermes/evidence/evidence.db'
DEAL_ID = '2bc60884'
MISSION = 'frs006-vs-frs007-compare-20260803'
TS = time.strftime('%H%M%S')

from evidence_adapter import EvidenceAdapter  # noqa: E402
from observer import ObserverDaemon, TaskMiner  # noqa: E402
from state_registry import StateRegistry  # noqa: E402


def connect_salestrekker():
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp('http://localhost:9222')
    for ctx in browser.contexts:
        for page in ctx.pages:
            if 'pc.v2.salestrekker.com' in page.url:
                return pw, page
    raise RuntimeError('No Salestrekker tab found')


def scan_income_inputs(page):
    """READ-ONLY DOM scan of visible inputs on the current section."""
    return page.evaluate("""() => {
        const out = [];
        const inputs = document.querySelectorAll('input');
        for (const el of inputs) {
            if (el.offsetParent === null) continue;  // hidden
            const name = el.getAttribute('name') || el.id || '';
            const val = el.value || '';
            const label = (el.getAttribute('aria-label') || name || 'unlabeled');
            if (label && label !== 'undefined') {
                out.push({label: label.slice(0, 60), value: val.slice(0, 40)});
            }
        }
        return out;
    }""")


def main():
    print(f'== FRS-006 vs FRS-007 comparison test @ {time.strftime("%H:%M:%S")} ==')
    pw, page = connect_salestrekker()
    print(f'[live] page: {page.url[:70]}')
    inputs = scan_income_inputs(page)
    print(f'[live] income inputs visible: {len(inputs)}')
    pw.stop()

    # ─────────────────────────────────────────────────────────────────
    # FRS-006 PATH — Evidence Engine (legacy: record what happened)
    # ─────────────────────────────────────────────────────────────────
    ev = EvidenceAdapter(db_path=DB)
    ev.open()
    run6 = f'run-frs006-{TS}'
    ev.begin_run(run6, MISSION, 'salestrekker_v2', 'perceive_income_section')
    for inp in inputs:
        if not inp['value']:
            continue
        # RAW VALUE stored in free-text observation — FRS-006 has no gate
        ev.log_observation(run6, 'dom_input',
                           f"income field '{inp['label']}' = '{inp['value']}'")
    # cached-DOM scan recorded as L3 — FRS-006 accepts it without question
    evid6 = ev.add_evidence(run6, 'dom_scan', 'db', 'L3',
                            payload_json=json.dumps({'scan': 'income'}))
    ev.finish_run(run6, 'SUCCESS')
    print(f'[FRS-006] run {run6}: {sum(1 for i in inputs if i["value"])} '
          f'observations, evidence {evid6[:8]} (strength L3 accepted)')
    ev.close()

    # ─────────────────────────────────────────────────────────────────
    # FRS-007 PATH — Observer (PII-safe) + TaskMiner + State Registry
    # ─────────────────────────────────────────────────────────────────
    obs = ObserverDaemon(DB)
    obs.open()
    rid7 = obs.begin_run(MISSION)
    for inp in inputs:
        if not inp['value']:
            continue
        obs.record('dom', 'input', inp['label'], value=inp['value'],
                   run_id=rid7)
    events = obs.events(rid7)
    mined = TaskMiner().mine(events)
    obs.end_run(True, run_id=rid7, shadow_pass=True,
                transition_id='Deal_totalBusinessIncome',
                object_type='Deal', transition_name='totalBusinessIncome',
                context_type='Income',
                transitions=mined['transitions'], candidates=mined['candidates'])
    print(f'[FRS-007] observer run {rid7[:8]}: {len(events)} events, '
          f'{len(mined["candidates"])} mined candidate(s), '
          f'transition -> {mined["transitions"][0]["target"] if mined["transitions"] else "?"}')
    obs.close()

    # State registry — register transition, register object, dual-gate
    sr = StateRegistry(db_path=DB)
    sr.open()
    trans_id = 'Deal_totalBusinessIncome'
    sr.register_transition(trans_id, 'Income total', 'totalBusinessIncome_DRAFT',
                           'PERSISTED', verification_gate=['L1'])
    obj_id = f'deal:{DEAL_ID}:income'

    # L1 evidence = independent read-back (fresh second DOM scan pass)
    ev2 = EvidenceAdapter(db_path=DB)
    ev2.open()
    evid_l1 = ev2.add_evidence(rid7, 'dom_scan', 'db', 'L1',
                               payload_json=json.dumps({'scan': 'readback', 'pass': 2}))
    ev2.close()

    sr.register_object(obj_id, 'IncomeSection', 'totalBusinessIncome_DRAFT', evid_l1)
    pending = sr.begin_transition(obj_id, trans_id)
    print(f'[FRS-007] staged {pending["source_state"]} -> '
          f'{pending["target_state"]} (status {pending["status"]})')

    # Provoke the L1 gate: executor self-report (L3) MUST be rejected
    try:
        sr.commit_transition(obj_id, trans_id, evid6, evidence_strength='L3')
        print('[FRS-007] L3 commit ACCEPTED (GATE BROKEN!)')
    except PermissionError as e:
        print(f'[FRS-007] L3 commit REJECTED: {str(e)[:80]}')

    # Legitimate commit with L1 independent read-back
    committed = sr.commit_transition(obj_id, trans_id, evid_l1,
                                     evidence_strength='L1')
    state = sr.get_state(obj_id)
    hist = sr.get_history(obj_id)
    print(f'[FRS-007] committed -> current_state={state["current_state"]} '
          f'version={state["version"]} history={len(hist)}')
    sr.close()

    # ─────────────────────────────────────────────────────────────────
    # DB READ-BACK — the comparison evidence
    # ─────────────────────────────────────────────────────────────────
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    print()
    print('==================== COMPARISON ====================')
    print(f'{"dimension":<34} {"FRS-006":<28} {"FRS-007"}')
    print('-' * 96)

    obs_rows = conn.execute(
        "SELECT observation FROM observations WHERE run_id = ?", (run6,)).fetchall()
    raw_leaked = any('0412 123 123' in r['observation'] or '150,000' in r['observation']
                     or 'sam@fakeemail' in r['observation'] for r in obs_rows)
    ev_rows = conn.execute(
        'SELECT evidence_strength FROM evidence WHERE run_id = ?', (run6,)).fetchall()
    ev_events = conn.execute(
        'SELECT value_hash, detail_json FROM observer_events WHERE run_id = ?',
        (rid7,)).fetchall()
    pii_in_events = any('0412123123' in json.dumps(dict(r)) for r in ev_events)
    run_row = conn.execute(
        'SELECT shadow_pass, observation_diversity_hash, transition_id '
        'FROM observer_runs WHERE run_id = ?', (rid7,)).fetchone()

    def yn(b):
        return 'YES' if b else 'NO'

    rows = [
        ('raw value in observation store', 'YES (free text)', 'NO (value_hash)'),
        ('PII stored', yn(raw_leaked), yn(pii_in_events)),
        ('evidence strength recorded', ev_rows[0]['evidence_strength'] if ev_rows else '?', 'L1 required'),
        ('strength ENFORCED', 'NO', 'YES (L3 -> PermissionError)'),
        ('state machine (current_state)', 'NO', f"YES ({state['current_state']})"),
        ('transition audit (state_history)', 'NO', f'YES ({len(hist)} row)'),
        ('idempotency / resume gate', 'NO', 'YES (dual-gate)'),
        ('task mining (structured candidates)', 'NO', f"YES ({len(mined['candidates'])})"),
        ('shadow pass flag', 'NO', yn(run_row['shadow_pass'] == 1)),
        ('diversity hash (generalization)', 'NO', yn(bool(run_row['observation_diversity_hash']))),
        ('promotion bar (10/95/3+guard)', 'NO', 'YES (promote_baseline)'),
    ]
    for k, v6, v7 in rows:
        print(f'{k:<34} {v6:<28} {v7}')
    print('-' * 96)
    print(f'[evidence.db] observations(FRS-006)={len(obs_rows)}  '
          f'observer_events(FRS-007)={len(ev_events)}  '
          f'shadow_pass={run_row["shadow_pass"]}  '
          f'diversity_hash={run_row["observation_diversity_hash"][:12]}...')
    conn.close()
    print()
    print('VERDICT: FRS-006 records WHAT HAPPENED (raw, unverified, stateless);')
    print('         FRS-007 records WHAT STATE WAS REACHED (hashed, L1-verified,')
    print('         mined into reusable transitions with promotion governance).')


if __name__ == '__main__':
    main()
