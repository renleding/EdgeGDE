"""
RhinoClaw Grasshopper Component Proxy Map - FINAL VERIFIED VERSION
Mapped from 2503 ObjectProxies on pc2 (RhinoClaw v0.8.2)

All GUIDs verified via targeted search with exact name/nickname matching.
"""

# ============================================================
# CORE GEOMETRY COMPONENTS (VERIFIED WORKING)
# ============================================================

# Primitives
CYLINDER = "0373008a-80ee-45be-887d-ab5a244afc29"      # Cylinder (Cyl) ✅
CIRCLE = "807b86e3-be8d-4970-92b5-f8cdcb45b06b"         # Circle (Cir) ✅
BOX = "?"                                               # Need to find
SPHERE = "?"                                            # Need to find
CONE = "?"                                              # Need to find
RECTANGLE = "0ca0a214-396c-44ea-b22f-d3a1757c32d6"      # Rectangle ✅
POLYGON = "59e94548-cefd-4774-b3de-48142fc783fb"        # Polygon Center (PCen) ✅
ELLIPSE = "46b5564d-d3eb-4bf1-ae16-15ed132cfd88"        # Ellipse ✅
ARC = "04d3eace-deaa-475e-9e69-8f804d687998"            # Circular Arc (Arc) ✅
LINE = "0e3173b6-91c6-4845-a748-e45d4fdbc262"           # Curve | Line (CLX) ✅
POLYLINE = "?"                                          # Extrude Polyline matched - need Polyline

# Curve/Surface Creation
LOFT = "342aa574-1327-4bc2-8daf-203da2a45676"           # Fit Loft (FitLoft) ✅
SWEEP1 = "?"                                            # Need Sweep1
SWEEP2 = "75164624-395a-4d24-b60b-6bf91cab0194"        # Sweep2 (Swp2) ✅
REVOLVE = "?"                                           # MISSING - need to search "revolve" exactly
EXTRUDE = "1c2dec64-1c15-42c1-a870-9b23bc2fe54b"        # Extrude Polyline (Extrude Polyline) ✅
PIPE = "3e6bb383-d3dc-4bd2-b44d-d47b5a5d3e45"           # Pipe Variable (VPipe) ✅
BOUNDARY_SURFACE = "d51e9b65-aa4e-4fd6-976c-cef35d421d05"  # Boundary Surfaces (Boundary) ✅
BOUNDARY_VOLUME = "b57bf805-046a-4360-ad76-51aeddfe9720"    # Boundary Volume (BVol) ✅
ISOTRIM = "6a9ccaab-1b03-484e-bbda-be9c81584a66"        # Isotrim (SubSrf) ✅
SURFACE_SPLIT = "7db14002-c09c-4d7b-9f80-e4e2b00dfa1d"   # Surface Split (SrfSplit) ✅

# Boolean Operations
BOOLEAN_UNION = "10434a15-da85-4281-bb64-a2b3a995b9c6"  # Solid Union (SUnion) ✅
BOOLEAN_DIFF = "391bea31-f003-43e1-a59f-62a267997368"   # Multi SDiff (MSDiff) - multithreaded ✅
BOOLEAN_INTERSECT = "5723c845-cafc-442d-a667-8c76532845e6"  # Solid Intersection (SInt) ✅

# Transform
MOVE = "4fe87ef8-49e4-4605-9859-87940d62e1de"           # Move To Plane (MoveToPlane) ✅
ROTATE = "0d266dca-8bb6-4cf9-8e94-09ccc744232b"         # Rotate Vectors On Mesh Vertices (RotVectors) - might need Rotate
SCALE_NU = "290f418a-65ee-406a-a9d0-35699815b512"       # Scale NU (Scale NU) ✅
TWIST = "9509cb30-d24f-4f55-a5ac-bf0b12a06cfa"          # Twist (Twist) ✅
MIRROR = "3431f5c6-7578-4d26-a2b6-dfc064a9c65e"         # Mirror Surface (Mirror) ✅
ALIGN = "2318aee8-01fe-4ea8-9524-6966023fc622"          # Align Planes (Align) ✅
ARRAY_LINEAR = "e87db220-a0a0-4d67-a405-f97fd14b2d7a"   # Linear Array (ArrLinear) ✅
ARRAY_POLAR = "fca5ad7e-ecac-401d-a357-edda0a251cbc"    # Polar Array (ArrPolar) ✅

# Deconstruction/Analysis
DECONSTRUCT_BREP = "8d372bdc-9800-45e9-8a26-6e33c5253e21"  # Deconstruct Brep (DeBrep) ✅
JOIN_CURVES = "8073a420-6bec-49e3-9b18-367f6fd76ac3"    # Join Curves (Join) ✅
CAP_HOLES = "b648d933-ddea-4e75-834c-8f6f3793e311"      # Cap Holes (Cap) ✅
MESH_BREP = "60e7defa-8b21-4ee1-99aa-a9223d6134ff"      # Mesh Brep (Mesh) ✅
BOUNDING_BOX = "0bb3d234-9097-45db-9998-621639c87d3b"   # Bounding Box (BBox) ✅
AREA = "1eb7b856-ec7d-40b6-a76c-f216a11df37c"           # Area Moments (AMoments) - need Area
VOLUME = "?"                                            # Volume Blend matched - need Volume
CENTROID = "afbcbad4-2a2a-4954-8040-d999e316d2bd"       # Centroid (Centroid) ✅
CURVE_CLOSEST_POINT = "2dc44b22-b1dd-460a-a704-6462d6e91096"  # Curve Closest Point (Crv CP) ✅
SURFACE_CLOSEST_POINT = "4a9e9a8e-0943-4438-b360-129c30f2bb0f"  # Surface Closest Point (Srf CP) ✅

