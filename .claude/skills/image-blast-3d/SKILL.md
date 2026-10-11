---
name: image-blast-3d
description: Generate one specified atomic 3D object. Use when the user names exactly one object instance to make, or provides one image plus the object name/description.
argument-hint: [world-name] [object-id/name or image path + description] [--image-edit-prompt prompt] [--provider tripo] [--regenerate] [--regenerate-reference] [--face-count N] [--texture true|false] [--low-poly true|false] [--enable-pbr true|false]
allowed-tools: Read Write Glob Bash(ls *) Bash(node .claude/scripts/project/project-state.mjs *) Bash(node .claude/scripts/project/ensure-local-assets.mjs *) Bash(node .claude/scripts/asset-pipeline/generate-single-asset.mjs *)
context: fork
agent: image-blast-3d
---

Create exactly one 3D object for project `$0`.

## Instructions

The arguments must identify one object clearly enough for this forked skill to work alone.

- If `$0` is missing, ask for the world slug.
- If the object is missing or ambiguous, ask for exactly one atomic object instance.
- Use `ls -a` before reading generated state.
- Find the object in `worlds/$0/output/<object>/object.json`, `worlds/$0/image.json`, or `worlds/$0/source/*.json`.
- If the object has no `object.json`, create the minimal durable intent:

```json
{
  "schema_version": 1,
  "world": "$0",
  "object": {
    "id": "<object-slug>",
    "name": "<object name>",
    "description": "<literal object description>",
    "materials": [],
    "source_images": [],
    "evidence": [],
    "generate_as_3d_object": true,
    "working_dir": "worlds/$0/output/<object-slug>"
  },
  "updated_at": "..."
}
```

- Preserve available `description`, `materials`, `source_images`, and `evidence`.
- Write a natural image-edit prompt for this specific object and pass it as `--image-edit-prompt`. Use this as the base prompt, filling in the target object and then elaborating with object-specific details: "Isolate the <target object> from this image. Reproduce it exactly as shown -- same colors, materials, and proportions. White background, centered, tight crop, studio lighting. No other objects, no scene, no people, no text, no shadows on the ground. Isolate the object and remove all clustered, adjacent, overlapping, or items resting on the target object. Create a clean render of that one single object that is true to the source image."
- The prompt must ask for one atomic physical instance only: not a pair, set, cluster, category example, or adjacent duplicate. If the source contains similar objects, identify the target by location and exclude the others.
- Do not write generated status, jobs, file lists, or request lifecycle into `object.json`.

Run the generator and wait for it to finish:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs --world "$0" --object-id "<object-id>" --image-edit-prompt "<object-specific extraction prompt>"
```

The first run may create a clean reference PNG with image edit. Later runs reuse the latest reference PNG by default, including `--regenerate` model runs. Use `--regenerate-reference` only when the user asks for a new extraction from the source image. For iterative refinement, pass `--reference-only` to stop after the image-edit step.

If request metadata records provider URLs but local model or image files are missing, fill them from the matching hidden request JSON:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "<request-json-path>"
```

Tripo is the only image and 3D provider in this fork. It uses `TRIPO_API_KEY`; never use a general AI token or FAL for image/model generation. Claude handles analysis and planning using its normal subscription/API credentials.

The default H3 model is `v3.1-20260211`, with 50,000 triangle faces and PBR textures. Options:

- `--face-count <1000-1500000>` (v3.0 maximum: 1,000,000)
- `--enable-pbr true|false`
- `--texture false` for geometry only
- `--low-poly true --face-count 5000` for low-poly assets (500–20,000 faces)
- `--model v3.1-20260211|v3.0-20250812`

Outputs must be GLB triangle meshes for the viewer. Rigging, texturing and format conversion can use the generic Tripo resource workflow. Old provider overrides are rejected. To migrate legacy unfinished requests, use `--regenerate-reference` to create both a new reference and model through Tripo.

For explicit model regeneration from the existing reference, append `--regenerate`. For a new source extraction and model, append `--regenerate-reference`. For direct single-image generation, use:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs --world "$0" --image "<image-path>" --object-name "<object-name>" --description "<description>" --image-edit-prompt "<object-specific extraction prompt>"
```

Final response: report the object id, output directory, generated model files, and any failed/resumable request metadata.