"""
GHDefinitionBuilder - Programmatic Grasshopper definition construction.
Provides clean API for graph building: add_slider, add_component, connect, group, save.
"""

import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

from .gh_catalog import CATALOG, ComponentSpec, ComponentPort


@dataclass
class GHNode:
    """A node (component or parameter) in the GH document."""
    instance_id: str          # Unique instance GUID (generated)
    spec: ComponentSpec       # Component specification
    x: float = 0              # Canvas X position
    y: float = 0              # Canvas Y position
    nickname: str = ""        # Custom nickname (optional)
    values: Dict[int, Any] = field(default_factory=dict)  # Parameter values by input index
    
    # For parameter nodes (sliders)
    slider_min: float = 0
    slider_max: float = 100
    slider_value: float = 50


@dataclass
class GHWire:
    """A wire connecting source output to target input."""
    source_id: str        # Source node instance_id
    source_output: int    # Source output index
    target_id: str        # Target node instance_id
    target_input: int     # Target input index


class GHDefinitionBuilder:
    """
    Build Grasshopper definitions programmatically.
    
    Usage:
        builder = GHDefinitionBuilder("My Lamp")
        h_slider = builder.add_slider("Height", 100, 500, 300)
        cylinder = builder.add_component("Primitive", "Cylinder")
        builder.connect(h_slider, 0, cylinder, 1)  # slider output -> cylinder radius
        builder.save(r"C:\temp\lamp.gh")
    """
    
    def __init__(self, name: str = "Untitled", file_path: str = ""):
        self.name = name
        self.file_path = file_path
        self.nodes: Dict[str, GHNode] = {}      # instance_id -> GHNode
        self.wires: List[GHWire] = []
        self.groups: List[Dict] = []
        self._instance_counter = 0
    
    def _new_instance_id(self) -> str:
        """Generate a new instance ID."""
        import uuid
        return str(uuid.uuid4())
    
    def _add_node(self, spec: ComponentSpec, x: float, y: float, 
                  nickname: str = "", values: Dict[int, Any] = None) -> GHNode:
        """Internal: add a component node."""
        instance_id = self._new_instance_id()
        node = GHNode(
            instance_id=instance_id,
            spec=spec,
            x=x,
            y=y,
            nickname=nickname or spec.nickname,
            values=values or {}
        )
        self.nodes[instance_id] = node
        return node
    
    def add_slider(self, name: str, min_val: float, max_val: float, 
                   default: float, x: float = 0, y: float = 0,
                   nickname: str = "") -> GHNode:
        """
        Add a Number Slider parameter.
        
        Returns the slider node (can be used as source for connections).
        """
        spec = CATALOG.get("NumberSlider")
        if not spec:
            raise ValueError("NumberSlider not found in catalog")
        
        node = GHNode(
            instance_id=self._new_instance_id(),
            spec=spec,
            x=x,
            y=y,
            nickname=name,
            slider_min=min_val,
            slider_max=max_val,
            slider_value=default
        )
        self.nodes[node.instance_id] = node
        return node
    
    def add_component(self, category: str, operation: str,
                      x: float = 0, y: float = 0,
                      nickname: str = "",
                      values: Dict[int, Any] = None) -> GHNode:
        """
        Add a component by capability-based lookup.
        
        Args:
            category: e.g., "Primitive", "Surface", "Transform", "Boolean"
            operation: e.g., "Cylinder", "Loft", "Twist", "Union"
            x, y: Canvas position
            nickname: Custom nickname
            values: Default input values {input_index: value}
        
        Returns the component node.
        """
        spec = CATALOG.find(category, operation)
        if not spec:
            available = CATALOG.list_operations(category)
            raise ValueError(f"Component not found: {category}/{operation}. Available: {available}")
        
        return self._add_node(spec, x, y, nickname, values)
    
    def add_component_by_guid(self, guid: str,
                              x: float = 0, y: float = 0,
                              nickname: str = "",
                              values: Dict[int, Any] = None) -> GHNode:
        """Add component directly by GUID."""
        spec = CATALOG.get(guid)
        if not spec:
            raise ValueError(f"Component with GUID {guid} not found in catalog")
        return self._add_node(spec, x, y, nickname, values)
    
    def connect(self, source: GHNode, source_output: int,
                target: GHNode, target_input: int) -> GHWire:
        """
        Connect source output to target input.
        
        Args:
            source: Source node (slider or component)
            source_output: Output index on source
            target: Target node (component)
            target_input: Input index on target
        
        Returns the created wire.
        """
        # Validate indices
        if source_output >= len(source.spec.outputs):
            raise ValueError(f"Source output {source_output} out of range (max {len(source.spec.outputs)-1})")
        if target_input >= len(target.spec.inputs):
            raise ValueError(f"Target input {target_input} out of range (max {len(target.spec.inputs)-1})")
        
        wire = GHWire(
            source_id=source.instance_id,
            source_output=source_output,
            target_id=target.instance_id,
            target_input=target_input
        )
        self.wires.append(wire)
        return wire
    
    def connect_by_name(self, source: GHNode, source_output_name: str,
                        target: GHNode, target_input_name: str) -> GHWire:
        """Connect using port names instead of indices."""
        source_idx = next((i for i, p in enumerate(source.spec.outputs) 
                          if p.name.lower() == source_output_name.lower()), None)
        target_idx = next((i for i, p in enumerate(target.spec.inputs) 
                          if p.name.lower() == target_input_name.lower()), None)
        
        if source_idx is None:
            raise ValueError(f"Source output '{source_output_name}' not found on {source.spec.name}")
        if target_idx is None:
            raise ValueError(f"Target input '{target_input_name}' not found on {target.spec.name}")
        
        return self.connect(source, source_idx, target, target_idx)
    
    def group(self, name: str, node_ids: List[str], 
              color: Tuple[int, int, int] = (0, 128, 255)) -> Dict:
        """Create a visual group."""
        group = {
            "name": name,
            "nodes": node_ids,
            "color": color,
            "instance_id": self._new_instance_id()
        }
        self.groups.append(group)
        return group
    
    def auto_layout(self, spacing_x: float = 300, spacing_y: float = 150,
                    start_x: float = 100, start_y: float = 100):
        """Auto-arrange nodes in a grid layout by dependency order."""
        # Topological sort by dependency (wires)
        visited = set()
        order = []
        
        def visit(node_id):
            if node_id in visited:
                return
            visited.add(node_id)
            # Visit dependencies first (sources of wires to this node)
            for wire in self.wires:
                if wire.target_id == node_id:
                    visit(wire.source_id)
            order.append(node_id)
        
        for node_id in self.nodes:
            visit(node_id)
        
        # Layout in grid
        cols = 4
        for i, node_id in enumerate(order):
            node = self.nodes[node_id]
            row = i // cols
            col = i % cols
            node.x = start_x + col * spacing_x
            node.y = start_y + row * spacing_y
    
    def save(self, file_path: str = None) -> str:
        """
        Generate IronPython 2.7 code to create and save the GH definition.
        
        Returns the Python code that should be executed via execute_rhinoscript_python_code.
        """
        path = file_path or self.file_path
        if not path:
            raise ValueError("No file path specified")
        
        code_lines = [
            "import Grasshopper as gh",
            "import Grasshopper.Kernel as ghk",
            "import Grasshopper.Kernel.Parameters as gh_params",
            "import System",
            "",
            f"cs = gh.Instances.ComponentServer",
            f"doc = ghk.GH_Document()",
            f'doc.Name = "{self.name}"',
            f'doc.FilePath = r"{path}"',
            "",
        ]
        
        # Create nodes
        for node_id, node in self.nodes.items():
            var_name = f"node_{node_id.replace('-', '_')}"
            code_lines.append(f"# {node.spec.name} ({node.nickname})")
            code_lines.append(f"proxy_{var_name} = None")
            code_lines.append(f"for p in cs.ObjectProxies:")
            code_lines.append(f'    if str(p.Guid) == "{node.spec.guid}":')
            code_lines.append(f"        proxy_{var_name} = p")
            code_lines.append(f"        break")
            code_lines.append(f"")
            code_lines.append(f"if proxy_{var_name}:")
            code_lines.append(f"    {var_name} = proxy_{var_name}.CreateInstance()")
            code_lines.append(f"    {var_name}.CreateAttributes()")
            code_lines.append(f"    {var_name}.Attributes.Pivot = System.Drawing.PointF({node.x}, {node.y})")
            
            if node.spec.guid == CATALOG.get("NumberSlider").guid:
                # Slider special handling
                code_lines.append(f"    {var_name}.Slider.Minimum = {node.slider_min}")
                code_lines.append(f"    {var_name}.Slider.Maximum = {node.slider_max}")
                code_lines.append(f"    {var_name}.Slider.Value = {node.slider_value}")
            
            # Set input values
            for idx, val in node.values.items():
                code_lines.append(f"    {var_name}.Params.Input[{idx}].PersistentData.Append(gh_params.GH_Number({val}))")
            
            if node.nickname:
                code_lines.append(f"    {var_name}.NickName = \"{node.nickname}\"")
            
            code_lines.append(f"    doc.AddObject({var_name}, False)")
            code_lines.append(f"")
        
        # Create wires
        code_lines.append("# Wires")
        for wire in self.wires:
            src_var = f"node_{wire.source_id.replace('-', '_')}"
            tgt_var = f"node_{wire.target_id.replace('-', '_')}"
            code_lines.append(f"{tgt_var}.Params.Input[{wire.target_input}].AddSource({src_var}.Params.Output[{wire.source_output}])")
        
        code_lines.append("")
        code_lines.append("# Save")
        code_lines.append("dio = ghk.GH_DocumentIO()")
        code_lines.append("dio.Document = doc")
        code_lines.append("dio.Save()")
        code_lines.append(f'print "Document saved with " + str(doc.ObjectCount) + " objects"')
        
        return "\n".join(code_lines)
    
    def to_json(self) -> str:
        """Export builder state as JSON for debugging."""
        return json.dumps({
            "name": self.name,
            "file_path": self.file_path,
            "nodes": [
                {
                    "instance_id": n.instance_id,
                    "spec_guid": n.spec.guid,
                    "spec_name": n.spec.name,
                    "nickname": n.nickname,
                    "x": n.x,
                    "y": n.y,
                    "values": n.values,
                    "slider_min": n.slider_min,
                    "slider_max": n.slider_max,
                    "slider_value": n.slider_value,
                }
                for n in self.nodes.values()
            ],
            "wires": [
                {
                    "source_id": w.source_id,
                    "source_output": w.source_output,
                    "target_id": w.target_id,
                    "target_input": w.target_input,
                }
                for w in self.wires
            ],
            "groups": self.groups
        }, indent=2)


# Convenience function for the lamp profile
def create_lattice_lamp_builder() -> GHDefinitionBuilder:
    """Create a builder pre-configured for the lattice lamp."""
    builder = GHDefinitionBuilder("Lattice Lamp", r"C:\temp\lattice_lamp_v1.gh")
    
    # 12 Sliders (positioned in a column on the left)
    slider_y = 100
    sliders = {}
    for name, nick, min_v, max_v, default in [
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
    ]:
        sliders[name] = builder.add_slider(name, min_v, max_v, default, x=100, y=slider_y)
        slider_y += 60
    
    # Base profile: Circle (for Revolve-like cylinder)
    circle = builder.add_component("Primitive", "Circle", x=400, y=200, nickname="Profile Circle")
    builder.connect(sliders["Diameter"], 0, circle, 1)  # Diameter -> Radius
    
    # Cylinder from circle (Extrude along Z)
    cylinder = builder.add_component("Surface", "Extrude", x=700, y=200, nickname="Cylinder")
    builder.connect(circle, 0, cylinder, 0)      # Circle -> Curve
    builder.connect_by_name(sliders["Height"], "Value", cylinder, "Direction")  # Height -> Direction (Z)
    # Note: Need to construct Z vector from Height - will need a Unit Z component
    
    return builder