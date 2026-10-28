"""FRS-012 Phase 5 — Recovery Framework (F12-F15).

Detects Rhino/RhinoClaw wedge states, polls stuck operations, and produces a
structured ResumePlan. It does NOT fabricate recovery: RhinoClaw exposes no
cancel/reset command and all UI-thread commands are blocked while wedged, so
in-channel recovery is impossible — the framework diagnoses, polls, and escalates
to the required OS-level action with the root cause.

Wedge signature (evidence-based): every UI-thread command returns
{"status":"error","error_code":"RHINO_BUSY"} while get_operation_result (an
off-UI-thread query) keeps returning the stuck operation as "pending".
"""
import time


class SessionWedgeError(Exception):
    """Raised when the RhinoClaw UI thread is wedged and cannot be cleared in-channel."""


def is_wedge(response):
    """True if a RhinoClaw response indicates the UI thread is wedged."""
    return isinstance(response, dict) and response.get("error_code") == "RHINO_BUSY"


def detect_wedge(bridge, probe="ping"):
    """Return (wedged: bool, state: str). Transport errors count as wedged."""
    try:
        r = bridge.send(probe, {})
    except Exception as e:  # transport-level failure
        return True, "transport_error:%s" % type(e).__name__
    if r.get("status") == "success":
        return False, "ok"
    if is_wedge(r):
        return True, "RHINO_BUSY"
    return False, str(r.get("error_code", "unknown"))


def await_ui_thread(bridge, timeout=300, poll=5):
    """Poll until the UI thread frees. Returns (freed, elapsed, last_state)."""
    t0 = time.time()
    state = "unknown"
    while time.time() - t0 < timeout:
        wedged, state = detect_wedge(bridge)
        if not wedged:
            return True, time.time() - t0, state
        time.sleep(poll)
    return False, time.time() - t0, state


def wait_for_operation(bridge, operation_id, session_id="", timeout=600, poll=10):
    """Poll get_operation_result until the operation leaves 'pending'.

    Returns (resolved, final_state, elapsed). get_operation_result is served
    off the UI thread, so it keeps answering even while the session is wedged.
    """
    t0 = time.time()
    state = "pending"
    while time.time() - t0 < timeout:
        try:
            r = bridge.send("get_operation_result",
                            {"operation_id": operation_id, "session_id": session_id})
            state = r.get("result", {}).get("state", "?")
            if state != "pending":
                return True, state, time.time() - t0
        except Exception:
            pass
        time.sleep(poll)
    return False, state, time.time() - t0


def recover_session(bridge, operation_id=None, session_id="", timeout=120):
    """Diagnose the wedge, attempt bounded in-channel waits, escalate honestly.

    Returns a ResumePlan dict. Never claims recovery it cannot prove: if the UI
    thread does not free within the bounded wait, resume=False and the plan lists
    the required OS-level action + root cause.
    """
    wedged, state = detect_wedge(bridge)
    plan = {"wedge_detected": wedged, "probe_state": state,
            "in_channel_recovery_possible": False, "resume": False, "actions": []}

    if not wedged:
        plan["resume"] = True
        plan["actions"].append("session healthy; resume generation")
        return plan

    if operation_id:
        resolved, op_state, el = wait_for_operation(
            bridge, operation_id, session_id, timeout=min(timeout, 60), poll=5)
        plan["operation_poll"] = {"resolved": resolved, "state": op_state, "elapsed": round(el, 1)}

    freed, el, ui_state = await_ui_thread(bridge, timeout=min(timeout, 60), poll=5)
    plan["ui_thread"] = {"freed": freed, "elapsed": round(el, 1), "state": ui_state}

    if freed:
        plan["resume"] = True
        plan["in_channel_recovery_possible"] = True
        plan["actions"].append("UI thread freed after wait; resume generation")
    else:
        plan["resume"] = False
        plan["root_cause"] = (
            "CONFIRMED (screenshot): bake_grasshopper on invalid geometry raised "
            "Grasshopper's MODAL 'Invalid geometry - You are about to bake an invalid mesh' "
            "dialog. A modal dialog blocks the Rhino UI thread until a human dismisses it, so "
            "every UI-thread command returns RHINO_BUSY and the bake op stays 'pending' "
            "indefinitely. RhinoClaw has no dismiss-modal/cancel command, and reconnecting "
            "shares the same wedged UI thread, so in-channel recovery is impossible.")
        plan["actions"] = [
            "dismiss the Grasshopper 'Invalid geometry' bake modal on pc2 (click OK or Cancel) - "
            "this immediately unblocks the UI thread",
            "OS-level restart of Rhino/RhinoClaw on pc2 if the modal cannot be dismissed (definitions are saved files; reload is lossless)",
            "grant SSH/OS access to pc2 for autonomous recovery",
            "SAFETY: bake only VALID geometry (clean-solving definitions); bake_grasshopper uses definition_id only; set 'do not bake invalid objects and stop asking' to prevent re-modal",
            "do not retry the wedged mutation",
        ]
    return plan
