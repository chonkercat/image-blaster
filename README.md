# Image Blaster — Tripo edition

A fork of [neilsonnn/image-blaster](https://github.com/neilsonnn/image-blaster) that uses **Tripo3D for images, image edits, 3D models, environment meshes, textures, and resource generation**. Claude still handles image analysis, reasoning, planning, and orchestration with your normal AI subscription or API credentials. Sound effects remain an optional ElevenLabs/FAL feature.

## Quickstart

1. Install Node.js 22+, Bun, and Claude Code. If you use nvm, run `nvm install` and `nvm use`.
2. Clone this fork:

   ```bash
   git clone https://github.com/chonkercat/image-blaster.git
   cd image-blaster
   bun install
   cp .env.example .env
   ```

3. Add your [Tripo API key](https://developers.tripo3d.ai/) to `TRIPO_API_KEY` in `.env`. Keep it local; the browser never receives it. Set `FAL_KEY` only if you want sound effects.
4. Put a source image in `input/`, run `claude`, and ask it to `blast it and confirm each step with me`.
5. Start the viewer with `bun run dev` if the workflow has not already started it.

Tripo generation consumes Tripo credits. General AI tokens are used only for the assistant's normal analysis/planning. No World Labs key is needed, and there is no FAL/OpenAI fallback for image or 3D generation.

## What changed

| Task | Provider |
| --- | --- |
| Source cleanup, clean plates, object references, new images | Tripo image API (`seedream_v5` by default) |
| Object meshes and environment mesh | Tripo H3 (`v3.1-20260211` by default) |
| Textures, model processing, other supported visual resources | Tripo API |
| Analysis, object identification, prompts, orchestration | Your normal Claude configuration |
| Optional ambient and object sound effects | ElevenLabs through FAL |

**Environment generation produces a textured GLB mesh.** This replaces the upstream World Labs Gaussian-splat world workflow. Tripo reconstructs an asset from an image or text; a complete explorable room, panorama, and accurate walkable dimensions are not guaranteed. Existing World Labs splat projects remain viewable. With an image, the caption is descriptive metadata: use a clean plate to control which objects appear in the geometry. Text-only environments use text-to-model.

All outputs are downloaded to local indexed files under `worlds/`. Hidden request files preserve task IDs, progress, inputs, and results so interrupted jobs can resume. Keys are read only by local scripts.

## Configuration

```dotenv
TRIPO_API_KEY=your_tripo_key_here
TRIPO_API_BASE_URL=https://openapi.tripo3d.ai/v3
TRIPO_MODEL_VERSION=v3.1-20260211
TRIPO_IMAGE_MODEL=seedream_v5
FAL_KEY=
```

Use the matching regional Tripo base URL if your key belongs to another region. See [Tripo authentication](https://developers.tripo3d.ai/en/docs/authentication). Never prefix secrets with `VITE_`.

## Direct generation

Create an object reference and GLB model:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs \
  --world my-scene --image input/room.png --object-name chair \
  --image-edit-prompt "Isolate the chair on the left. White background, one chair only." \
  --face-count 50000 --enable-pbr true
```

Create an environment mesh from the latest staged source image:

```bash
node .claude/scripts/world/generate-world.mjs --world my-scene
```

Generate a new image, texture, or other Tripo resource through the generic helper:

```bash
node .claude/scripts/tripo/run-tripo.mjs \
  --endpoint generation/text-to-image \
  --input-json '{"prompt":"A small wooden treasure chest on white","model":"seedream_v5","size":"2K","output_format":"png"}' \
  --output-dir worlds/my-scene/source --output-slug treasure-chest
```

For image edits, use `generate-edit.mjs` with `--image`, `--prompt`, `--output-dir`, and `--output-slug`. For direct text-to-3D or image-to-3D, use `tripo-3d.mjs` with `--prompt` or `--image` and `--output-dir`. Generic resource input JSON follows the [official Tripo API schema](https://developers.tripo3d.ai/en/docs/introduction); local files use `--file input=<path>` or `--file inputs.0=<path>`.

Model options include `--face-count` (default 50,000; environments 100,000), `--enable-pbr true|false`, `--texture false` for geometry only, and `--low-poly true --face-count 5000` (500–20,000 faces). Triangle GLB output is required by the viewer. Images default to one PNG at 2K. Explicit unsupported masks, seeds, and old provider overrides are rejected.

Rerun the same command to resume an interrupted task. Use `--regenerate` for a fresh model/environment, or `--regenerate-reference` for a fresh object extraction and model. Legacy pending FAL/World Labs tasks are not resumed through Tripo: regenerate them explicitly. Existing local assets can still be reused.

## Development

```bash
bun run test
bun run typecheck
bun run build
```

The pipeline tests mock Tripo's HTTP contract and need no API keys or paid requests. The React viewer is in `app/`; generation scripts and Claude workflows are in `.claude/`. Remove `/app` from `.claudeignore` to let Claude modify the viewer. Generated files and `.env` stay gitignored.

License and original project attribution are preserved in [LICENSE.md](LICENSE.md).
