#!/usr/bin/env bash
# Build registry.json from plugins/*/registry.meta.json
# No LLM needed — just run: ./scripts/build-registry.sh

set -euo pipefail
cd "$(dirname "$0")/.."

OUTFILE="registry.json"
TMPFILE=$(mktemp)

# Collect all plugin meta files, sorted by name
plugins=()
for meta in plugins/*/registry.meta.json; do
  [ -f "$meta" ] || continue
  name=$(basename "$(dirname "$meta")")
  plugins+=("$name:$meta")
done

IFS=$'\n' sorted=($(sort <<<"${plugins[*]}")); unset IFS

# Build the combined JSON
{
  echo '{'
  echo '  "$schema": "./schema/registry.json",'
  echo '  "schemaVersion": 1,'
  echo "  \"updated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo '  "plugins": {'

  count=${#sorted[@]}
  i=0
  for entry in "${sorted[@]}"; do
    name="${entry%%:*}"
    meta="${entry#*:}"
    i=$((i + 1))

    # Indent the meta JSON under the plugin name key
    echo "    \"$name\": $(cat "$meta" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, indent=2).replace(chr(10), chr(10) + '    '))
")$([ $i -lt $count ] && echo ',' || echo '')"
  done

  echo '  }'
  echo '}'
} > "$TMPFILE"

# Validate JSON
if python3 -c "import json; json.load(open('$TMPFILE'))" 2>/dev/null; then
  mv "$TMPFILE" "$OUTFILE"
  count=${#sorted[@]}
  echo "✓ registry.json built — $count plugins"
else
  echo "✗ invalid JSON generated" >&2
  cat "$TMPFILE" >&2
  rm -f "$TMPFILE"
  exit 1
fi
