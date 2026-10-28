# Rhino Developer Resources

## Core Documentation

| Resource | URL | Description |
|----------|-----|-------------|
| **Developer Hub** | https://developer.rhino3d.com/ | Main Rhino developer landing page |
| **Guides** | https://developer.rhino3d.com/guides/ | Step-by-step tutorials and guides |
| **API Reference** | https://developer.rhino3d.com/api/ | Complete API documentation |
| **RhinoCommon API** | https://developer.rhino3d.com/api/RhinoCommon/ | .NET API for Rhino (Python 3 / RhinoCode) |
| **RhinoScriptSyntax** | https://developer.rhino3d.com/api/RhinoScriptSyntax/ | Python 2.7 / IronPython API (legacy) |

## Grasshopper Resources

| Resource | URL | Description |
|----------|-----|-------------|
| **Grasshopper Developer** | https://developer.rhino3d.com/guides/grasshopper/ | Grasshopper plugin development |
| **GH Component SDK** | https://developer.rhino3d.com/guides/grasshopper/ | Building custom components |
| **GH Data Trees** | https://developer.rhino3d.com/guides/grasshopper/data-trees/ | Understanding data trees |
| **GH Remote Control** | https://developer.rhino3d.com/guides/grasshopper/remote-control-panel/ | Headless GH execution |

## Python / RhinoCode

| Resource | URL | Description |
|----------|-----|-------------|
| **RhinoCode Setup** | https://developer.rhino3d.com/guides/rhinocode/ | Python 3 in Rhino |
| **RhinoCommon Cookbook** | https://developer.rhino3d.com/guides/rhinocommon/cookbook/ | Common patterns |
| **Python 3 in Rhino** | https://developer.rhino3d.com/guides/rhinocode/python-3/ | CPython vs IronPython |

## VisualARQ

| Resource | URL | Description |
|----------|-----|-------------|
| **VisualARQ API** | https://www.visualarq.com/api/ | BIM objects (walls, slabs, etc.) |
| **VisualARQ Feature Documentation** | https://www.visualarq.com/feature/documentation/ | Complete feature reference (walls, slabs, stairs, etc.) |

## Lands Design

| Resource | URL | Description |
|----------|-----|-------------|
| **Lands Design Help** | https://help.landsdesign.com/ | Landscape architecture plugin docs (terrain, plants, irrigation) |

## RhinoClaw / Plugin Development

| Resource | URL | Description |
|----------|-----|-------------|
| **RhinoClaw ClawHub Skill** | https://clawhub.ai/mcmuff86/skills/rhinoclaw | Official skill registry (MCP tools/commands reference) |
| **RhinoClaw GitHub** | https://github.com/McMuff86/rhinoclaw-release | Plugin source |
| **Rhino Plugin Dev** | https://developer.rhino3d.com/guides/rhinocommon/your-first-plugin-windows/ | C# plugin template |

## Key API Namespaces (RhinoCommon)

```python
# Core Geometry
import Rhino.Geometry as rg
# rg.Point3d, rg.Vector3d, rg.Plane, rg.Box, rg.Sphere, rg.Cylinder
# rg.Circle, rg.Arc, rg.NurbsCurve, rg.NurbsSurface, rg.Brep, rg.Mesh

# Document Objects
import Rhino.DocObjects as rd
# rd.ObjectAttributes, rd.Layer, rd.Material, rd.ObjectTable

# Display
import Rhino.Display as rdp
# rdp.DisplayPipeline, rdp.Viewport

# Commands
import Rhino.Commands as rc
# rc.Command, rc.Result

# Input
import Rhino.Input as ri
# ri.RhinoGet.GetPoint, ri.RhinoGet.GetObject

# Intersect
import Rhino.Geometry.Intersect as rgx
# rgx.Intersection.CurveCurve, rgx.Intersection.BrepBrep
```

## Useful Rhino Commands (Native)

```python
# Via run_native_command (from allowlist)
"_Loft", "_Sweep1", "_Sweep2", "_Revolve", "_NetworkSrf"
"_ExtrudeCrv", "_ExtrudeSrf", "_OffsetSrf", "_CapPlanarHoles"
"_BooleanUnion", "_BooleanDifference", "_BooleanIntersection"
"_Move", "_Rotate", "_Rotate3D", "_Scale", "_Scale1D", "_Scale2D"
"_Mirror", "_Array", "_ArrayPolar", "_ArrayLinear"
"_Trim", "_Split", "_Untrim", "_Project", "_Pull"
"_Intersect", "_DupEdge", "_DupBorder", "_Mesh", "_MeshUnion"
"_MeshDifference", "_MeshIntersection"
"_ZoomExtents", "_ZoomSelected", "_SelLayer", "_SelAll", "_SelNone"
```

## Lattice Lamp Project Specific

| File | Purpose |
|------|---------|
| `docs/FRS-010-parametric-lattice-lamp.md` | Functional requirements (12 params) |
| `docs/SDD-010-parametric-lattice-lamp.md` | System design with inspection levels |
| `docs/IDD-010-parametric-lattice-lamp.md` | Interface contracts (MCP/TCP) |
| `gh-definitions/lattice_lamp_v1.gh` | Grasshopper definition (to be created) |
| `packages/rhinoclaw-client/` | Python TCP client |
| `packages/rhinoclaw-bridge/` | MCP ↔ TCP bridge |

## Quick Links

- **Rhino 8 API Changes**: https://developer.rhino3d.com/guides/rhinocommon/what-is-new-in-rhino-8/
- **Python 3 Migration**: https://developer.rhino3d.com/guides/rhinocode/migrating-from-ironpython/
- **GH Remote Control**: https://developer.rhino3d.com/guides/grasshopper/remote-control-panel/
- **Mesh Validation**: https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_Geometry_Mesh_IsClosed.htm