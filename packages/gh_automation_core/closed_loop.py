"""FRS-013 Closed-Loop Parametric Control Validation engine.

Implements the Selector -> Geometry -> Vision -> Feedback loop against a live
RhinoClaw + Grasshopper session:

    identify controls -> modify control -> solve -> observe viewport ->
    measure geometry -> decide success -> iterate until target

Bridge-agnostic: any transport exposing send(cmd, params)->dict works. The default
RhinoClawBridge speaks the length-prefixed JSON TCP protocol (port 1999).

Every phase emits machine-readable evidence (scene_summary, viewport PNG + sha256,
bbox, mesh stats) into a report dict. No success is claimed without geometry evidence.
"""
import json
import hashlib
import socket
import struct
import time
import os
import re
import uuid


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------
class RhinoClawBridge(object):
    """Minimal RhinoClaw TCP client (length-prefixed JSON)."""

    def __init__(self, host="100.110.105.101", port=1999, token=None):
        self.host = host
        self.port = port
        self.token = token or self._default_token()

    @staticmethod
    def _default_token():
        tok = os.environ.get("RHINOCLAW_AUTH_TOKEN", "")
        if tok:
            return tok
        try:
            with open(os.path.expanduser("~/.hermes/config.yaml")) as fh:
                m = re.search(r"RHINOCLAW_AUTH_TOKEN[=:]\s*['\"]?([^\s'\"]+)", fh.read())
                if m:
                    return m.group(1).strip()
        except Exception:
            pass
        return ""

    def send(self, cmd_type, params):
        payload = {"type": cmd_type, "params": params, "auth": self.token,
                   "request_id": str(uuid.uuid4())}
        data = json.dumps(payload).encode("utf-8")
        with socket.create_connection((self.host, self.port), timeout=180) as sock:
            sock.sendall(struct.pack("!I", len(data)) + data)
            raw = b""
            hdr = b""
            while len(hdr) < 4:
                chunk = sock.recv(4 - len(hdr))
                if not chunk:
                    break
                hdr += chunk
            if len(hdr) < 4:
                raise RuntimeError("short header from RhinoClaw")
            length = struct.unpack("!I", hdr)[0]
            while len(raw) < length:
                chunk = sock.recv(length - len(raw))
                if not chunk:
                    break
                raw += chunk
        return json.loads(raw.decode("utf-8"))

    # --- convenience wrappers ------------------------------------------------
    def execute(self, code):
        return self.send("execute_rhinoscript_python_code", {"code": code})

    def python3(self, code):
        return self.send("execute_python3_code", {"code": code})


def _ok(res):
    return isinstance(res, dict) and res.get("status") == "success"


def _result(res):
    return res.get("result", {}) if isinstance(res, dict) else {}


