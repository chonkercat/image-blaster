---
name: image-blast-wildcard
description: Generate images, 3D models, textures, and other resources through the selected Tripo or original FAL stack when the request does not fit a narrower Image Blast skill.
argument-hint: [provider endpoint or resource request] [prompt, input files, output location]
allowed-tools: Read Write Glob WebFetch WebSearch Bash(ls *) Bash(node .claude/scripts/project/ensure-local-assets.mjs *) Bash(node .claude/scripts/asset-pipeline/provider-config.mjs *) Bash(node .claude/scripts/asset-pipeline/run-resource.mjs *) Bash(node .claude/scripts/tripo/run-tripo.mjs *) Bash(node .claude/scripts/fal/run-fal.mjs *)
---

Resolve one resource operation from `$ARGUMENTS`.

## Instructions

- Run `node .claude/scripts/asset-pipeline/provider-config.mjs --check` before choosing an endpoint. `ASSET_GENERATION_STACK=tripo` uses Tripo resources and `TRIPO_API_KEY`; `original` uses FAL resources and `FAL_KEY`. Normal AI credentials handle analysis/planning. Optional audio uses the sound skill; World Labs environments use the world skill.
- For Tripo, read `https://developers.tripo3d.ai/en/docs/introduction` and choose a route supported by `TRIPO_ENDPOINTS` in `tripo-client.mjs`. For FAL, read the official model API page at `https://fal.ai/models/<endpoint>/api`. Use the exact provider schema; endpoint names and fields differ between providers. Do not invent fields or silently fall back to another paid provider.
- For discovery, present the route, model, request and output location before a paid request unless already authorized. `CONFIRMED_TRIPO_ENDPOINT:` and `CONFIRMED_FAL_ENDPOINT:` mark already confirmed operations.
- Use `ls -a` before reading state. Resolve the output directory from the current project and preserve indexed filenames and request metadata.
- Run `Agent(image-blast-wildcard)` with one endpoint and input object. Use the shared `run-resource.mjs` helper, which follows the selected stack; `--provider tripo|fal` is an explicit override. Local files use `--file <input.key>=<path>`; Tripo uploads files and FAL receives data URIs.
- Pending requests resume with the provider and endpoint saved in metadata even after a stack change. Never submit duplicate paid requests because polling was interrupted. The direct `tripo/run-tripo.mjs` and `fal/run-fal.mjs` helpers explicitly select their named provider.

For the original stack:

```bash
node .claude/scripts/asset-pipeline/run-resource.mjs \
  --endpoint fal-ai/nano-banana-2 \
  --input-json '{"prompt":"A wooden treasure chest, isolated on white","resolution":"1K","output_format":"png"}' \
  --output-dir "worlds/<world>/source" --output-slug "treasure-chest"
```

For Tripo:

```bash
node .claude/scripts/asset-pipeline/run-resource.mjs \
  --endpoint generation/text-to-image \
  --input-json '{"prompt":"A wooden treasure chest, isolated on white","model":"seedream_v5","size":"2K","output_format":"png"}' \
  --output-dir "worlds/<world>/source" --output-slug "treasure-chest"
```

Use triangle GLB output for assets displayed in this viewer. FAL resources use the resumable queue API. Unsupported resource types must be reported accurately.

Repair missing files from recorded URLs with:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "<request-json-path>"
```

Report the provider, endpoint, request ID, local output paths, metadata, and any generation error.
