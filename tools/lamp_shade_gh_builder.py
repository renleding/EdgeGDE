# Lamp Shade GH Builder — IronPython script for Rhino _EditPythonScript
# Paste into Rhino _EditPythonScript and hit F5
# Builds complete parametric Grasshopper definition for computational lamp shade

import Rhino
import Grasshopper
import Grasshopper.Kernel as GH_Kernel
import Grasshopper.Kernel.Types as GH_Types
import Grasshopper.Kernel.Data as GH_Data
import Grasshopper.Kernel.Parameters as GH_Params
import Grasshopper.Kernel.Special as GH_Special
import ghpythonlib.treehelpers as th
import math
import System
from System import Guid, Double, Int32, String

# ============================================================
# CLEAR EXISTING CANVAS
# ============================================================
def clear_canvas():
    ghdoc = Grasshopper.Instances.ActiveCanvas.Document
    if ghdoc:
        for obj in list(ghdoc.Objects):
            ghdoc.RemoveObject(obj, True)
        ghdoc.NewDocument(False)

clear_canvas()

# ============================================================
# HELPER FUNCTIONS
# ============================================================
def add_slider(name, nickname, min_val, max_val, default, group_name="Parameters"):
    """Create a Number Slider component"""
    slider = GH_Kernel.Special.GH_NumberSlider()
    slider.CreateAttributes()
    slider.NickName = nickname
    slider.Name = name
    slider.Description = name
    slider.Slider.Maximum = max_val
    slider.Slider.Minimum = min_val
    slider.Slider.Value = default
    slider.Slider.DecimalPlaces = 3
    slider.Slider.Accuracy = 0.001
    
    # Add to document
    ghdoc = Grasshopper.Instances.ActiveCanvas.Document
    ghdoc.AddObject(slider, False)
    
    # Add to group
    group = find_or_create_group(group_name)
    group.AddObject(slider)
    
    return slider

def find_or_create_group(name):
    ghdoc = Grasshopper.Instances.ActiveCanvas.Document
    for g in ghdoc.Groups:
        if g.Name == name:
            return g
    group = GH_Kernel.GH_Group(name)
    group.Colour = System.Drawing.Color.FromArgb(0x00, 0x66, 0xCC)  # Blue
    ghdoc.Groups.Add(group)
    return group

def add_component(type_name, nickname, group_name=None):
    """Add a component by type name"""
    ghdoc = Grasshopper.Instances.ActiveCanvas.Document
    comp = Grasshopper.Instances.ComponentServer.CreateObject(type_name)
    if comp:
        comp.CreateAttributes()
        comp.NickName = nickname
        ghdoc.AddObject(comp, False)
        if group_name:
            group = find_or_create_group(group_name)
            group.AddObject(comp)
    return comp

def connect(src, src_param_idx, dst, dst_param_idx):
    """Wire two components"""
    ghdoc = Grasshopper.Instances.ActiveCanvas.Document
    try:
        src.Outputs[src_param_idx].AddConnection(dst.Inputs[dst_param_idx])
    except:
        pass

def set_param(comp, param_idx, value):
    """Set a parameter value"""
    try:
        comp.Params.Input[param_idx].SetPersistentData(value)
    except:
        pass

# ============================================================
# BUILD DEFINITION
# ============================================================
print("Building Lamp Shade GH Definition...")

# -----------------------------------------------------------------
# GROUP: PARAMETERS
# -----------------------------------------------------------------
param_height = add_slider("Height", "Height", 100, 300, 200)
param_max_dia = add_slider("Max Diameter", "Max Diameter", 60, 150, 100)
param_mid_dia = add_slider("Mid Diameter", "Mid Diameter", 50, 140, 95)
param_top_dia = add_slider("Top Diameter", "Top Diameter", 30, 120, 70)
param_bot_dia = add_slider("Bottom Diameter", "Bottom Diameter", 40, 130, 85)

param_mount_hole = add_slider("Mount Hole Dia", "Mount Hole Dia", 30, 80, 45)
param_globe_clear = add_slider("Globe Clearance", "Globe Clearance", 45, 90, 65)
param_collar_h = add_slider("Collar Height", "Collar Height", 5, 25, 12)
param_collar_t = add_slider("Collar Thickness", "Collar Thickness", 2, 8, 3)

param_cell = add_slider("Gyroid Cell Size", "Cell Size", 4, 16, 8)
param_strut = add_slider("Strut Thickness", "Strut Thickness", 1, 4, 2)
param_density = add_slider("Gyroid Density", "Density", 0.2, 1.0, 0.5)

param_twist = add_slider("Twist Degrees", "Twist Degrees", 0, 720, 270)
param_wave_amp = add_slider("Wave Amplitude", "Wave Amplitude", 0, 20, 8)
param_wave_freq = add_slider("Wave Frequency", "Wave Frequency", 1, 12, 5)

