---
name: image-blast-wildcard
description: Generate images, 3D models, textures, and other resources through the Tripo API when the request does not fit a narrower Image Blast skill.
argument-hint: [Tripo endpoint or resource request] [prompt, input files, output location]
allowed-tools: Read Write Glob WebFetch WebSearch Bash(ls *) Bash(node .claude/scripts/project/ensure-local-assets.mjs *) Bash(node .claude/scripts/tripo/run-tripo.mjs *)
---

Resolve one Tripo resource operation from `$ARGUMENTS`.

## Instructions

- All visual asset/resource generation uses `TRIPO_API_KEY`, never general AI credentials or FAL. Claude handles analysis/planning normally. Optional audio uses the sound skill.
- Read the official endpoint docs at `https://developers.tripo3d.ai/en/docs/introduction` and choose a route supported by `TRIPO_ENDPOINTS` in `tripo-client.mjs`. Do not invent request fields or silently fall back to another provider. Unsupported resource types (for example video) must be reported as unsupported.
- For discovery, present the concrete route, model, request and output location for confirmation before a paid request, unless already authorized by the user. An execution prompt starting `CONFIRMED_TRIPO_ENDPOINT: <endpoint>` records an already confirmed operation.
- Use `ls -a` before reading state. Resolve an output directory from the current world/project and preserve indexed filenames and request metadata.
- Run `Agent(image-blast-wildcard)` with one endpoint and input object. For local files use `--file input=<path>` or `--file inputs.0=<path>`; the helper uploads them to Tripo before submission.
- The helper persists the task ID and resumes pending tasks. Never launch duplicate paid requests merely because polling was interrupted.

```bash
node .claude/scripts/tripo/run-tripo.mjs \
  --endpoint "generation/text-to-image" \
  --input-json '{"prompt":"A wooden treasure chest, isolated on white","model":"seedream_v5","size":"2K","output_format":"png"}' \
  --output-dir "worlds/<world>/source" \
  --output-slug "treasure-chest"
```

For text-to-3D use `generation/text-to-model` with `prompt`, `model: "v3.1-20260211"`, `texture: true`, `pbr: true`, and `face_limit: 50000`. For model processing use the official schema for the exact route. Use triangle GLB output for assets displayed by this viewer.

Repair missing files from recorded URLs with:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "<request-json-path>"
```

Report the endpoint, task ID, local output paths, and request metadata. Report any generation error accurately.
