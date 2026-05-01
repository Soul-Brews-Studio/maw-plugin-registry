#!/usr/bin/env python3
"""Build registry.json from plugins/*/registry.meta.json.

Usage: ./scripts/build-registry.py
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"
OUTFILE = ROOT / "registry.json"


def main():
    plugins = {}
    for meta_path in sorted(PLUGINS_DIR.glob("*/registry.meta.json")):
        name = meta_path.parent.name
        with open(meta_path) as f:
            plugins[name] = json.load(f)

    registry = {
        "$schema": "./schema/registry.json",
        "schemaVersion": 1,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "plugins": dict(sorted(plugins.items())),
    }

    with open(OUTFILE, "w") as f:
        json.dump(registry, f, indent=2)
        f.write("\n")

    print(f"✓ registry.json built — {len(plugins)} plugins")


if __name__ == "__main__":
    main()
