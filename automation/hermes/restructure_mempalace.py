#!/Library/Frameworks/Python.framework/Versions/3.11/bin/python3
"""
MemPalace Restructure Script
Moves drawers between wings/rooms according to the agreed structure.
"""
import sys, json, re
sys.path.insert(0, '/Library/Frameworks/Python.framework/Versions/3.11/lib/python3.11/site-packages')

from mempalace.backends.chroma import ChromaBackend
from mempalace.config import MempalaceConfig

# Load palace
config = MempalaceConfig()
palace_path = config.palace_path
backend = ChromaBackend()
col = backend.get_collection(palace_path, config.collection_name, create=True)

if not col:
    print("ERROR: Could not open palace collection")
    sys.exit(1)

# Fetch ALL metadata + documents
all_data = col.get(include=["metadatas", "documents"])
total = len(all_data["ids"])
print(f"Total drawers loaded: {total}")

# Define remapping rules: (old_wing, old_room_regex) -> (new_wing, new_room)
# Ordered: first match wins for each drawer
REMAP_RULES = [
    # Merge EdgeGDE + edgegde
    (r"^EdgeGDE$", r"compiler", "edgegde", "compiler"),
    (r"^EdgeGDE$", r"backend", "edgegde", "backend"),
    (r"^edgegde$", r"hsaes-phase3", "edgegde", "compiler"),  # HSAES is the compiler engine
    (r"^edgegde$", r"decisions", "edgegde", "architecture"),
    (r"^edgegde$", r".*", "edgegde", "architecture"),  # catch-all for edgegde

    # hermes infrastructure ← wing_hermes + wing_hermes-agent
    (r"^wing_hermes$", r".*", "hermes", "infrastructure"),
    (r"^wing_hermes-agent$", r".*", "hermes", "infrastructure"),

    # hermes/worklog ← wing_default/diary
    (r"^wing_default$", r".*", "hermes", "worklog"),

    # warren/diary ← wing_nicolette
    (r"^wing_nicolette$", r".*", "warren", "diary"),

    # UIBuilder → hermes/hud-ui
    (r"^UIBuilder$", r".*", "hermes", "hud-ui"),

    # mempalace_test → scrap
    (r"^mempalace_test$", r".*", None, None),  # delete

    # infrastructure → hermes/infrastructure
    (r"^infrastructure$", r".*", "hermes", "infrastructure"),

    # routa stays as-is (already correct)
    # agent stays as-is (already compressed)
]

def match_rule(wing, room):
    """Find first matching rule for a (wing, room) pair."""
    for pattern_w, pattern_r, new_w, new_r in REMAP_RULES:
        if re.match(pattern_w, wing) and re.match(pattern_r, room):
            return new_w, new_r
    return None  # no change

# Process each drawer
updated = 0
deleted = 0
skipped = 0
errors = []

for i in range(total):
    drawer_id = all_data["ids"][i]
    meta = all_data["metadatas"][i]
    doc = all_data["documents"][i]

    old_wing = meta.get("wing", "unknown")
    old_room = meta.get("room", "unknown")

    result = match_rule(old_wing, old_room)
    if result is None:
        skipped += 1
        continue

    new_wing, new_room = result

    if new_wing is None:
        # Delete this drawer
        try:
            col.delete(ids=[drawer_id])
            deleted += 1
        except Exception as e:
            errors.append(f"DELETE {drawer_id}: {e}")
        continue

    if old_wing == new_wing and old_room == new_room:
        skipped += 1
        continue

    # Update wing/room in metadata
    new_meta = dict(meta)
    new_meta["wing"] = new_wing
    new_meta["room"] = new_room

    try:
        col.update(ids=[drawer_id], metadatas=[new_meta])
        updated += 1
    except Exception as e:
        errors.append(f"UPDATE {drawer_id} ({old_wing}/{old_room}→{new_wing}/{new_room}): {e}")

print(f"\nResults: {updated} moved, {deleted} deleted, {skipped} unchanged")
if errors:
    print(f"\nErrors ({len(errors)}):")
    for e in errors[:10]:
        print(f"  {e}")

# Also back up and clean config.json
print("\nDone. Run 'mempalace status' to verify.")