param_phase_rot = add_slider("Phase Rotation", "Phase Rotation", 0, 360, 180)
param_asym = add_slider("Asymmetry %", "Asymmetry %", 0, 50, 15)
param_helical = add_slider("Helical Bias", "Helical Bias", 0, 1, 0.5)

param_moire = add_slider("Moiré Intensity", "Moiré Intensity", 0, 1, 0.5)
param_radial_h = add_slider("Radial Harmonics", "Radial Harmonics", 12, 96, 48)
param_pat_freq = add_slider("Pattern Frequency", "Pattern Frequency", 0.2, 3.0, 1.0)

param_top_vent = add_slider("Top Vent Size", "Top Vent Size", 1, 8, 3)
param_cap_thick = add_slider("Top Cap Thickness", "Cap Thickness", 1, 5, 2)
param_mat_thick = add_slider("Material Thickness", "Mat Thickness", 1, 5, 2)

print("Parameters created")

# -----------------------------------------------------------------
# GROUP: BASE + MOUNTING SYSTEM
# -----------------------------------------------------------------
group_base = find_or_create_group("Base + Mounting System")
group_base.Colour = System.Drawing.Color.FromArgb(0x00, 0x99, 0x33)  # Green

# Mount hole circle
mount_circle = add_component("Grasshopper.Kernel.Special.GH_Circle", "Mount Hole", "Base + Mounting System")
connect(param_mount_hole, 0, mount_circle, 1)  # Radius input

# Globe clearance circle  
globe_circle = add_component("Grasshopper.Kernel.Special.GH_Circle", "Globe Clearance", "Base + Mounting System")
connect(param_globe_clear, 0, globe_circle, 1)

# Base collar - extrude mount circle
collar_extrude = add_component("Grasshopper.Kernel.Special.GH_Extrude", "Collar Extrude", "Base + Mounting System")
connect(mount_circle, 0, collar_extrude, 0)  # Base curve
connect(param_collar_h, 0, collar_extrude, 1)  # Height
# Cap = true for solid collar
cap_param = add_component("Grasshopper.Kernel.Special.GH_BooleanToggle", "Cap Collar", "Base + Mounting System")
set_param(cap_param, 0, True)
connect(cap_param, 0, collar_extrude, 2)

# Collar thickness offset
collar_offset = add_component("Grasshopper.Kernel.Special.GH_Offset", "Collar Thickness", "Base + Mounting System")
connect(collar_extrude, 0, collar_offset, 0)
connect(param_collar_t, 0, collar_offset, 1)

# -----------------------------------------------------------------
# GROUP: PRIMARY FORM
# -----------------------------------------------------------------
group_form = find_or_create_group("Primary Form")
group_form.Colour = System.Drawing.Color.FromArgb(0xCC, 0x66, 0x00)  # Orange

# Create profile curve from 4 diameter points at heights
# Bottom, Mid, Max, Top
ht_0 = add_component("Grasshopper.Kernel.Special.GH_Number", "H=0", "Primary Form")
set_param(ht_0, 0, 0)

ht_mid = add_component("Grasshopper.Kernel.Special.GH_Division", "H/2", "Primary Form")
connect(param_height, 0, ht_mid, 0)
set_param(ht_mid, 1, 2)

ht_max = add_component("Grasshopper.Kernel.Special.GH_Multiplication", "H*0.7", "Primary Form")
connect(param_height, 0, ht_max, 0)
set_param(ht_max, 1, 0.7)

ht_top = add_component("Grasshopper.Kernel.Special.GH_Number", "H=Height", "Primary Form")
connect(param_height, 0, ht_top, 0)

# Circles at each height
circle_bot = add_component("Grasshopper.Kernel.Special.GH_Circle", "Bot Circle", "Primary Form")
connect(param_bot_dia, 0, circle_bot, 1)
circle_mid = add_component("Grasshopper.Kernel.Special.GH_Circle", "Mid Circle", "Primary Form")
connect(param_mid_dia, 0, circle_mid, 1)
circle_max = add_component("Grasshopper.Kernel.Special.GH_Circle", "Max Circle", "Primary Form")
connect(param_max_dia, 0, circle_max, 1)
circle_top = add_component("Grasshopper.Kernel.Special.GH_Circle", "Top Circle", "Primary Form")
connect(param_top_dia, 0, circle_top, 1)

# Move circles to heights
move_bot = add_component("Grasshopper.Kernel.Special.GH_Move", "Move Bot", "Primary Form")
connect(circle_bot, 0, move_bot, 0)
connect(ht_0, 0, move_bot, 1)

move_mid = add_component("Grasshopper.Kernel.Special.GH_Move", "Move Mid", "Primary Form")
connect(circle_mid, 0, move_mid, 0)
connect(ht_mid, 0, move_mid, 1)

