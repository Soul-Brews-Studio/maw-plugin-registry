#!/usr/bin/env bash
# lint-imports.sh — detect relative imports that escape the plugin directory
#
# Registry plugins must import maw-js internals via subpath exports:
#   import { cmdList } from "maw-js/commands/shared/comm"   ✓
#   import { cmdList } from "../../shared/comm"              ✗
#
# Why: relative paths only resolve when the plugin lives inside the maw-js
# source tree. Once extracted to the registry, those paths break at runtime.
#
# Usage:
#   bash scripts/lint-imports.sh          # check all plugins
#   bash scripts/lint-imports.sh --fix    # show what to replace (no auto-fix)

set -euo pipefail

REGISTRY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS_DIR="$REGISTRY_DIR/plugins"

# Match imports like: from "../../shared/..." or from "../../../plugin/..."
# These are relative paths that escape the plugin's own directory.
PATTERN='from ["'"'"']\.\./\.\.'

VIOLATIONS=$(grep -rn "$PATTERN" "$PLUGINS_DIR" --include='*.ts' 2>/dev/null || true)

if [ -z "$VIOLATIONS" ]; then
  echo "✓ no escaping relative imports found"
  exit 0
fi

COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
echo ""
echo "✗ found $COUNT relative imports that escape the plugin directory"
echo ""
echo "  These imports only resolve inside the maw-js source tree."
echo "  Use subpath exports instead:"
echo ""
echo "    ../../shared/comm         → maw-js/commands/shared/comm"
echo "    ../../../plugin/types     → maw-js/plugin/types"
echo "    ../../../cli/parse-args   → maw-js/cli/parse-args"
echo "    ../../../sdk              → maw-js/sdk"
echo "    ../../../config           → (add to maw-js exports if needed)"
echo ""

echo "$VIOLATIONS" | while IFS= read -r line; do
  # Strip the registry dir prefix for readability
  echo "  ${line#$REGISTRY_DIR/}"
done

echo ""
echo "  Available maw-js subpath exports:"
node -e "const p=require('$REGISTRY_DIR/node_modules/maw-js/package.json'); Object.keys(p.exports||{}).forEach(k=>console.log('    '+k))" 2>/dev/null || true
echo ""

exit 1
