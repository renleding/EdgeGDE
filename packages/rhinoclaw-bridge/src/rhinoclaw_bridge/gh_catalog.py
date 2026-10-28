"""
GHComponentCatalog - Capability-based lookup for Grasshopper component proxies.
Maps (category, operation) -> GUID with input/output schemas.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field


@dataclass
class ComponentPort:
    """Input or output port definition."""
    name: str
    nickname: str
    type_name: str
    access: str = "item"  # item, list, tree


@dataclass
class ComponentSpec:
    """Complete component specification."""
    category: str
    operation: str
    guid: str
    name: str
    nickname: str
    inputs: List[ComponentPort] = field(default_factory=list)
    outputs: List[ComponentPort] = field(default_factory=list)
    description: str = ""


class GHComponentCatalog:
    """
    Capability-based component catalog.
    Usage:
        catalog = GHComponentCatalog()
        spec = catalog.find(category="Surface", operation="Revolve")
        spec = catalog.get("Cylinder")
    """
    
    def __init__(self):
        self._by_id: Dict[str, ComponentSpec] = {}
        self._by_name: Dict[str, ComponentSpec] = {}
        self._by_category_op: Dict[str, Dict[str, ComponentSpec]] = {}
        self._load_catalog()
    
    def _load_catalog(self):
        """Load all verified component specifications."""
        specs = self._get_core_specs()
        for spec in specs:
            self._by_id[spec.guid] = spec
            self._by_name[spec.name] = spec
            if spec.category not in self._by_category_op:
                self._by_category_op[spec.category] = {}
            self._by_category_op[spec.category][spec.operation] = spec
    
    def _get_core_specs(self) -> List[ComponentSpec]:
        """Return all verified component specs."""
        return [
            # ===== PRIMITIVES =====
            ComponentSpec(
                category="Primitive",
                operation="Cylinder",
                guid="0373008a-80ee-45be-887d-ab5a244afc29",
                name="Cylinder",
                nickname="Cyl",
                inputs=[
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("Radius", "R", "Number"),
                    ComponentPort("Height", "H", "Number"),
                ],
                outputs=[
                    ComponentPort("Cylinder", "C", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Primitive",
                operation="Circle",
                guid="807b86e3-be8d-4970-92b5-f8cdcb45b06b",
                name="Circle",
                nickname="Cir",
                inputs=[
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("Radius", "R", "Number"),
                ],
                outputs=[
                    ComponentPort("Circle", "C", "Curve"),
                ]
            ),
            ComponentSpec(
                category="Primitive",
                operation="Cone",
                guid="03e331ed-c4d1-4a23-afa2-f57b87d2043c",
                name="Cone",
                nickname="Cone",
                inputs=[
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("Radius", "R", "Number"),
                    ComponentPort("Height", "H", "Number"),
                ],
                outputs=[
                    ComponentPort("Cone", "C", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Primitive",
                operation="Rectangle",
                guid="0ca0a214-396c-44ea-b22f-d3a1757c32d6",
                name="Rectangle",
                nickname="Rectangle",
                inputs=[
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("X Size", "X", "Number"),
                    ComponentPort("Y Size", "Y", "Number"),
                ],
                outputs=[
                    ComponentPort("Rectangle", "R", "Curve"),
                ]
            ),
            ComponentSpec(
                category="Primitive",
                operation="Box",
                guid="",  # TODO: find Box GUID
                name="Box",
                nickname="Box",
                inputs=[
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("X", "X", "Number"),
                    ComponentPort("Y", "Y", "Number"),
                    ComponentPort("Z", "Z", "Number"),
                ],
                outputs=[
                    ComponentPort("Box", "B", "Brep"),
                ]
            ),
            
            # ===== SURFACE CREATION =====
            ComponentSpec(
                category="Surface",
                operation="Loft",
                guid="342aa574-1327-4bc2-8daf-203da2a45676",
                name="Fit Loft",
                nickname="FitLoft",
                inputs=[
                    ComponentPort("Curves", "C", "Curve", "list"),
                    ComponentPort("Start", "S", "Curve"),
                    ComponentPort("End", "E", "Curve"),
                ],
                outputs=[
                    ComponentPort("Loft", "L", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Surface",
                operation="Sweep2",
                guid="75164624-395a-4d24-b60b-6bf91cab0194",
                name="Sweep2",
                nickname="Swp2",
                inputs=[
                    ComponentPort("Rail 1", "R1", "Curve"),
                    ComponentPort("Rail 2", "R2", "Curve"),
                    ComponentPort("Sections", "S", "Curve", "list"),
                ],
                outputs=[
                    ComponentPort("Sweep", "S", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Surface",
                operation="Extrude",
                guid="1c2dec64-1c15-42c1-a870-9b23bc2fe54b",
                name="Extrude Polyline",
                nickname="Extrude Polyline",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Direction", "D", "Vector"),
                ],
                outputs=[
                    ComponentPort("Extrusion", "E", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Surface",
                operation="Pipe",
                guid="3e6bb383-d3dc-4bd2-b44d-d47b5a5d3e45",
                name="Pipe Variable",
                nickname="VPipe",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Radius", "R", "Number"),
                ],
                outputs=[
                    ComponentPort("Pipe", "P", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Surface",
                operation="BoundarySurface",
                guid="d51e9b65-aa4e-4fd6-976c-cef35d421d05",
                name="Boundary Surfaces",
                nickname="Boundary",
                inputs=[
                    ComponentPort("Curves", "E", "Curve", "list"),
                ],
                outputs=[
                    ComponentPort("Surfaces", "S", "Brep", "list"),
                ]
            ),
            ComponentSpec(
                category="Surface",
                operation="Isotrim",
                guid="6a9ccaab-1b03-484e-bbda-be9c81584a66",
                name="Isotrim",
                nickname="SubSrf",
                inputs=[
                    ComponentPort("Surface", "S", "Brep"),
                    ComponentPort("Domain", "D", "Domain2D"),
                ],
                outputs=[
                    ComponentPort("Surface", "S", "Brep"),
                ]
            ),
            
            # ===== BOOLEAN OPERATIONS =====
            ComponentSpec(
                category="Boolean",
                operation="Union",
                guid="10434a15-da85-4281-bb64-a2b3a995b9c6",
                name="Solid Union",
                nickname="SUnion",
                inputs=[
                    ComponentPort("Breps A", "A", "Brep", "list"),
                    ComponentPort("Breps B", "B", "Brep", "list"),
                ],
                outputs=[
                    ComponentPort("Union", "U", "Brep", "list"),
                ]
            ),
            ComponentSpec(
                category="Boolean",
                operation="Difference",
                guid="391bea31-f003-43e1-a59f-62a267997368",
                name="Multi SDiff",
                nickname="MSDiff",
                inputs=[
                    ComponentPort("Breps A", "A", "Brep", "list"),
                    ComponentPort("Breps B", "B", "Brep", "list"),
                ],
                outputs=[
                    ComponentPort("Difference", "D", "Brep", "list"),
                ]
            ),
            ComponentSpec(
                category="Boolean",
                operation="Intersection",
                guid="5723c845-cafc-442d-a667-8c76532845e6",
                name="Solid Intersection",
                nickname="SInt",
                inputs=[
                    ComponentPort("Breps A", "A", "Brep", "list"),
                    ComponentPort("Breps B", "B", "Brep", "list"),
                ],
                outputs=[
                    ComponentPort("Intersection", "I", "Brep", "list"),
                ]
            ),
            
            # ===== TRANSFORM =====
            ComponentSpec(
                category="Transform",
                operation="Twist",
                guid="9509cb30-d24f-4f55-a5ac-bf0b12a06cfa",
                name="Twist",
                nickname="Twist",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Angle", "A", "Number"),
                    ComponentPort("Axis", "X", "Vector"),
                    ComponentPort("Center", "C", "Point"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="ScaleNU",
                guid="290f418a-65ee-406a-a9d0-35699815b512",
                name="Scale NU",
                nickname="Scale NU",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("X Factor", "X", "Number"),
                    ComponentPort("Y Factor", "Y", "Number"),
                    ComponentPort("Z Factor", "Z", "Number"),
                    ComponentPort("Center", "C", "Point"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="Move",
                guid="4fe87ef8-49e4-4605-9859-87940d62e1de",
                name="Move To Plane",
                nickname="MoveToPlane",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Plane", "P", "Plane"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="Rotate",
                guid="0d266dca-8bb6-4cf9-8e94-09ccc744232b",
                name="Rotate Vectors",
                nickname="RotVectors",
                inputs=[
                    ComponentPort("Vectors", "V", "Vector", "list"),
                    ComponentPort("Angle", "A", "Number"),
                    ComponentPort("Axis", "X", "Vector"),
                ],
                outputs=[
                    ComponentPort("Vectors", "V", "Vector", "list"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="ArrayLinear",
                guid="e87db220-a0a0-4d67-a405-f97fd14b2d7a",
                name="Linear Array",
                nickname="ArrLinear",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Direction", "D", "Vector"),
                    ComponentPort("Count", "N", "Integer"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry", "list"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="ArrayPolar",
                guid="fca5ad7e-ecac-401d-a357-edda0a251cbc",
                name="Polar Array",
                nickname="ArrPolar",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Axis", "A", "Vector"),
                    ComponentPort("Count", "N", "Integer"),
                    ComponentPort("Angle", "R", "Number"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry", "list"),
                ]
            ),
            ComponentSpec(
                category="Transform",
                operation="Mirror",
                guid="3431f5c6-7578-4d26-a2b6-dfc064a9c65e",
                name="Mirror Surface",
                nickname="Mirror",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Plane", "P", "Plane"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ]
            ),
            
            # ===== DECONSTRUCTION =====
            ComponentSpec(
                category="Deconstruct",
                operation="DeconstructBrep",
                guid="8d372bdc-9800-45e9-8a26-6e33c5253e21",
                name="Deconstruct Brep",
                nickname="DeBrep",
                inputs=[
                    ComponentPort("Brep", "B", "Brep"),
                ],
                outputs=[
                    ComponentPort("Faces", "F", "Brep", "list"),
                    ComponentPort("Edges", "E", "Curve", "list"),
                    ComponentPort("Vertices", "V", "Point", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="JoinCurves",
                guid="8073a420-6bec-49e3-9b18-367f6fd76ac3",
                name="Join Curves",
                nickname="Join",
                inputs=[
                    ComponentPort("Curves", "C", "Curve", "list"),
                ],
                outputs=[
                    ComponentPort("Curves", "C", "Curve", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="CapHoles",
                guid="b648d933-ddea-4e75-834c-8f6f3793e311",
                name="Cap Holes",
                nickname="Cap",
                inputs=[
                    ComponentPort("Brep", "B", "Brep"),
                ],
                outputs=[
                    ComponentPort("Brep", "B", "Brep"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="MeshBrep",
                guid="60e7defa-8b21-4ee1-99aa-a9223d6134ff",
                name="Mesh Brep",
                nickname="Mesh",
                inputs=[
                    ComponentPort("Brep", "B", "Brep"),
                    ComponentPort("Settings", "S", "MeshSettings"),
                ],
                outputs=[
                    ComponentPort("Mesh", "M", "Mesh"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="BoundingBox",
                guid="0bb3d234-9097-45db-9998-621639c87d3b",
                name="Bounding Box",
                nickname="BBox",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ],
                outputs=[
                    ComponentPort("Box", "B", "Box"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="Area",
                guid="1eb7b856-ec7d-40b6-a76c-f216a11df37c",
                name="Area Moments",
                nickname="AMoments",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ],
                outputs=[
                    ComponentPort("Area", "A", "Number"),
                    ComponentPort("Centroid", "C", "Point"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="Centroid",
                guid="afbcbad4-2a2a-4954-8040-d999e316d2bd",
                name="Centroid",
                nickname="Centroid",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ],
                outputs=[
                    ComponentPort("Centroid", "C", "Point"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="EvaluateSurface",
                guid="353b206e-bde5-4f02-a913-b3b8a977d4b9",
                name="Evaluate Surface",
                nickname="EvalSrf",
                inputs=[
                    ComponentPort("Surface", "S", "Brep"),
                    ComponentPort("Parameter", "uv", "Point"),  # UV point
                ],
                outputs=[
                    ComponentPort("Point", "P", "Point"),
                    ComponentPort("Normal", "N", "Vector"),
                    ComponentPort("Frame", "F", "Plane"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="EvaluateCurve",
                guid="164d0429-e5f5-4292-aa80-3f88d43cdac2",
                name="Evaluate Curve",
                nickname="Eval",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Parameter", "t", "Number"),
                ],
                outputs=[
                    ComponentPort("Point", "P", "Point"),
                    ComponentPort("Tangent", "T", "Vector"),
                    ComponentPort("Normal", "N", "Vector"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="DivideSurface",
                guid="082976f0-c741-4df8-a1d4-89891bf8619f",
                name="Divide Surface",
                nickname="Divide",
                inputs=[
                    ComponentPort("Surface", "S", "Brep"),
                    ComponentPort("U Count", "U", "Integer"),
                    ComponentPort("V Count", "V", "Integer"),
                ],
                outputs=[
                    ComponentPort("Points", "P", "Point", "list"),
                    ComponentPort("UV Params", "uv", "Point", "list"),
                    ComponentPort("Normals", "N", "Vector", "list"),
                    ComponentPort("Frames", "F", "Plane", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="DivideCurve",
                guid="2162e72e-72fc-4bf8-9459-d4d82fa8aa14",
                name="Divide Curve",
                nickname="Divide",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Count", "N", "Integer"),
                ],
                outputs=[
                    ComponentPort("Points", "P", "Point", "list"),
                    ComponentPort("Parameters", "t", "Number", "list"),
                    ComponentPort("Tangents", "T", "Vector", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="CurveFrames",
                guid="0e94542a-2e46-4793-9f98-2200b06b28f4",
                name="Curve Frames",
                nickname="Frames",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Count", "N", "Integer"),
                ],
                outputs=[
                    ComponentPort("Frames", "F", "Plane", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="Contour",
                guid="246cda78-5e88-4087-ba09-ae082bbc4af8",
                name="Contour (ex)",
                nickname="Contour",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Start", "S", "Point"),
                    ComponentPort("Direction", "D", "Vector"),
                    ComponentPort("Distance", "d", "Number"),
                ],
                outputs=[
                    ComponentPort("Curves", "C", "Curve", "list"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="Project",
                guid="06d7bc4a-ba3e-4445-8ab5-079613b52f28",
                name="Project Along",
                nickname="ProjectA",
                inputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                    ComponentPort("Plane", "P", "Plane"),
                    ComponentPort("Direction", "D", "Vector"),
                ],
                outputs=[
                    ComponentPort("Geometry", "G", "Geometry"),
                ]
            ),
            ComponentSpec(
                category="Deconstruct",
                operation="Pull",
                guid="6b5812f5-bb36-4d74-97fc-5a1f2f77452d",
                name="Pull Curve",
                nickname="Pull",
                inputs=[
                    ComponentPort("Curve", "C", "Curve"),
                    ComponentPort("Surface", "S", "Brep"),
                ],
                outputs=[
                    ComponentPort("Curve", "C", "Curve"),
                ]
            ),
            
            # ===== DATA TREE / LIST =====
            ComponentSpec(
                category="Data",
                operation="Graft",
                guid="10a8674b-f4bb-4fdf-a56e-94dc606ecf33",
                name="Graft Tree",
                nickname="Graft",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ],
                outputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Flatten",
                guid="59e5dd6c-f07f-4621-996c-9ecaa6e6ee38",
                name="Flatten Mesh",
                nickname="FlattenMesh",
                inputs=[
                    ComponentPort("Data", "D", "Generic", "tree"),
                ],
                outputs=[
                    ComponentPort("Data", "D", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Simplify",
                guid="06b3086c-1e9d-41c2-bcfc-bb843156196e",
                name="Simplify Tree",
                nickname="Simplify",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ],
                outputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Dispatch",
                guid="0da3589c-af65-42ac-80ce-409f8332314b",
                name="Dispatch Multiple",
                nickname="MDispatch",
                inputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                    ComponentPort("Pattern", "P", "Boolean", "list"),
                ],
                outputs=[
                    ComponentPort("List A", "A", "Generic", "list"),
                    ComponentPort("List B", "B", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Cull",
                guid="008e9a6f-478a-4813-8c8a-546273bc3a6b",
                name="Cull Pattern",
                nickname="Cull",
                inputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                    ComponentPort("Pattern", "P", "Boolean", "list"),
                ],
                outputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Weave",
                guid="160c1df2-e2e8-48e5-b538-f2d6981007e3",
                name="Weave",
                nickname="Weave",
                inputs=[
                    ComponentPort("Pattern", "P", "Integer", "list"),
                    ComponentPort("Stream 0", "0", "Generic", "list"),
                    ComponentPort("Stream 1", "1", "Generic", "list"),
                ],
                outputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="Merge",
                guid="0b6c5dac-6c93-4158-b8d1-ca3187d45f25",
                name="Merge Multiple",
                nickname="Merge",
                inputs=[
                    ComponentPort("Stream 0", "0", "Generic", "list"),
                    ComponentPort("Stream 1", "1", "Generic", "list"),
                ],
                outputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="ListItem",
                guid="285ddd8a-5398-4a3e-b3c2-361025711a51",
                name="List Item",
                nickname="Item",
                inputs=[
                    ComponentPort("List", "L", "Generic", "list"),
                    ComponentPort("Index", "i", "Integer"),
                ],
                outputs=[
                    ComponentPort("Item", "i", "Generic"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="TreeBranch",
                guid="3a710c1e-1809-4e19-8c15-82adce31cd62",
                name="Tree Branch",
                nickname="Branch",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                    ComponentPort("Path", "P", "Path"),
                ],
                outputs=[
                    ComponentPort("Branch", "B", "Generic", "list"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="SplitTree",
                guid="d8b1e7ac-cd31-4748-b262-e07e53068afc",
                name="Split Tree",
                nickname="Split",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                    ComponentPort("Mask", "M", "Boolean", "list"),
                ],
                outputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="ReplacePaths",
                guid="bfaaf799-77dc-4f31-9ad8-2f7d1a80aeb0",
                name="Replace Paths",
                nickname="Replace",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                    ComponentPort("Pattern", "P", "String"),
                    ComponentPort("Replacement", "R", "String"),
                ],
                outputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ]
            ),
            ComponentSpec(
                category="Data",
                operation="PathMapper",
                guid="f9b89a46-bc5d-4f7a-9a6f-134f93ac3af9",
                name="Path Mapper",
                nickname="Path Mapper",
                inputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                    ComponentPort("Lexicon", "L", "String"),
                ],
                outputs=[
                    ComponentPort("Tree", "T", "Generic", "tree"),
                ]
            ),
            
            # ===== NUMERIC / PARAMETER =====
            ComponentSpec(
                category="Parameter",
                operation="Remap",
                guid="2fcc2743-8339-4cdf-a046-a1f17439191d",
                name="Remap Numbers",
                nickname="ReMap",
                inputs=[
                    ComponentPort("Value", "V", "Number"),
                    ComponentPort("Source Domain", "S", "Domain"),
                    ComponentPort("Target Domain", "T", "Domain"),
                ],
                outputs=[
                    ComponentPort("Value", "V", "Number"),
                ]
            ),
            ComponentSpec(
                category="Parameter",
                operation="Random",
                guid="2ab17f9a-d852-4405-80e1-938c5e57e78d",
                name="Random",
                nickname="Random",
                inputs=[
                    ComponentPort("Count", "C", "Integer"),
                    ComponentPort("Domain", "D", "Domain"),
                    ComponentPort("Seed", "S", "Integer"),
                ],
                outputs=[
                    ComponentPort("Numbers", "N", "Number", "list"),
                ]
            ),
            ComponentSpec(
                category="Parameter",
                operation="GraphMapper",
                guid="bc984576-7aa6-491f-a91d-e444c33675a7",
                name="Graph Mapper",
                nickname="Graph",
                inputs=[
                    ComponentPort("Value", "V", "Number"),
                    ComponentPort("Graph", "G", "Curve"),
                ],
                outputs=[
                    ComponentPort("Value", "V", "Number"),
                ]
            ),
            
            # ===== CONSTRUCT =====
            ComponentSpec(
                category="Construct",
                operation="ConstructPoint",
                guid="3581f42a-9592-4549-bd6b-1c0fc39d067b",
                name="Construct Point",
                nickname="Pt",
                inputs=[
                    ComponentPort("X", "X", "Number"),
                    ComponentPort("Y", "Y", "Number"),
                    ComponentPort("Z", "Z", "Number"),
                ],
                outputs=[
                    ComponentPort("Point", "P", "Point"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="ConstructPlane",
                guid="bc3e379e-7206-4e7b-b63a-ff61f4b38a3e",
                name="Construct Plane",
                nickname="Pl",
                inputs=[
                    ComponentPort("Origin", "O", "Point"),
                    ComponentPort("X Axis", "X", "Vector"),
                    ComponentPort("Y Axis", "Y", "Vector"),
                ],
                outputs=[
                    ComponentPort("Plane", "P", "Plane"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="UnitX",
                guid="79f9fbb3-8f1d-4d9a-88a9-f7961b1012cd",
                name="Unit X",
                nickname="X",
                inputs=[],
                outputs=[
                    ComponentPort("Vector", "V", "Vector"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="UnitY",
                guid="d3d195ea-2d59-4ffa-90b1-8b7ff3369f69",
                name="Unit Y",
                nickname="Y",
                inputs=[],
                outputs=[
                    ComponentPort("Vector", "V", "Vector"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="UnitZ",
                guid="9103c240-a6a9-4223-9b42-dbd19bf38e2b",
                name="Unit Z",
                nickname="Z",
                inputs=[],
                outputs=[
                    ComponentPort("Vector", "V", "Vector"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="PlaneXY",
                guid="17b7152b-d30d-4d50-b9ef-c9fe25576fc2",
                name="XY Plane",
                nickname="XY",
                inputs=[],
                outputs=[
                    ComponentPort("Plane", "P", "Plane"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="PlaneYZ",
                guid="fad344bc-09b1-4855-a2e6-437ef5715fe3",
                name="YZ Plane",
                nickname="YZ",
                inputs=[],
                outputs=[
                    ComponentPort("Plane", "P", "Plane"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="Plane3Pt",
                guid="c98a6015-7a2f-423c-bc66-bdc505249b45",
                name="Plane 3Pt",
                nickname="Pl 3Pt",
                inputs=[
                    ComponentPort("A", "A", "Point"),
                    ComponentPort("B", "B", "Point"),
                    ComponentPort("C", "C", "Point"),
                ],
                outputs=[
                    ComponentPort("Plane", "P", "Plane"),
                ]
            ),
            ComponentSpec(
                category="Construct",
                operation="PlaneFromNormal",
                guid="cfb6b17f-ca82-4f5d-b604-d4f69f569de3",
                name="Plane Normal",
                nickname="Pl",
                inputs=[
                    ComponentPort("Origin", "O", "Point"),
                    ComponentPort("Normal", "Z", "Vector"),
                ],
                outputs=[
                    ComponentPort("Plane", "P", "Plane"),
                ]
            ),
            
            # ===== INPUT PARAMETERS =====
            ComponentSpec(
                category="Parameter",
                operation="NumberSlider",
                guid="57da07bd-ecab-415d-9d86-af36d7073abc",
                name="Number Slider",
                nickname="",
                inputs=[],
                outputs=[
                    ComponentPort("Value", "N", "Number"),
                ]
            ),
            
            # ===== UTILITY =====
            ComponentSpec(
                category="Utility",
                operation="DeconstructDomain",
                guid="825ea536-aebb-41e9-af32-8baeb2ecb590",
                name="Deconstruct Domain",
                nickname="DeDomain",
                inputs=[
                    ComponentPort("Domain", "D", "Domain"),
                ],
                outputs=[
                    ComponentPort("Start", "S", "Number"),
                    ComponentPort("End", "E", "Number"),
                ]
            ),
            ComponentSpec(
                category="Utility",
                operation="ConstructDomain",
                guid="d1a28e95-cf96-4936-bf34-8bf142d731bf",
                name="Construct Domain",
                nickname="Dom",
                inputs=[
                    ComponentPort("Start", "S", "Number"),
                    ComponentPort("End", "E", "Number"),
                ],
                outputs=[
                    ComponentPort("Domain", "D", "Domain"),
                ]
            ),
            ComponentSpec(
                category="Utility",
                operation="Series",
                guid="586706a8-109b-43ec-b581-743e920c951a",
                name="Series Addition",
                nickname="SA",
                inputs=[
                    ComponentPort("Start", "S", "Number"),
                    ComponentPort("Step", "N", "Number"),
                    ComponentPort("Count", "C", "Integer"),
                ],
                outputs=[
                    ComponentPort("Series", "S", "Number", "list"),
                ]
            ),
            ComponentSpec(
                category="Utility",
                operation="Range",
                guid="38a4e722-ad5a-4229-a170-e27ae1345538",
                name="Date Range",
                nickname="RDate",
                inputs=[
                    ComponentPort("Domain", "D", "Domain"),
                    ComponentPort("Steps", "N", "Integer"),
                ],
                outputs=[
                    ComponentPort("Range", "R", "Number", "list"),
                ]
            ),
        ]
    
    def get(self, name_or_guid: str) -> Optional[ComponentSpec]:
        """Get spec by name or GUID."""
        return self._by_id.get(name_or_guid) or self._by_name.get(name_or_guid)
    
    def find(self, category: str, operation: str) -> Optional[ComponentSpec]:
        """Find by category and operation (capability-based)."""
        return self._by_category_op.get(category, {}).get(operation)
    
    def list_categories(self) -> List[str]:
        return list(self._by_category_op.keys())
    
    def list_operations(self, category: str) -> List[str]:
        return list(self._by_category_op.get(category, {}).keys())
    
    def search(self, query: str) -> List[ComponentSpec]:
        """Search by name/nickname/operation."""
        query = query.lower()
        results = []
        for spec in self._by_id.values():
            if (query in spec.name.lower() or 
                query in spec.nickname.lower() or 
                query in spec.operation.lower() or
                query in spec.category.lower()):
                results.append(spec)
        return results


# Global instance
CATALOG = GHComponentCatalog()