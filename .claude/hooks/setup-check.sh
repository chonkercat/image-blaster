#!/bin/bash
# Runs at session start. Stdout is injected into Claude's context.

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(dirname "$0")/../.."

# Resolve the same configuration used by generation; prints no key values.
node .claude/scripts/asset-pipeline/provider-config.mjs --check || echo "Check .env and use Node.js 22+."

# --- worlds/ status ---
if [ -d worlds ] && [ "$(ls worlds/ 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
  WORLD_LIST=$(ls worlds/)
  echo "Worlds available: $(echo "$WORLD_LIST" | wc -l | tr -d ' ') — $(echo "$WORLD_LIST" | tr '\n' ' ')"
else
  echo "No worlds yet. Use /image-blast-project to set up a project, then Agent(image-blast-world) for non-blocking world generation."
fi

# --- input/ staging ---
if [ -d input ]; then
  FILES=$(ls input/ 2>/dev/null | grep -v '^$' | tr '\n' ' ')
  [ -n "$FILES" ] && echo "Staged in input/: $FILES"
fi

exit 0
