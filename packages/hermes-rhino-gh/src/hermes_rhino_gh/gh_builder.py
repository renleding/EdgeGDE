"""Grasshopper graph builder for parametric GH definitions."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SliderConfig:
    """Configuration for a Number Slider component."""
    name: str
    nickname: str
    min_val: float
    max_val: float
    default: float
    decimals: int = 3
    group: str = "Parameters"


@dataclass
class GHComponent:
    """Grasshopper component definition."""
    alias: str
    component_name: str = ""
    component_guid: str = ""
    nickname: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    group: str | None = None


@dataclass
class GHWire:
    """Grasshopper wire connection."""
    source: str  # alias of source component
    source_param: int  # output parameter index
    target: str  # alias of target component
    target_param: int  # input parameter index


@dataclass
class GHGroup:
    """Grasshopper group definition."""
    name: str
    color: str | None = None  # hex color
    aliases: list[str] = field(default_factory=list)


@dataclass
class GHLayout:
    """Layout configuration."""
    max_columns: int = 10
    column_spacing: float = 200.0
    row_spacing: float = 150.0


class GHGraphBuilder:
    """
    Builds complete Grasshopper definitions for gh_build_graph.
    
    Usage:
        builder = GHGraphBuilder("my-definition")
        builder.add_slider("Height", "Height", 100, 300, 200)
        builder.add_component("Circle", "circle1", "Circle")
        builder.connect("Height", 0, "circle1", 1)  # Height -> Radius
        graph = builder.build()
    """
    
    def __init__(self, graph_id: str):
        self.graph_id = graph_id
        self.components: list[GHComponent] = []
        self.wires: list[GHWire] = []
        self.groups: list[GHGroup] = []
        self.sliders: list[SliderConfig] = []
        self.layout = GHLayout()
    
    def add_slider(self, name: str, nickname: str, min_val: float, max_val: float, 
                   default: float, decimals: int = 3, group: str = "Parameters") -> str:
        """Add a Number Slider component. Returns alias."""
        alias = f"slider_{len(self.sliders)}"
        self.sliders.append(SliderConfig(
            name=name, nickname=nickname, min_val=min_val, max_val=max_val,
            default=default, decimals=decimals, group=group
        ))
        self.components.append(GHComponent(
            alias=alias,
            component_name="Number Slider",
            nickname=nickname,
            params={
                "value": default,
                "min": min_val,
                "max": max_val,
                "decimals": decimals,
            },
            group=group,
        ))
        return alias
    
    def add_component(self, component_name: str, alias: str, nickname: str = "",
                      params: dict | None = None, group: str | None = None) -> str:
        """Add a GH component. Returns alias."""
        self.components.append(GHComponent(
            alias=alias,
            component_name=component_name,
            nickname=nickname,
            params=params or {},
            group=group,
        ))
        return alias
    
    def connect(self, source_alias: str, source_param: int, 
                target_alias: str, target_param: int) -> None:
        """Wire two components together."""
        self.wires.append(GHWire(
            source=source_alias,
            source_param=source_param,
            target=target_alias,
            target_param=target_param,
        ))
    
    def add_group(self, name: str, color: str | None = None, aliases: list[str] | None = None) -> None:
        """Add a group for visual organization."""
        self.groups.append(GHGroup(name=name, color=color, aliases=aliases or []))
    
    def set_layout(self, max_columns: int = 10, column_spacing: float = 200.0, 
                   row_spacing: float = 150.0) -> None:
        """Configure layout."""
        self.layout = GHLayout(max_columns=max_columns, column_spacing=column_spacing, row_spacing=row_spacing)
    
    def build(self) -> dict[str, Any]:
        """Build the complete graph definition for gh_build_graph."""
        # Convert sliders to component format
        slider_components = []
        for i, slider in enumerate(self.sliders):
            alias = f"slider_{i}"
            slider_components.append({
                "alias": alias,
                "component_name": "Number Slider",
                "nickname": slider.nickname,
                "params": {
                    "value": slider.default,
                    "min": slider.min_val,
                    "max": slider.max_val,
                    "decimals": slider.decimals,
                },
                "group": slider.group,
            })
        
        # Combine all components
        all_components = slider_components + [
            {
                "alias": c.alias,
                "component_name": c.component_name,
                "nickname": c.nickname,
                "params": c.params,
                "group": c.group,
            }
            for c in self.components
        ]
        
        # Convert wires
        wires = [
            {
                "source": w.source,
                "source_param": w.source_param,
                "target": w.target,
                "target_param": w.target_param,
            }
            for w in self.wires
        ]
        
        # Convert groups
        groups = [
            {
                "name": g.name,
                "color": g.color,
                "aliases": g.aliases,
            }
            for g in self.groups
        ]
        
        return {
            "graph_id": self.graph_id,
            "components": all_components,
            "wires": wires,
            "groups": groups,
            "layout": {
                "max_columns": self.layout.max_columns,
                "column_spacing": self.layout.column_spacing,
                "row_spacing": self.layout.row_spacing,
            },
            "preview_policy": "default",
        }


# Pre-built templates

def create_lamp_shade_graph(graph_id: str = "lamp_shade") -> dict[str, Any]:
    """Create the parametric lamp shade definition (24 sliders, 8 groups)."""
    builder = GHGraphBuilder(graph_id)
    
    # Parameters group (24 sliders)
    sliders = [
        ("Height", "Height", 100, 300, 200),
        ("Max Diameter", "Max Diameter", 60, 150, 100),
        ("Mid Diameter", "Mid Diameter", 50, 140, 95),
        ("Top Diameter", "Top Diameter", 30, 120, 70),
        ("Bottom Diameter", "Bottom Diameter", 40, 130, 85),
        ("Mount Hole Dia", "Mount Hole Dia", 30, 80, 45),
        ("Globe Clearance", "Globe Clearance", 45, 90, 65),
        ("Collar Height", "Collar Height", 5, 25, 12),
        ("Collar Thickness", "Collar Thickness", 2, 8, 3),
        ("Gyroid Cell Size", "Cell Size", 4, 16, 8),
        ("Strut Thickness", "Strut Thickness", 1, 4, 2),
        ("Gyroid Density", "Density", 0.2, 1.0, 0.5),
        ("Twist Degrees", "Twist Degrees", 0, 720, 270),
        ("Wave Amplitude", "Wave Amplitude", 0, 20, 8),
        ("Wave Frequency", "Wave Frequency", 1, 12, 5),
        ("Phase Rotation", "Phase Rotation", 0, 360, 180),
        ("Asymmetry %", "Asymmetry %", 0, 50, 15),
        ("Helical Bias", "Helical Bias", 0, 1, 0.5),
        ("Moiré Intensity", "Moiré Intensity", 0, 1, 0.5),
        ("Radial Harmonics", "Radial Harmonics", 12, 96, 48),
        ("Pattern Frequency", "Pattern Frequency", 0.2, 3.0, 1.0),
        ("Top Vent Size", "Top Vent Size", 1, 8, 3),
        ("Top Cap Thickness", "Cap Thickness", 1, 5, 2),
        ("Material Thickness", "Mat Thickness", 1, 5, 2),
    ]
    
    slider_aliases = []
    for name, nick, min_v, max_v, def_v in sliders:
        alias = builder.add_slider(name, nick, min_v, max_v, def_v, group="Parameters")
        slider_aliases.append((name, alias))
    
    # Helper to get slider alias by name
    def s(name): return next(a for n, a in slider_aliases if n == name)
    
    # Base + Mounting System
    builder.add_component("Circle", "mount_circle", "Mount Hole", group="Base + Mounting System")
    builder.connect(s("Mount Hole Dia"), 0, "mount_circle", 1)
    
    builder.add_component("Circle", "globe_circle", "Globe Clearance", group="Base + Mounting System")
    builder.connect(s("Globe Clearance"), 0, "globe_circle", 1)
    
    builder.add_component("Extrude", "collar_extrude", "Collar Extrude", group="Base + Mounting System")
    builder.connect("mount_circle", 0, "collar_extrude", 0)
    builder.connect(s("Collar Height"), 0, "collar_extrude", 1)
    
    builder.add_component("Boolean Toggle", "cap_collar", "Cap Collar", group="Base + Mounting System")
    builder.components[-1].params = {"value": True}
    builder.connect("cap_collar", 0, "collar_extrude", 2)
    
    builder.add_component("Offset", "collar_offset", "Collar Thickness", group="Base + Mounting System")
    builder.connect("collar_extrude", 0, "collar_offset", 0)
    builder.connect(s("Collar Thickness"), 0, "collar_offset", 1)
    
    # Primary Form
    builder.add_component("Number", "ht_0", "H=0", group="Primary Form")
    builder.components[-1].params = {"value": 0}
    
    builder.add_component("Division", "ht_mid", "H/2", group="Primary Form")
    builder.connect(s("Height"), 0, "ht_mid", 0)
    builder.components[-1].params = {"value": 2}
    
    builder.add_component("Multiplication", "ht_max", "H*0.7", group="Primary Form")
    builder.connect(s("Height"), 0, "ht_max", 0)
    builder.components[-1].params = {"value": 0.7}
    
    builder.add_component("Number", "ht_top", "H=Height", group="Primary Form")
    builder.connect(s("Height"), 0, "ht_top", 0)
    
    # Circles at heights
    for name, diam, ht_alias, move_alias in [
        ("Bot Circle", "Bottom Diameter", "ht_0", "move_bot"),
        ("Mid Circle", "Mid Diameter", "ht_mid", "move_mid"),
        ("Max Circle", "Max Diameter", "ht_max", "move_max"),
        ("Top Circle", "Top Diameter", "ht_top", "move_top"),
    ]:
        builder.add_component("Circle", name.lower().replace(" ", "_"), name, group="Primary Form")
        builder.connect(s(diam), 0, name.lower().replace(" ", "_"), 1)
        builder.add_component("Move", move_alias, f"Move {name.split()[0]}", group="Primary Form")
        builder.connect(name.lower().replace(" ", "_"), 0, move_alias, 0)
        builder.connect(ht_alias, 0, move_alias, 1)
    
    builder.add_component("Loft", "loft", "Loft Form", group="Primary Form")
    for move in ["move_bot", "move_mid", "move_max", "move_top"]:
        builder.connect(move, 0, "loft", 0)
    
    # Twist + Waves
    builder.add_component("Twist", "twist", "Global Twist", group="Twist + Waves")
    builder.connect("loft", 0, "twist", 0)
    builder.connect(s("Twist Degrees"), 0, "twist", 1)
    
    builder.add_component("Series", "series_h", "Height Series", group="Twist + Waves")
    builder.connect(s("Height"), 0, "series_h", 1)
    builder.components[-1].params = {"start": 0, "count": 50}
    
    builder.add_component("Sin", "wave_sin", "Sin Wave", group="Twist + Waves")
    builder.connect("series_h", 0, "wave_sin", 0)
    
    builder.add_component("Multiplication", "wave_mult", "Wave * Amp", group="Twist + Waves")
    builder.connect("wave_sin", 0, "wave_mult", 0)
    builder.connect(s("Wave Amplitude"), 0, "wave_mult", 1)
    
    builder.add_component("Multiplication", "wave_freq_mult", "Z * Freq", group="Twist + Waves")
    builder.connect("series_h", 0, "wave_freq_mult", 0)
    builder.connect(s("Wave Frequency"), 0, "wave_freq_mult", 1)
    builder.connect("wave_freq_mult", 0, "wave_sin", 0)
    
    builder.add_component("Move", "disp", "Wave Displace", group="Twist + Waves")
    builder.connect("twist", 0, "disp", 0)
    builder.connect("wave_mult", 0, "disp", 1)
    
    # Gyroid Generation (placeholder - needs Python component)
    builder.add_component("Bounding Box", "bbox", "Form BBox", group="Gyroid Generation")
    builder.connect("disp", 0, "bbox", 0)
    
    builder.add_component("Python", "gyroid_py", "Gyroid Field", group="Gyroid Generation")
    builder.components[-1].params = {"code": "# Gyroid implicit field\n# sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) = t"}
    builder.connect("bbox", 0, "gyroid_py", 0)
    builder.connect(s("Gyroid Cell Size"), 0, "gyroid_py", 1)
    builder.connect(s("Strut Thickness"), 0, "gyroid_py", 2)
    builder.connect(s("Gyroid Density"), 0, "gyroid_py", 3)
    
    # Interference Layer
    builder.add_component("Rotate", "phase_rot", "Phase Rotation", group="Interference Layer")
    builder.connect("gyroid_py", 0, "phase_rot", 0)
    builder.connect(s("Phase Rotation"), 0, "phase_rot", 1)
    
    builder.add_component("Python", "moire_py", "Moiré Pattern", group="Interference Layer")
    builder.components[-1].params = {"code": "# Second gyroid with rotated coordinates for interference"}
    builder.connect("phase_rot", 0, "moire_py", 0)
    builder.connect(s("Moiré Intensity"), 0, "moire_py", 1)
    
    builder.add_component("Python", "helical_py", "Helical Bias", group="Interference Layer")
    builder.components[-1].params = {"code": "# Bias lattice vectors into upward helix"}
    builder.connect("moire_py", 0, "helical_py", 0)
    builder.connect(s("Helical Bias"), 0, "helical_py", 1)
    
    builder.add_component("Python", "asym_py", "Asymmetry", group="Interference Layer")
    builder.components[-1].params = {"code": "# Apply controlled mathematical imperfection"}
    builder.connect("helical_py", 0, "asym_py", 0)
    builder.connect(s("Asymmetry %"), 0, "asym_py", 1)
    
    builder.add_component("Python", "radial_py", "Radial Harmonics", group="Interference Layer")
    builder.components[-1].params = {"code": "# Generate rotational interference patterns"}
    builder.connect("asym_py", 0, "radial_py", 0)
    builder.connect(s("Radial Harmonics"), 0, "radial_py", 1)
    builder.connect(s("Pattern Frequency"), 0, "radial_py", 2)
    
    # Top Closure
    builder.add_component("Python", "cap_py", "Top Cap", group="Top Closure")
    builder.components[-1].params = {"code": "# Enclosed decorative cap with gyroid vents"}
    builder.connect("radial_py", 0, "cap_py", 0)
    builder.connect(s("Top Vent Size"), 0, "cap_py", 1)
    builder.connect(s("Top Cap Thickness"), 0, "cap_py", 2)
    builder.connect(s("Material Thickness"), 0, "cap_py", 3)
    
    # Mesh Output
    builder.add_component("Solid Union", "union", "Union All", group="Mesh Output")
    builder.connect("collar_offset", 0, "union", 0)
    builder.connect("cap_py", 0, "union", 1)
    
    builder.add_component("Mesh", "mesh", "Print Mesh", group="Mesh Output")
    builder.connect("union", 0, "mesh", 0)
    
    builder.add_component("Mesh Check", "validate", "Validate Mesh", group="Mesh Output")
    builder.connect("mesh", 0, "validate", 0)
    
    builder.add_component("Area", "area", "Surface Area", group="Mesh Output")
    builder.connect("mesh", 0, "area", 0)
    
    builder.add_component("Volume", "volume", "Volume", group="Mesh Output")
    builder.connect("mesh", 0, "volume", 0)
    
    builder.add_component("Mesh Vertices", "poly_count", "Poly Count", group="Mesh Output")
    builder.connect("mesh", 0, "poly_count", 0)
    
    builder.add_component("Multiplication", "material_est", "Material Est (g)", group="Mesh Output")
    builder.connect("volume", 0, "material_est", 0)
    builder.components[-1].params = {"value": 1.24}
    
    # Output components
    builder.add_component("Geometry", "out_preview", "Preview Geometry", group="Mesh Output")
    builder.connect("union", 0, "out_preview", 0)
    
    builder.add_component("Geometry", "out_mesh", "Printable Mesh", group="Mesh Output")
    builder.connect("mesh", 0, "out_mesh", 0)
    
    builder.add_component("Geometry", "out_brep", "Printable Brep", group="Mesh Output")
    builder.connect("union", 0, "out_brep", 0)
    
    # Groups
    builder.add_group("Parameters", "#0066CC")
    builder.add_group("Base + Mounting System", "#009933")
    builder.add_group("Primary Form", "#CC6600")
    builder.add_group("Twist + Waves", "#990099")
    builder.add_group("Gyroid Generation", "#CC0066")
    builder.add_group("Interference Layer", "#FF6600")
    builder.add_group("Top Closure", "#6600CC")
    builder.add_group("Mesh Output", "#333333")
    
    return builder.build()


def create_simple_vase_graph(graph_id: str = "simple_vase") -> dict[str, Any]:
    """Create a simple vase definition (profile + revolve)."""
    builder = GHGraphBuilder(graph_id)
    
    # Sliders
    h = builder.add_slider("Height", "Height", 50, 300, 150, group="Vase")
    r1 = builder.add_slider("Base Radius", "Base R", 20, 100, 40, group="Vase")
    r2 = builder.add_slider("Mid Radius", "Mid R", 20, 120, 60, group="Vase")
    r3 = builder.add_slider("Top Radius", "Top R", 10, 80, 30, group="Vase")
    
    # Profile curve from 3 circles
    builder.add_component("Circle", "c1", "Base Circle", group="Vase")
    builder.connect(r1, 0, "c1", 1)
    builder.add_component("Move", "m1", "Move Base", group="Vase")
    builder.add_component("Number", "z0", "Z=0", group="Vase")
    builder.components[-1].params = {"value": 0}
    builder.connect("c1", 0, "m1", 0)
    builder.connect("z0", 0, "m1", 1)
    
    builder.add_component("Circle", "c2", "Mid Circle", group="Vase")
    builder.connect(r2, 0, "c2", 1)
    builder.add_component("Move", "m2", "Move Mid", group="Vase")
    builder.add_component("Division", "h2", "H/2", group="Vase")
    builder.connect(h, 0, "h2", 0)
    builder.components[-1].params = {"value": 2}
    builder.connect("c2", 0, "m2", 0)
    builder.connect("h2", 0, "m2", 1)
    
    builder.add_component("Circle", "c3", "Top Circle", group="Vase")
    builder.connect(r3, 0, "c3", 1)
    builder.add_component("Move", "m3", "Move Top", group="Vase")
    builder.connect(h, 0, "m3", 1)
    builder.connect("c3", 0, "m3", 0)
    
    # Loft
    builder.add_component("Loft", "loft", "Loft Vase", group="Vase")
    for m in ["m1", "m2", "m3"]:
        builder.connect(m, 0, "loft", 0)
    
    # Cap bottom
    builder.add_component("Cap", "cap", "Cap Bottom", group="Vase")
    builder.connect("loft", 0, "cap", 0)
    builder.components[-1].params = {"value": True}
    
    # Mesh for 3D printing
    builder.add_component("Mesh", "mesh", "Print Mesh", group="Vase")
    builder.connect("cap", 0, "mesh", 0)
    
    builder.add_group("Vase", "#CC3300")
    
    return builder.build()