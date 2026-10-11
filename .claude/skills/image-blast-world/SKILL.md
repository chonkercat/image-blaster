---
name: image-blast-world
description: Generate the 3D static environment of a world from a source or plate image.
argument-hint: [world-name] [optional image path or world prompt]
allowed-tools: Read Write Glob Bash(ls *) Bash(node .claude/scripts/project/project-state.mjs *) Bash(node .claude/scripts/project/ensure-local-assets.mjs *) Bash(node .claude/scripts/world/generate-world.mjs *)
context: fork
agent: image-blast-world
---

Create or resume one Tripo world for project `$0`.

## Instructions

- Use `TRIPO_API_KEY` only for generation. General AI credentials are for analysis and planning.
- This fork generates a textured environment **mesh**, not a World Labs explorable Gaussian-splat world or panorama. Tripo reconstructs geometry from the source image; it does not guarantee a complete room or accurate walkable scale. Do not promise equivalent world reconstruction.
- For image-based generation, the image controls the geometry; `--prompt` is retained as descriptive metadata. Create a clean plate before generating if objects must be removed. Without an image, the prompt is sent to Tripo text-to-model (maximum 1024 characters).

- If `$0` is missing, ask for the world slug.
- Use `ls -a` before reading generated state.
- Use an explicit image path or prompt from `$ARGUMENTS` when provided.
- Without an explicit image, the world helper uses the highest-index visible image in `worlds/$0/source/`.
- Before generating, synthesize a prompt for the world that takes the original caption data we have and removes and objects we took out of the image. Use `worlds/$0/image.json` for the original scene description, then subtract all confirmed or explicitly removed objects from that description. Confirmed objects are `worlds/$0/output/<object>/object.json` files; use `object.name` and `object.description` to understand what to remove from the original scene description. 
- Treat the synthesized prompt as a text clean plate: preserve the original setting, materials, lighting, atmosphere, camera feel, and spatial layout, but describe the scene as an empty. Do not name, imply, or reintroduce removed objects, and do not reuse `imageJson.short_caption` directly.
- If the user specifically provides caption wording, apply the same subtraction rule before sending it. The Tripo prompt should describe the static empty environment, the "plate" environment, not the objects that were removed.
- The helper resumes unfinished `.N-world-request.json`, strips base64 before writing JSON, polls Tripo, writes `N-world.json`, and downloads the textured GLB mesh and preview to matching `N-world*` files in `worlds/$0/output/world/`.
- The frontend must only load local files from disk. Tripo URLs in `N-world.json` are provenance/resume data only; never leave mesh or thumbnail assets to be loaded from provider URLs.
- If any referenced GLB or thumbnail URL exists in `N-world.json`, make sure the matching local file is present before reporting success. Use the generic local asset tool on the matching `N-world.json` if files are missing.

```bash
node .claude/scripts/project/project-state.mjs --world "$0"
```

Run:

```bash
node .claude/scripts/world/generate-world.mjs --world "$0" --prompt "<empty-environment world caption>"
```

Pass `--image` only when an explicit image path is provided or the selected source is not the helper default. Always pass `--prompt` with the synthesized empty-environment caption. For explicit regeneration, append `--regenerate`.

To fill missing local files from an existing world response, run:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "worlds/$0/output/world/<N>-world.json"
```

```bash
node .claude/scripts/project/project-state.mjs --world "$0"
```

Final response: report the source image used when relevant, the generation index, world output path, downloaded GLB mesh and thumbnail paths, and any failure/resume metadata.