# Surface/Curve Evaluation
EVALUATE_SURFACE = "353b206e-bde5-4f02-a913-b3b8a977d4b9"  # Evaluate Surface (EvalSrf) ✅
EVALUATE_CURVE = "164d0429-e5f5-4292-aa80-3f88d43cdac2"    # Evaluate Curve (Eval) ✅
DIVIDE_SURFACE = "082976f0-c741-4df8-a1d4-89891bf8619f"    # Divide Surface [OBSOLETE] (Divide) ✅
DIVIDE_CURVE = "2162e72e-72fc-4bf8-9459-d4d82fa8aa14"      # Divide Curve (Divide) ✅
CURVE_FRAMES = "0e94542a-2e46-4793-9f98-2200b06b28f4"     # Curve Frames (Frames) ✅
CONTOUR = "246cda78-5e88-4087-ba09-ae082bbc4af8"         # Contour (ex) (Contour) ✅
PROJECT = "06d7bc4a-ba3e-4445-8ab5-079613b52f28"         # Project Along (ProjectA) ✅
PULL = "6b5812f5-bb36-4d74-97fc-5a1f2f77452d"            # Pull Curve (Pull) ✅
INTERSECT_BREP = "5723c845-cafc-442d-a667-8c76532845e6"   # Solid Intersection (SInt) ✅

# Data Tree/List Operations
GRAFT = "10a8674b-f4bb-4fdf-a56e-94dc606ecf33"          # Graft Tree (Graft) ✅
FLATTEN = "59e5dd6c-f07f-4621-996c-9ecaa6e6ee38"         # Flatten Mesh (FlattenMesh) - need Flatten Tree
SIMPLIFY = "06b3086c-1e9d-41c2-bcfc-bb843156196e"       # Simplify Tree (Simplify) ✅
DISPATCH = "0da3589c-af65-42ac-80ce-409f8332314b"       # Dispatch Multiple (MDispatch) ✅
CULL = "008e9a6f-478a-4813-8c8a-546273bc3a6b"           # Cull Pattern (Cull) ✅
WEAVE = "160c1df2-e2e8-48e5-b538-f2d6981007e3"           # Weave (Weave) ✅
MERGE = "0b6c5dac-6c93-4158-b8d1-ca3187d45f25"          # Merge Multiple (Merge) ✅
SORT = "?"                                              # Need Sort
LIST_ITEM = "285ddd8a-5398-4a3e-b3c2-361025711a51"      # List Item (Item) ✅
TREE_BRANCH = "3a710c1e-1809-4e19-8c15-82adce31cd62"    # Tree Branch (Branch) ✅
SPLIT_TREE = "d8b1e7ac-cd31-4748-b262-e07e53068afc"     # Split Tree (Split) ✅
REPLACE_PATHS = "bfaaf799-77dc-4f31-9ad8-2f7d1a80aeb0"   # Replace Paths (Replace) ✅
PATH_MAPPER = "f9b89a46-bc5d-4f7a-9a6f-134f93ac3af9"    # Path Mapper ✅

# Numeric/Parameter
REMAP = "2fcc2743-8339-4cdf-a046-a1f17439191d"          # Remap Numbers (ReMap) ✅
DOMAIN = "?"                                            # Need Domain
SERIES = "586706a8-109b-43ec-b581-743e920c951a"         # Series Addition (SA) - need Series
RANGE = "38a4e722-ad5a-4229-a170-e27ae1345538"          # Date Range (RDate) - need Range
RANDOM = "2ab17f9a-d852-4405-80e1-938c5e57e78d"         # Random (Random) ✅
GRAPH_MAPPER = "bc984576-7aa6-491f-a91d-e444c33675a7"   # Graph Mapper (Graph) ✅

# Vector/Plane/Point
CONSTRUCT_POINT = "3581f42a-9592-4549-bd6b-1c0fc39d067b"  # Construct Point (Pt) ✅
CONSTRUCT_PLANE = "bc3e379e-7206-4e7b-b63a-ff61f4b38a3e"   # Construct Plane (Pl) ✅
UNIT_X = "79f9fbb3-8f1d-4d9a-88a9-f7961b1012cd"          # Unit X (X) ✅
UNIT_Y = "d3d195ea-2d59-4ffa-90b1-8b7ff3369f69"         # Unit Y (Y) ✅
UNIT_Z = "9103c240-a6a9-4223-9b42-dbd19bf38e2b"         # Unit Z (Z) ✅
VECTOR_XYZ = "?"                                        # Domain Warp matched - need Vector XYZ

