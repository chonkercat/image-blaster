# Image Blaster — selectable generation stack

A fork of [neilsonnn/image-blaster](https://github.com/neilsonnn/image-blaster) with a choice of **Tripo3D** or the **original World Labs + FAL stack**. Claude handles analysis, reasoning, planning, and orchestration with your normal AI subscription or API credentials. Optional sound effects use ElevenLabs through FAL in either stack.

## Quickstart

1. Install Node.js 22+, Bun, and Claude Code. If you use nvm, run `nvm install` and `nvm use`.
2. Clone this fork:

   ```bash
   git clone https://github.com/chonkercat/image-blaster.git
   cd image-blaster
   bun install
   cp .env.example .env
   ```

3. Select a stack and add its keys to `.env` (see below).
4. Put a source image in `input/`, run `claude`, and ask it to `blast it and confirm each step with me`.
5. Start the viewer with `bun run dev` if the workflow has not already started it.

## Switch providers

Change **one line** in `.env`:

```dotenv
ASSET_GENERATION_STACK=original
```

Use `original` for World Labs + FAL, or `tripo` for Tripo3D. An unset switch defaults to `tripo`, preserving existing Tripo installations. Local generation commands read `.env` on each launch; restart an existing Claude session to refresh its setup summary. The viewer can display outputs from both stacks.

| Task | `tripo` | `original` |
| --- | --- | --- |
| Image generation, edits, clean plates, object references | Tripo image API (`seedream_v5`) | FAL Nano Banana 2; optional GPT Image 2 |
| Object meshes | Tripo H3 (`v3.1-20260211`) | FAL Hunyuan3D v3; optional Meshy v6 |
| Environments | Tripo textured GLB mesh | World Labs Marble 1.1 splats, panorama, collider GLB |
| Other resources | Supported Tripo endpoints | FAL model endpoints |
| Optional sound | ElevenLabs through FAL | ElevenLabs through FAL |

Keys can coexist in the same local file:

```dotenv
ASSET_GENERATION_STACK=original
WORLD_LABS_API_KEY=your_world_labs_key_here
FAL_KEY=your_fal_key_here
WORLD_LABS_MODEL=marble-1.1

TRIPO_API_KEY=your_tripo_key_here
TRIPO_API_BASE_URL=https://openapi.tripo3d.ai/v3
TRIPO_MODEL_VERSION=v3.1-20260211
TRIPO_IMAGE_MODEL=seedream_v5
```

Create keys at [World Labs Platform](https://platform.worldlabs.ai/), [FAL](https://fal.ai/dashboard/keys), and [Tripo](https://developers.tripo3d.ai/). The original stack requires `WORLD_LABS_API_KEY` for worlds and `FAL_KEY` for images/models/resources. Tripo requires `TRIPO_API_KEY`; `FAL_KEY` is optional for sound. Each provider bills generation through its own API account. Keep secrets in `.env`, never in browser code or variables prefixed with `VITE_`.

Check selection and missing keys without exposing key values:

```bash
node .claude/scripts/asset-pipeline/provider-config.mjs --check
```

Optional per-task overrides support mixed stacks: `ASSET_IMAGE_EDIT_PROVIDER=tripo|nano-banana|gpt-image-2`, `ASSET_3D_PROVIDER=tripo|hunyuan|meshy`, and `ASSET_WORLD_PROVIDER=tripo|world-labs`. Set each variable to one value; leave these variables unset to control everything with the master switch. Explicit command-line `--provider` options take precedence over the matching override.

**Switching affects new requests.** Existing artifacts are reused, and interrupted jobs always resume with their recorded provider, even after switching. There is no automatic fallback to another paid provider when a key is missing or a request fails. Use `--regenerate` to compare a fresh model/world, or `--regenerate-reference` for both a new object reference and model. Previous indexed outputs are preserved.

## Generate assets

The same commands use either selected stack:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs \
  --world my-scene --image input/room.png --object-name chair \
  --image-edit-prompt "Isolate the chair on the left. White background, one chair only." \
  --face-count 50000 --enable-pbr true

node .claude/scripts/world/generate-world.mjs --world my-scene
```

Image edits use `generate-edit.mjs` with `--image`, `--prompt`, `--output-dir`, and `--output-slug`. Objects accept `--provider tripo|hunyuan|meshy`; image edits accept `--provider tripo|nano-banana|gpt-image-2`; worlds accept `--provider tripo|world-labs`.

Generic resource requests use the selected stack with provider-specific endpoints and input schemas. With `original`:

```bash
node .claude/scripts/asset-pipeline/run-resource.mjs \
  --endpoint fal-ai/nano-banana-2 \
  --input-json '{"prompt":"A wooden treasure chest on white","resolution":"1K","output_format":"png"}' \
  --output-dir worlds/my-scene/source --output-slug treasure-chest
```

With `tripo`:

```bash
node .claude/scripts/asset-pipeline/run-resource.mjs \
  --endpoint generation/text-to-image \
  --input-json '{"prompt":"A wooden treasure chest on white","model":"seedream_v5","size":"2K","output_format":"png"}' \
  --output-dir worlds/my-scene/source --output-slug treasure-chest
```

Use `--file <input.key>=<local-path>` for local inputs; the helper uploads to Tripo or supplies a data URI to FAL. Consult [Tripo schemas](https://developers.tripo3d.ai/en/docs/introduction), [FAL model docs](https://fal.ai/models/fal-ai/nano-banana-2/api), and [World Labs quickstart](https://docs.worldlabs.ai/api) for exact request fields. Direct `tripo/run-tripo.mjs` and `fal/run-fal.mjs` commands explicitly target their named provider. FAL resources use its resumable queue API.

Tripo meshes default to 50,000 faces (worlds: 100,000), PBR textures, and triangle GLB. Low-poly Tripo uses `--low-poly true --face-count 5000` (500–20,000). Hunyuan defaults to 50,000 faces and accepts 40,000–1,500,000; `--generate-type Normal|LowPoly|Geometry` selects its mode. Meshy defaults to 30,000 polygons; use `--target-polycount` and `--topology`. Tripo images default to 2K and FAL Nano Banana to 1K. Masks/seeds depend on the chosen image model.

## Environment outputs and Unreal

Tripo reconstructs a textured GLB asset from an image or text; a complete room, panorama, or accurate walkable scale is not guaranteed. With an image, its caption is metadata: use a clean plate to control visible geometry.

World Labs generates a Gaussian-splat environment, panorama, and collider mesh. The browser displays splats with the original viewer. Its collider GLB is collision geometry; it does not contain the complete textured splat appearance. Using that appearance in Unreal requires a compatible splat workflow or a separate mesh reconstruction. Switching stacks does not convert existing Unreal packages.

All outputs are downloaded under `worlds/` with indexed filenames. Hidden request files retain provider IDs, progress, inputs, and results for recovery.

## Development

```bash
bun run test
bun run typecheck
bun run build
```

Pipeline tests mock Tripo, FAL, and World Labs HTTP contracts and need no keys or paid requests. The React viewer is in `app/`; generation scripts and Claude workflows are in `.claude/`. Remove `/app` from `.claudeignore` to let Claude modify the viewer. Generated files and `.env` stay gitignored.

License and original project attribution are preserved in [LICENSE.md](LICENSE.md).
