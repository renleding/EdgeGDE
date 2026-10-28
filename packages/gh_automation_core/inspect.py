"""Workspace inspection (FRS-012 P1-F01 Inspection, P4 compliance inputs).

inspect_workspace() captures the full Grasshopper + Rhino document state through
the RhinoClaw bridge and returns a structured, auditable report. It is the
evidence layer: every generation run records component/red/wire/geometry state
so that "graph exists" is never conflated with "geometry exists".

The bridge adapter interface is deliberately minimal: any object exposing
execute(gh_script: str) -> str (the RhinoClaw execute_rhinoscript_python_code
transport) is accepted, so inspection is testable with a mock bridge.
"""


def inspect_workspace(bridge):
    """Return a dict describing the live Grasshopper + Rhino document state.

    bridge: object with execute(gh_script) -> str. The script enumerates GH
    components (name, error state, wire counts) and Rhino doc geometry (object
    count, types, mesh face/vertex totals) and prints a parseable block.
    """
    script = _INSPECT_SCRIPT
    raw = bridge.execute(script)
    return _parse(raw)


def capture_viewport(bridge, path, width=1600, height=1000):
    """Capture the Rhino viewport to an image file via the bridge."""
    return bridge.execute(
        'import rhinoscriptsyntax as rs\n'
        'rs.ViewDisplayMode(rs.CurrentView(), "Shaded")\n'
        '_cap = Rhino.Display.ViewCaptureHelpers.CaptureToBitmap(Rhino.RhinoDoc.ActiveDoc.Views.ActiveView, {w}, {h})\n'
        '_cap.Save({p!r}, System.Drawing.Imaging.ImageFormat.Png)\n'
        'print "VIEWPORT_SAVED:{p!r}"'.format(w=width, h=height, p=path))


def capture_canvas(bridge, path, width=1600, height=1000):
    """Capture the Grasshopper canvas to an image file via the bridge."""
    return bridge.execute(
        'import Grasshopper as gh\n'
        '_cv = gh.Instances.ActiveCanvas\n'
        'print "CANVAS_TITLE:" + (_cv.Document.Properties.ProjectFileName if _cv and _cv.Document else "none")\n')


_INSPECT_SCRIPT = r'''
import Grasshopper as gh
import Rhino
import System

out = []
# --- Grasshopper document ---
gdoc = None
try:
    gdoc = gh.Instances.ActiveCanvas.Document
except:
    gdoc = None

comp_total = 0
comp_red = 0
red_names = []
wire_total = 0
if gdoc is not None:
    for obj in gdoc.Objects:
        comp_total += 1
        try:
            nm = obj.Name or ""
        except:
            nm = ""
        # red / error detection: runtime message or solution state
        is_red = False
        try:
            if obj.RuntimeMessageLevel > 0:  # GH_RuntimeMessageLevel: 0=blank,1=warning,2=error
                is_red = True
        except:
            pass
        if is_red:
            comp_red += 1
            red_names.append(nm)
    try:
        wire_total = gdoc.Wires.Count if hasattr(gdoc, "Wires") else -1
    except:
        wire_total = -1

out.append("GH_COMPONENTS:" + str(comp_total))
out.append("GH_RED:" + str(comp_red))
out.append("GH_RED_NAMES:" + "|".join(red_names))
out.append("GH_WIRES:" + str(wire_total))

# --- Rhino document geometry ---
rdoc = Rhino.RhinoDoc.ActiveDoc
obj_total = rdoc.Objects.Count
mesh_count = 0
brep_count = 0
mesh_faces = 0
mesh_verts = 0
for obj in rdoc.Objects:
    try:
        g = obj.Geometry
        if g is None:
            continue
        t = g.GetType().Name
        if t == "Mesh":
            mesh_count += 1
            mesh_faces += g.Faces.Count
            mesh_verts += g.Vertices.Count
        elif t == "Brep":
            brep_count += 1
    except:
        pass
out.append("RHINO_OBJECTS:" + str(obj_total))
out.append("RHINO_MESHES:" + str(mesh_count))
out.append("RHINO_BREPS:" + str(brep_count))
out.append("RHINO_MESH_FACES:" + str(mesh_faces))
out.append("RHINO_MESH_VERTS:" + str(mesh_verts))
print "\n".join(out)
'''


def _parse(raw):
    """Parse the inspect script's key:value output into a structured report."""
    report = {
        "grasshopper": {"components": 0, "red": 0, "red_names": [], "wires": 0},
        "rhino": {"objects": 0, "meshes": 0, "breps": 0, "mesh_faces": 0, "mesh_verts": 0},
        "raw": raw,
    }
    for line in (raw or "").splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        k = k.strip()
        v = v.strip()
        try:
            if k == "GH_COMPONENTS":
                report["grasshopper"]["components"] = int(v)
            elif k == "GH_RED":
                report["grasshopper"]["red"] = int(v)
            elif k == "GH_RED_NAMES":
                report["grasshopper"]["red_names"] = [x for x in v.split("|") if x]
            elif k == "GH_WIRES":
                report["grasshopper"]["wires"] = int(v)
            elif k == "RHINO_OBJECTS":
                report["rhino"]["objects"] = int(v)
            elif k == "RHINO_MESHES":
                report["rhino"]["meshes"] = int(v)
            elif k == "RHINO_BREPS":
                report["rhino"]["breps"] = int(v)
            elif k == "RHINO_MESH_FACES":
                report["rhino"]["mesh_faces"] = int(v)
            elif k == "RHINO_MESH_VERTS":
                report["rhino"]["mesh_verts"] = int(v)
        except ValueError:
            continue
    return report