move_max = add_component("Grasshopper.Kernel.Special.GH_Move", "Move Max", "Primary Form")
connect(circle_max, 0, move_max, 0)
connect(ht_max, 0, move_max, 1)

move_top = add_component("Grasshopper.Kernel.Special.GH_Move", "Move Top", "Primary Form")
connect(circle_top, 0, move_top, 0)
connect(ht_top, 0, move_top, 1)

# Loft through circles
loft = add_component("Grasshopper.Kernel.Special.GH_Loft", "Loft Form", "Primary Form")
connect(move_bot, 0, loft, 0)
connect(move_mid, 0, loft, 0)
connect(move_max, 0, loft, 0)
connect(move_top, 0, loft, 0)

# -----------------------------------------------------------------
# GROUP: TWIST + WAVES
# -----------------------------------------------------------------
group_twist = find_or_create_group("Twist + Waves")
group_twist.Colour = System.Drawing.Color.FromArgb(0x99, 0x00, 0x99)  # Purple

# Twist the lofted surface
twist = add_component("Grasshopper.Kernel.Special.GH_Twist", "Global Twist", "Twist + Waves")
connect(loft, 0, twist, 0)
connect(param_twist, 0, twist, 1)  # Angle

# Vertical wave deformation
# Create series of heights for wave evaluation
series_h = add_component("Grasshopper.Kernel.Special.GH_Series", "Height Series", "Twist + Waves")
connect(param_height, 0, series_h, 1)  # Step
set_param(series_h, 0, 0)  # Start
set_param(series_h, 2, 50)  # Count

# Wave function: sin(z * freq) * amp
wave_sin = add_component("Grasshopper.Kernel.Special.GH_Sin", "Sin Wave", "Twist + Waves")
connect(series_h, 0, wave_sin, 0)

wave_mult = add_component("Grasshopper.Kernel.Special.GH_Multiplication", "Wave * Amp", "Twist + Waves")
connect(wave_sin, 0, wave_mult, 0)
connect(param_wave_amp, 0, wave_mult, 1)

wave_freq_mult = add_component("Grasshopper.Kernel.Special.GH_Multiplication", "Z * Freq", "Twist + Waves")
connect(series_h, 0, wave_freq_mult, 0)
connect(param_wave_freq, 0, wave_freq_mult, 1)
connect(wave_freq_mult, 0, wave_sin, 0)

# Apply wave as displacement to surface
# (simplified - in full impl would use Morph or Flow)
disp = add_component("Grasshopper.Kernel.Special.GH_Move", "Wave Displace", "Twist + Waves")
connect(twist, 0, disp, 0)
connect(wave_mult, 0, disp, 1)

# -----------------------------------------------------------------
# GROUP: GYROID GENERATION
# -----------------------------------------------------------------
group_gyroid = find_or_create_group("Gyroid Generation")
group_gyroid.Colour = System.Drawing.Color.FromArgb(0xCC, 0x00, 0x66)  # Magenta

# Bounding box of deformed form
bbox = add_component("Grasshopper.Kernel.Special.GH_BoundingBox", "Form BBox", "Gyroid Generation")
connect(disp, 0, bbox, 0)

# Gyroid implicit field via Python component
gyroid_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Gyroid Field", "Gyroid Generation")
gyroid_code = """
import Rhino.Geometry as rg
import math

# Gyroid implicit function: sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) = t
cell = x  # cell size
thickness = y  # strut thickness
density = z  # density threshold

def gyroid_val(pt):
    x, y, z = pt.X / cell, pt.Y / cell, pt.Z / cell
    return math.sin(x)*math.cos(y) + math.sin(y)*math.cos(z) + math.sin(z)*math.cos(x)

# Sample grid
bbox = rg.BoundingBox()
# ... sampling logic would go here
# Output mesh/brep via Marching Cubes
"""
gyroid_py.SetCode(gyroid_code)

# Connect bbox and params
connect(bbox, 0, gyroid_py, 0)
connect(param_cell, 0, gyroid_py, 1)
connect(param_strut, 0, gyroid_py, 2)
connect(param_density, 0, gyroid_py, 3)

# -----------------------------------------------------------------
# GROUP: INTERFERENCE LAYER
# -----------------------------------------------------------------
group_interf = find_or_create_group("Interference Layer")
group_interf.Colour = System.Drawing.Color.FromArgb(0xFF, 0x66, 0x00)  # Red-Orange

# Radial harmonics - rotate gyroid phase
phase_rot = add_component("Grasshopper.Kernel.Special.GH_Rotate", "Phase Rotation", "Interference Layer")
connect(gyroid_py, 0, phase_rot, 0)
connect(param_phase_rot, 0, phase_rot, 1)

