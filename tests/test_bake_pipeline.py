"""F12-F03.3 bake pipeline tests (integration — needs live RhinoClaw).

Bake SAFELY: definition_id only. Passing an unsupported layer parameter wedged the
Rhino UI thread in a prior session (do not repeat)."""
import os
import pytest

from gh_automation_core.closed_loop import ClosedLoopSession, RhinoClawBridge

pytestmark = pytest.mark.integration


def test_bake_pipeline_reaches_rhino():
    s = ClosedLoopSession(RhinoClawBridge(
        host=os.environ.get("RHINOCLAW_HOST", "100.110.105.101")))
    s.load_definition(os.environ["FRS_LAMP"])
    s.show_definition()
    s.refresh_controls()
    s.solve_on_canvas()
    s.bake()  # definition_id only — never a layer param

    ms = s.mesh_stats()
    assert ms.get("MESH_COUNT", 0) > 0, "no baked meshes"
    assert ms.get("MESH_FACES", 0) > 0, "baked meshes have zero faces"