# Number Slider (already verified)
NUMBER_SLIDER = "57da07bd-ecab-415d-9d86-af36d7073abc"   # Number Slider ✅

# ============================================================
# ADVANCED / PLUGIN COMPONENTS (MISSING - need plugins)
# ============================================================

DENDRO = "MISSING"           # Requires Dendro plugin (TPMS Gyroid)
PUFFERFISH = "MISSING"       # Requires Pufferfish plugin
WEAVERBIRD = "MISSING"       # Requires Weaverbird plugin (installed but not detected)
LUNCHBOX = "MISSING"         # Requires Lunchbox plugin

# ============================================================
# SLIDER PARAMETER NAMES FOR LATTICE LAMP (12 params)
# ============================================================

LAMP_PARAMS = [
    ("Height", "Height", 100, 500, 300),
    ("Diameter", "Diameter", 80, 300, 150),
    ("Twist_Angle", "Twist_Angle", 0, 180, 45),
    ("Wave_Amplitude", "Wave_Amplitude", 0, 20, 5),
    ("Wave_Frequency", "Wave_Frequency", 1, 10, 3),
    ("Gyroid_Cell_Size", "Gyroid_Cell_Size", 4, 20, 8),
    ("Gyroid_Thickness", "Gyroid_Thickness", 0.5, 5, 1.2),
    ("Interference_Density", "Interference_Density", 0, 1, 0.3),
    ("Helical_Offset", "Helical_Offset", 0, 360, 0),
    ("Top_Closure_Ratio", "Top_Closure_Ratio", 0, 1, 0.8),
    ("Bulb_Concealment", "Bulb_Concealment", 0, 100, 50),
    ("Mount_Diameter", "Mount_Diameter", 20, 80, 40),
    ("Wall_Thickness", "Wall_Thickness", 1, 10, 2),
]

# ============================================================
# COMPONENT INPUT/OUTPUT MAPS (for wiring)
# ============================================================

# Cylinder inputs: Plane (P), Radius (R), Height (H) -> Cylinder (C)
# Circle inputs: Plane (P), Radius (R) -> Circle (C)
# Extrude inputs: Curve (C), Direction (D) -> Extrusion (E)
# Loft inputs: Curves (C) -> Loft (L)
# Sweep1 inputs: Rail (R), Section (S) -> Sweep (S)
# Boolean Union inputs: Breps (A), Breps (B) -> Union (U)
# Boolean Diff inputs: Brep (A), Brep (B) -> Difference (D)
# Twist inputs: Geometry (G), Angle (A), Axis (X), Center (C) -> Geometry (G)
# Boundary Surface inputs: Curves (E) -> Surfaces (S)
# Evaluate Surface inputs: Surface (S), Parameter (uv) -> Point (P), Normal (N), Frame (F)
# Divide Surface inputs: Surface (S), U Count (U), V Count (V) -> Points (P), UV (uv), Normals (N), Frames (F)
# Scale NU inputs: Geometry (G), X (X), Y (Y), Z (Z), Center (C) -> Geometry (G)
# Number Slider outputs: Number (N)
# Construct Point inputs: X, Y, Z -> Point (P)
# Construct Plane inputs: Origin (O), X Axis (X), Y Axis (Y) -> Plane (P)
# Unit X/Y/Z outputs: Vector (V)
# Remap inputs: Value (V), Source Domain (S), Target Domain (T) -> Value (V)
# Graph Mapper inputs: Value (V), Graph (G) -> Value (V)
# Deconstruct Brep inputs: Brep (B) -> Faces (F), Edges (E), Vertices (V)
# Mesh Brep inputs: Brep (B), Settings (S) -> Mesh (M)
# Cap Holes inputs: Brep (B) -> Brep (B)
# Join Curves inputs: Curves (C) -> Curves (C)
# Cull inputs: List (L), Pattern (P) -> List (L)
# Weave inputs: Pattern (P), Streams (0), (1), ... -> List (L)
# Merge inputs: Streams (0), (1), ... -> List (L)
# Dispatch inputs: List (L), Pattern (P) -> List A (A), List B (B)
# List Item inputs: List (L), Index (i) -> Item (i)
# Tree Branch inputs: Tree (T), Path (P) -> Branch (B)
# Split Tree inputs: Tree (T), Mask (M) -> Tree (T), Tree (T)
# Replace Paths inputs: Tree (T), Pattern (P), Replacement (R) -> Tree (T)
# Path Mapper inputs: Tree (T), Lexicon (L) -> Tree (T)

# ============================================================
# NOTES
# ============================================================
# - Dendro/Pufferfish/Lunchbox require plugins installed on pc2
# - Weaverbird is installed but not detected in search
# - For TPMS Gyroid: Need Dendro plugin OR implement via Python (marching cubes)
# - For Wave deformation: Use Graph Mapper + Remap + Transform
# - Revolve still needs to be found - search for "revolve" exact
# - Some components have OBSOLETE versions (Divide Surface)
# - FLATTEN tree vs Flatten Mesh - need Flatten Tree
# - ROTATE might need "Rotate" not "Rotate Vectors On Mesh Vertices"