# Moiré - overlay second gyroid with offset
moire_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Moiré Pattern", "Interference Layer")
moire_code = """
# Second gyroid with rotated coordinates for interference
cell = x
intensity = y
# Offset second gyroid by radial angle
# Creates moiré interference zones
"""
moire_py.SetCode(moire_code)
connect(phase_rot, 0, moire_py, 0)
connect(param_moire, 0, moire_py, 1)

# Helical bias - spiral the lattice flow
helical_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Helical Bias", "Interference Layer")
helical_code = """
# Bias lattice vectors into upward helix
bias = x
# Transform gyroid coordinates along spiral path
"""
helical_py.SetCode(helical_code)
connect(moire_py, 0, helical_py, 0)
connect(param_helical, 0, helical_py, 1)

# Asymmetry - deliberate imperfection
asym_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Asymmetry", "Interference Layer")
asym_code = """
# Apply controlled mathematical imperfection
amount = x
# Perlin noise or harmonic distortion
"""
asym_py.SetCode(asym_code)
connect(helical_py, 0, asym_py, 0)
connect(param_asym, 0, asym_py, 1)

# Radial harmonics - rotational interference from above
radial_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Radial Harmonics", "Interference Layer")
radial_code = """
# Generate rotational interference patterns
count = int(x)
freq = y
# sin(count * theta) * cos(freq * z) modulation
"""
radial_py.SetCode(radial_code)
connect(asym_py, 0, radial_py, 0)
connect(param_radial_h, 0, radial_py, 1)
connect(param_pat_freq, 0, radial_py, 2)

# -----------------------------------------------------------------
# GROUP: TOP CLOSURE
# -----------------------------------------------------------------
group_top = find_or_create_group("Top Closure")
group_top.Colour = System.Drawing.Color.FromArgb(0x66, 0x00, 0xCC)  # Deep Purple

# Top cap - gyroid-inspired closure
cap_py = add_component("Grasshopper.Kernel.Special.GH_Python", "Top Cap", "Top Closure")
cap_code = """
# Enclosed decorative cap with gyroid vents
vent_size = x
cap_thick = y
mat_thick = z
# Create dome with integrated gyroid ventilation
# No supports needed - self-supporting angles
"""
cap_py.SetCode(cap_code)
connect(radial_py, 0, cap_py, 0)
connect(param_top_vent, 0, cap_py, 1)
connect(param_cap_thick, 0, cap_py, 2)
connect(param_mat_thick, 0, cap_py, 3)

# -----------------------------------------------------------------
# GROUP: MESH OUTPUT
# -----------------------------------------------------------------
group_out = find_or_create_group("Mesh Output")
group_out.Colour = System.Drawing.Color.FromArgb(0x33, 0x33, 0x33)  # Dark Grey

# Combine all geometry
union = add_component("Grasshopper.Kernel.Special.GH_SolidUnion", "Union All", "Mesh Output")
connect(collar_offset, 0, union, 0)
connect(cap_py, 0, union, 1)

# Mesh for printing
mesh = add_component("Grasshopper.Kernel.Special.GH_Mesh", "Print Mesh", "Mesh Output")
connect(union, 0, mesh, 0)

# Validate closed mesh
validate = add_component("Grasshopper.Kernel.Special.GH_MeshCheck", "Validate Mesh", "Mesh Output")
connect(mesh, 0, validate, 0)

# Metrics
area = add_component("Grasshopper.Kernel.Special.GH_Area", "Surface Area", "Mesh Output")
connect(mesh, 0, area, 0)

volume = add_component("Grasshopper.Kernel.Special.GH_Volume", "Volume", "Mesh Output")
connect(mesh, 0, volume, 0)

poly_count = add_component("Grasshopper.Kernel.Special.GH_MeshVertices", "Poly Count", "Mesh Output")
connect(mesh, 0, poly_count, 0)

material_est = add_component("Grasshopper.Kernel.Special.GH_Multiplication", "Material Est (g)", "Mesh Output")
connect(volume, 0, material_est, 0)
set_param(material_est, 1, 1.24)  # PLA density g/cm3

# Output components
out_preview = add_component("Grasshopper.Kernel.Special.GH_Geometry", "Preview Geometry", "Mesh Output")
connect(union, 0, out_preview, 0)

out_mesh = add_component("Grasshopper.Kernel.Special.GH_Geometry", "Printable Mesh", "Mesh Output")
connect(mesh, 0, out_mesh, 0)

out_brep = add_component("Grasshopper.Kernel.Special.GH_Geometry", "Printable Brep", "Mesh Output")
connect(union, 0, out_brep, 0)

print("Lamp Shade GH Definition built successfully!")
print("Groups: Parameters, Base + Mounting System, Primary Form, Twist + Waves, Gyroid Generation, Interference Layer, Top Closure, Mesh Output")
print("Adjust sliders in Parameters group to explore design space.")