# ---------------------------------------------------------------------------
# Closed-loop session
# ---------------------------------------------------------------------------
class ClosedLoopSession(object):
    def __init__(self, bridge=None):
        self.bridge = bridge or RhinoClawBridge()
        self.definition_id = None
        self.file_path = None
        self.controls = {}   # nickname -> {value,min,max,instance_id,...}
        self.report = {"phases": []}

    # -- definition lifecycle -------------------------------------------------
    def load_definition(self, file_path):
        res = self.bridge.send("load_grasshopper_definition", {"file_path": file_path})
        if not _ok(res):
            msg = str(res.get("message", "")).lower()
            if "already open" in msg or "reuse its definition_id" in msg:
                # Idempotent re-run: the graph is already loaded; reuse its id.
                lst = self.bridge.send("list_grasshopper_definitions", {})
                if _ok(lst):
                    for d in _result(lst).get("definitions", []):
                        if str(d.get("file_path", "")).lower() == file_path.lower():
                            self.definition_id = d["definition_id"]
                            self.file_path = d["file_path"]
                            self.refresh_controls()
                            return {"definition_id": self.definition_id,
                                    "file_path": self.file_path, "reused": True}
            raise RuntimeError("load failed: %s" % res)
        r = _result(res)
        self.definition_id = r["definition_id"]
        self.file_path = r["file_path"]
        self.controls = {p["nickname"]: p for p in r.get("parameters", []) if p.get("nickname")}
        return r

    def show_definition(self, definition_id=None):
        did = definition_id or self.definition_id
        res = self.bridge.send("show_grasshopper_definition", {"definition_id": did})
        if not _ok(res):
            raise RuntimeError("show failed: %s" % res)
        return _result(res)

    def run(self, file_path=None):
        fp = file_path or self.file_path
        res = self.bridge.send("run_grasshopper", {"file_path": fp})
        if not _ok(res):
            raise RuntimeError("run failed: %s" % res)
        return _result(res)

    def solve(self, definition_id=None):
        did = definition_id or self.definition_id
        res = self.bridge.send("solve_grasshopper", {"definition_id": did})
        if not _ok(res):
            raise RuntimeError("solve failed: %s" % res)
        return _result(res)

    # NOTE (FRS-013): the native solve_grasshopper is HEADLESS — it does not populate
    # the visible canvas document's volatile data, so IronPython canvas reads see 0
    # geometry after a native solve. For geometry MEASUREMENT use solve_on_canvas()
    # (IronPython NewSolution on the active canvas) + measure_all_outputs(), or bake
    # (definition_id only — never pass an unknown layer param; that wedged the UI thread).
    def solve_on_canvas(self):
        """Solve the ACTIVE canvas document via IronPython NewSolution so canvas
        volatile data populates and measure_all_outputs() can read bboxes."""
        code = (
            "import Grasshopper as gh\n"
            "out=[]\n"
            "gdoc=None\n"
            "try: gdoc=gh.Instances.ActiveCanvas.Document\n"
            "except Exception as e: out.append('ERR:'+repr(e))\n"
            "if gdoc is not None:\n"
            "    try:\n"
            "        gdoc.NewSolution(False)\n"
            "        out.append('SOLVE_OK')\n"
            "    except Exception as e:\n"
            "        out.append('SOLVE_ERR:'+repr(e)[:200])\n"
            "    errs=[]\n"
            "    try:\n"
            "        for obj in gdoc.Objects:\n"
            "            try:\n"
            "                if obj.RuntimeMessageLevel>0:\n"
            "                    errs.append((obj.NickName or obj.Name, str(obj.RuntimeMessage)))\n"
            "            except: pass\n"
            "    except: pass\n"
            "    out.append('ERR_COUNT:'+str(len(errs)))\n"
            "    for nm,msg in errs[:20]:\n"
            "        out.append('ERROBJ|'+str(nm)+'|'+str(msg)[:120])\n"
            "print '\\n'.join(out)\n"
        )
        res = self.bridge.execute(code)
        txt = _result(res).get("result", "") or ""
        errors = []
        for line in txt.splitlines():
            if line.startswith("ERROBJ|"):
                parts = line.split("|", 2)
                if len(parts) == 3:
                    errors.append({"component": parts[1], "message": parts[2]})
        return {"ok": "SOLVE_OK" in txt, "error_count": len(errors),
                "errors": errors, "raw": txt}

    def set_parameter_on_canvas(self, name, value):
        """Set a slider by nickname directly on the active canvas document (reliable
        for the on-canvas loop; complements native set_grasshopper_parameter)."""
        code = (
            "import Grasshopper as gh\n"
            "out=[]\n"
            "gdoc=None\n"
            "try: gdoc=gh.Instances.ActiveCanvas.Document\n"
            "except Exception as e: out.append('ERR:'+repr(e))\n"
            "if gdoc is not None:\n"
            "    hit=False\n"
            "    for obj in gdoc.Objects:\n"
            "        try:\n"
            "            if obj.NickName==NAME:\n"
            "                obj.Slider.Value=float(VAL)\n"
            "                obj.ExpireSolution(True)\n"
            "                hit=True\n"
            "        except Exception as e:\n"
            "            out.append('SETERR:'+repr(e)[:120])\n"
            "    out.append('SET_HIT:'+str(hit))\n"
            "print '\\n'.join(out)\n"
        ).replace("NAME", repr(name)).replace("VAL", repr(float(value)))
        res = self.bridge.execute(code)
        txt = _result(res).get("result", "") or ""
        return {"hit": "SET_HIT:True" in txt, "raw": txt}

    def bake(self, definition_id=None):
        did = definition_id or self.definition_id
        res = self.bridge.send("bake_grasshopper", {"definition_id": did})
        if not _ok(res):
            raise RuntimeError("bake failed: %s" % res)
        return _result(res)

    # -- control identification + mutation ------------------------------------
    def refresh_controls(self):
        """Re-read the definition's exposed controls (sliders/value lists)."""
        res = self.bridge.send("inspect_grasshopper_definition", {"file_path": self.file_path})
        if not _ok(res):
            raise RuntimeError("inspect failed: %s" % res)
        r = _result(res)
        self.controls = {}
        for p in r.get("inputs", []):
            nick = p.get("nickname") or p.get("name")
            self.controls[nick] = p
        return r

    def get_control(self, name):
        if name not in self.controls:
            raise KeyError("control %r not found; have %s" % (name, sorted(self.controls)))
        return self.controls[name]

    def set_parameter(self, name, value):
        """Modify one Grasshopper control by nickname (native command)."""
        res = self.bridge.send("set_grasshopper_parameter",
                               {"definition_id": self.definition_id,
                                "parameter_name": name, "value": value})
        if not _ok(res):
            raise RuntimeError("set_parameter(%s=%s) failed: %s" % (name, value, res))
        # refresh local view of the control
        if name in self.controls:
            self.controls[name]["value"] = value
        return _result(res)

    # -- observation ----------------------------------------------------------
    def scene_summary(self):
        res = self.bridge.send("scene_summary", {})
        if not _ok(res):
            raise RuntimeError("scene_summary failed: %s" % res)
        return _result(res)

    def get_outputs(self, definition_id=None):
        did = definition_id or self.definition_id
        res = self.bridge.send("get_grasshopper_outputs", {"definition_id": did})
        if not _ok(res):
            raise RuntimeError("get_outputs failed: %s" % res)
        return _result(res)

    def capture_viewport(self, path):
        """Capture Rhino viewport; decode base64 PNG to `path`; return evidence."""
        res = self.bridge.send("capture_viewport", {})
        if not _ok(res):
            raise RuntimeError("capture_viewport failed: %s" % res)
        b64 = _result(res).get("image_data", "")
        import base64
        raw = base64.b64decode(b64)
        with open(path, "wb") as fh:
            fh.write(raw)
        return {"path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

    def capture_canvas(self, path):
        res = self.bridge.send("capture_grasshopper_canvas",
                               {"definition_id": self.definition_id, "file_path": path})
        if not _ok(res):
            raise RuntimeError("capture_canvas failed: %s" % res)
        return _result(res)

    # -- geometry measurement (evidence layer) --------------------------------
    def mesh_stats(self):
        code = (
            "import Rhino\n"
            "rd=Rhino.RhinoDoc.ActiveDoc\n"
            "mc=0;mf=0;mv=0;bc=0\n"
            "for o in rd.Objects:\n"
            "    try:\n"
            "        g=o.Geometry\n"
            "        if g is None: continue\n"
            "        t=g.GetType().Name\n"
            "        if t=='Mesh': mc+=1;mf+=g.Faces.Count;mv+=g.Vertices.Count\n"
            "        elif t=='Brep': bc+=1\n"
            "    except: pass\n"
            'print "MESH_COUNT:"+str(mc)\n'
            'print "MESH_FACES:"+str(mf)\n'
            'print "MESH_VERTS:"+str(mv)\n'
            'print "BREP_COUNT:"+str(bc)\n'
        )
        res = self.bridge.execute(code)
        txt = _result(res).get("result", "") or ""
        stats = {}
        for line in txt.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                try:
                    stats[k.strip()] = int(v.strip())
                except ValueError:
                    pass
        return stats

    def measure_output_bbox(self):
        """Measure the lamp's primary output geometry bbox via GH volatile data.

        Reads the 'Results' (Brep) output of the Multi SDiff component — the final
        lattice shell — without baking (no side effects). Falls back to scene bbox.
        """
        code = r'''
import Grasshopper as gh
import Rhino
import System
out=[]
gdoc=None
try: gdoc=gh.Instances.ActiveCanvas.Document
except Exception as e: out.append("ERR:"+repr(e))
if gdoc is not None:
    bbox=None
    found=0
    for obj in gdoc.Objects:
        try:
            nm = obj.Name or ""
        except: nm=""
        if "SDiff" in nm or "SDF" in nm or "Results" in nm:
            try:
                outp = obj.Params.Output[0]
                vd = outp.VolatileData
                for pth in vd.Paths:
                    branch = vd.get_Path(pth)
                    for item in branch:
                        try:
                            sv = item.ScriptVariable()
                        except:
                            sv = None
                        if sv is None:
                            continue
                        bb=None
                        try:
                            bb = sv.GetBoundingBox(True)
                        except:
                            try:
                                bb = sv.GetBoundingBox(False)
                            except:
                                bb=None
                        if bb is not None:
                            found+=1
                            if bbox is None:
                                bbox=bb
                            else:
                                bbox.Union(bb)
            except Exception as e:
                out.append("OBJERR:"+repr(e)[:60])
    if bbox is not None:
        out.append("OUT_BBOX_MIN:{0},{1},{2}".format(bbox.Min.X,bbox.Min.Y,bbox.Min.Z))
        out.append("OUT_BBOX_MAX:{0},{1},{2}".format(bbox.Max.X,bbox.Max.Y,bbox.Max.Z))
        out.append("OUT_BBOX_SIZE:{0},{1},{2}".format(bbox.Max.X-bbox.Min.X,bbox.Max.Y-bbox.Min.Y,bbox.Max.Z-bbox.Min.Z))
    out.append("OUT_GEOM_COUNT:"+str(found))
print "\n".join(out)
'''
        res = self.bridge.execute(code)
        txt = _result(res).get("result", "") or ""
        m = {}
        for line in txt.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                k = k.strip()
                if k in ("OUT_BBOX_MIN", "OUT_BBOX_MAX", "OUT_BBOX_SIZE"):
                    try:
                        m[k] = [float(x) for x in v.split(",")]
                    except ValueError:
                        pass
                elif k == "OUT_GEOM_COUNT":
                    try:
                        m[k] = int(v.strip())
                    except ValueError:
                        pass
        return m

    def measure_all_outputs(self):
        """Map every Grasshopper output that currently holds geometry, with its
        union bounding box. Returns {output_key: {count, min, max, size}}.

        This is the measurement layer for the closed loop: it reads the LIVE solved
        graph (no baking, no side effects) so parameter changes are observable.
        """
        code = r'''
import Grasshopper as gh
import Rhino
import System
out=[]
gdoc=None
try: gdoc=gh.Instances.ActiveCanvas.Document
except Exception as e: out.append("ERR:"+repr(e))
if gdoc is not None:
    for obj in gdoc.Objects:
        try:
            nick = obj.NickName or ""
        except: nick=""
        try:
            params = obj.Params.Output
        except: continue
        if params is None: continue
        for pi in range(params.Count):
            try:
                op = params[pi]
                oname = op.Name or ""
                vd = op.VolatileData
                if vd is None: continue
                cnt = 0
                bbox = None
                for pth in vd.Paths:
                    branch = vd.get_Path(pth)
                    for item in branch:
                        cnt += 1
                        try: sv = item.ScriptVariable()
                        except: sv = None
                        if sv is None: continue
                        try: bb = sv.GetBoundingBox(True)
                        except:
                            try: bb = sv.GetBoundingBox(False)
                            except: bb = None
                        if bb is not None:
                            if bbox is None: bbox = bb
                            else: bbox.Union(bb)
                if cnt > 0:
                    if bbox is not None:
                        out.append("OUT|%s|%s|count=%d|min=%.4f,%.4f,%.4f|max=%.4f,%.4f,%.4f|size=%.4f,%.4f,%.4f" % (nick, oname, cnt, bbox.Min.X,bbox.Min.Y,bbox.Min.Z, bbox.Max.X,bbox.Max.Y,bbox.Max.Z, bbox.Max.X-bbox.Min.X, bbox.Max.Y-bbox.Min.Y, bbox.Max.Z-bbox.Min.Z))
                    else:
                        out.append("OUT|%s|%s|count=%d|nobbox" % (nick, oname, cnt))
            except: pass
    out.append("DONE")
print "\n".join(out)
'''
        res = self.bridge.execute(code)
        txt = _result(res).get("result", "") or ""
        result = {}
        for line in txt.splitlines():
            if not line.startswith("OUT|"):
                continue
            parts = line.split("|")
            if len(parts) < 4:
                continue
            nick, oname = parts[1], parts[2]
            entry = {"count": 0}
            for tok in parts[3:]:
                if tok.startswith("count="):
                    try:
                        entry["count"] = int(tok[6:])
                    except ValueError:
                        pass
                elif tok.startswith("min="):
                    try:
                        entry["min"] = [float(x) for x in tok[4:].split(",")]
                    except ValueError:
                        pass
                elif tok.startswith("max="):
                    try:
                        entry["max"] = [float(x) for x in tok[4:].split(",")]
                    except ValueError:
                        pass
                elif tok.startswith("size="):
                    try:
                        entry["size"] = [float(x) for x in tok[5:].split(",")]
                    except ValueError:
                        pass
                elif tok == "nobbox":
                    entry["nobbox"] = True
            result["%s.%s" % (nick, oname)] = entry
        return result

    def measure_height(self):
        """Return measured lamp height (output bbox Z size). Falls back to doc bbox."""
        ob = self.measure_output_bbox()
        if ob.get("OUT_BBOX_SIZE"):
            return ob["OUT_BBOX_SIZE"][2], ob
        ss = self.scene_summary()
        return ss["doc_bbox"]["size"][2], {"fallback": "doc_bbox"}

    # -- Phase 1: baseline ----------------------------------------------------
    def baseline(self, viewport_png, canvas_png):
        ss = self.scene_summary()
        vp = self.capture_viewport(viewport_png)
        try:
            cv = self.capture_canvas(canvas_png)
        except Exception as e:
            cv = {"error": str(e)}
        ms = self.mesh_stats()
        ob = self.measure_output_bbox()
        snap = {
            "scene_summary": ss,
            "viewport": vp,
            "canvas": cv,
            "object_count": ss.get("object_count"),
            "doc_bbox": ss.get("doc_bbox"),
            "mesh_stats": ms,
            "output_bbox": ob,
            "controls": {k: {f: v for f, v in c.items() if f in ("value", "min", "max")}
                         for k, c in self.controls.items()},
        }
        self.report["phases"].append({"phase": "1_baseline", "snapshot": snap})
        return snap

    def inspect_workspace(self, expected_features=None, results_dir=None):
        """FRS-014 Phase 1 inspection: scene + viewport/canvas captures + mesh stats
        + per-output geometry metrics + feature compliance booleans.

        expected_features: e.g. ["gyroid_lattice","parametric_controls",
        "mounting_collar","printable_mesh"]. Returns the full inspection dict and
        writes viewport.png / canvas.png into results_dir when provided.
        """
        if results_dir:
            os.makedirs(results_dir, exist_ok=True)
        ss = self.scene_summary()
        vp_path = os.path.join(results_dir, "viewport.png") if results_dir else None
        vp = self.capture_viewport(vp_path) if vp_path else self.capture_viewport(
            os.path.join("/tmp", "frs014_viewport.png"))
        try:
            cv = self.capture_canvas(os.path.join(results_dir or "/tmp", "canvas.png"))
        except Exception as e:
            cv = {"error": str(e)}
        ms = self.mesh_stats()
        outs = self.measure_all_outputs()
        controls = {k: {f: c.get(f) for f in ("value", "min", "max", "kind")}
                    for k, c in self.controls.items()}
        slider_count = sum(1 for c in self.controls.values() if c.get("kind") == "slider")
        # feature compliance (evidence-based, never assumed)
        gyroid = outs.get("Gyroid IsoMesh.M") or {}
        feats = {
            "gyroid_lattice": bool(gyroid.get("count", 0) > 0),
            "parametric_controls": slider_count >= 5,
            "mounting_collar": any(k.startswith("Mount Collar") and v.get("count", 0) > 0
                                   for k, v in outs.items()),
            "printable_mesh": bool(ms.get("MESH_FACES", 0) > 0),
        }
        if expected_features:
            feats = {f: feats.get(f, False) for f in expected_features}
        return {
            "scene_summary": ss, "viewport": vp, "canvas": cv,
            "mesh_stats": ms, "geometry_metrics": outs, "controls": controls,
            "slider_count": slider_count, "feature_compliance": feats,
        }

    # -- Phase 5: feedback loop ------------------------------------------------
    def feedback_loop(self, param, target, tol, start_value=None, max_iters=12,
                      height_offset=None):
        """Closed loop: read geometry -> adjust control -> solve -> inspect -> measure.

        Drives `param` until measured geometry height is within tol of target.
        height_offset: if the measured bbox Z includes a fixed offset (collar/base),
        pass it so the loop targets geometry height, not bbox extent.
        """
        trace = []
        if start_value is not None:
            self.set_parameter(param, start_value)
            self.solve()
        ctrl = self.get_control(param)
        lo, hi = float(ctrl["min"]), float(ctrl["max"])
        # learn offset on first measurement if not provided
        measured, ob = self.measure_height()
        if height_offset is None:
            height_offset = measured - float(ctrl["value"])
        it = 0
        while it < max_iters:
            it += 1
            measured, ob = self.measure_height()
            geom_h = measured - height_offset
            err = target - geom_h
            done = abs(err) <= tol
            trace.append({"iter": it, "slider": ctrl.get("value"),
                          "measured_bbox_z": measured, "geometry_height": geom_h,
                          "error": err, "within_tol": done, "output_bbox": ob})
            if done:
                break
            # proportional update: slider ~ 1:1 with geometry height
            new_slider = float(ctrl.get("value", 0)) + err
            new_slider = max(lo, min(hi, new_slider))
            self.set_parameter(param, new_slider)
            ctrl["value"] = new_slider
            self.solve()
        return {"param": param, "target": target, "tol": tol,
                "height_offset": height_offset, "iterations": trace,
                "converged": bool(trace) and trace[-1]["within_tol"],
                "final_geometry_height": trace[-1]["geometry_height"] if trace else None}

    # -- Phase 6: design intent ------------------------------------------------
    def design_intent(self, param_grid, score_fn=None):
        """Generate N variants, measure each, score, select winner.

        param_grid: list of dicts {param: value}. Each variant is set+solved+measured.
        score_fn(variant_result)->float (higher=better). Default favors taller + valid.
        """
        variants = []
        for i, params in enumerate(param_grid):
            for k, v in params.items():
                self.set_parameter(k, v)
            self.solve()
            measured, ob = self.measure_height()
            ms = self.mesh_stats()
            vr = {"variant": chr(ord("A") + i), "params": dict(params),
                  "measured_bbox_z": measured, "output_bbox": ob,
                  "mesh_stats": ms}
            variants.append(vr)
        if score_fn is None:
            def _default_score(vr):
                h = vr["output_bbox"].get("OUT_BBOX_SIZE", [0, 0, 0])[2] if vr["output_bbox"] else 0
                valid = 1 if vr["mesh_stats"].get("MESH_FACES", 0) > 0 else 0
                return h * (0.5 + 0.5 * valid)
            score_fn = _default_score
        for vr in variants:
            vr["score"] = score_fn(vr)
        winner = max(variants, key=lambda v: v["score"])
        return {"variants": variants, "winner": winner["variant"],
                "winner_params": winner["params"], "winner_score": winner["score"]}
