#!/bin/bash
# Runs at session start. Stdout is injected into Claude's context.

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(dirname "$0")/../.."

# --- .env checks ---
env_key_is_set() {
  local key="$1"
  local value

  value="${!key}"
  if [ -z "$value" ]; then
  value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env 2>/dev/null)
  fi
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  [ -n "$value" ] || return 1

  case "$value" in
    your_tripo_key_here|your_fal_key_here|changeme|CHANGE_ME|TODO|todo)
      return 1
      ;;
  esac

  return 0
}

print_key_help() {
  local key="$1"
  local purpose="$2"
  local url="$3"

  echo "⚠️  $key is missing in .env."
  echo "   Used for: $purpose"
  echo "   Tell the user to visit this URL to create or copy the key: $url"
}

env_file_exists=1
if [ ! -f .env ]; then
  env_file_exists=0
  echo "⚠️  .env is missing."
fi

missing_env_key=0

if ! env_key_is_set "TRIPO_API_KEY"; then
  print_key_help "TRIPO_API_KEY" "image, 3D model, environment mesh, and resource generation" "https://developers.tripo3d.ai/"
  missing_env_key=1
fi

if ! env_key_is_set "FAL_KEY"; then
  echo "Optional sound generation is disabled. Set FAL_KEY in .env to enable ElevenLabs sound effects."
fi

if [ "$missing_env_key" -eq 1 ]; then
  if [ "$env_file_exists" -eq 0 ]; then
    echo "   Tell the user: copy .env.example to .env and add TRIPO_API_KEY locally."
  else
    echo "   Tell the user: add TRIPO_API_KEY to the local .env file."
  fi
fi

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
