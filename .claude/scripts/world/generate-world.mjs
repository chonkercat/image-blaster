#!/usr/bin/env node
import { copyFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { runTripo3D } from "../asset-pipeline/tripo-3d.mjs";
import { finishTripoRequest } from "../asset-pipeline/tripo-client.mjs";
import { ensureDir, isUrl, many, one, parseArgs, pathExists, readJson, writeJson } from "../asset-pipeline/fal-queue.mjs";
import { artifactPath, nextIndex, parseIndexedName, requestMetadataFiles, requestPath } from "../asset-pipeline/request-metadata.mjs";

const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);

async function latestSourceImage(sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({ index: parseIndexedName(entry.name)?.index ?? 0, path: path.join(sourceDir, entry.name) }))
    .sort((a, b) => b.index - a.index || a.path.localeCompare(b.path))[0]?.path;
}

async function promptFromImageJson(world) {
  const file = `worlds/${world}/image.json`;
  if (!(await pathExists(file))) return undefined;
  const json = await readJson(file);
  return [json.scene_name, json.literal_description, json.environment, json.visual_style, json.lighting, json.atmosphere].filter(Boolean).join("\n");
}

export async function generateWorld(options) {
  const { world, regenerate = false, pollIntervalMs = 5000 } = options;
  if (!world || !/^[a-zA-Z0-9_-]+$/.test(world)) throw new Error("world must be a single safe project slug.");
  const image = options.image || await latestSourceImage(`worlds/${world}/source`);
  const prompt = options.prompt || await promptFromImageJson(world);
  const outputDir = `worlds/${world}/output/world`;
  await ensureDir(outputDir);
  const requests = await requestMetadataFiles(outputDir, { slug: "world" });
  const latest = requests[0];
  if (!regenerate && latest?.data.status === "completed" && latest.data.output_files?.length) {
    const exists = await Promise.all(latest.data.output_files.map(pathExists));
    const manifestPath = artifactPath(outputDir, latest.index, "world", ".json");
    if (exists.every(Boolean) && await pathExists(manifestPath)) return { world, index: latest.index, skipped: true, world_json: manifestPath, route: `/${world}` };
  }
  const request = !regenerate && latest?.data.request_id && !["failed", "cancelled", "canceled"].includes(latest.data.status) ? latest : undefined;
  if (!request && !image && !prompt) throw new Error("World generation requires an image or a prompt.");
  const index = request?.index ?? await nextIndex(outputDir, "world");
  const metadataPath = request?.path ?? requestPath(outputDir, index, "world");
  const sourceImage = request?.data.input_files?.[0] || image;
  const caption = request?.data.prompt || prompt;
  const generation = request
    ? await finishTripoRequest(request, outputDir, "tripo-world", { pollIntervalMs })
    : await runTripo3D({
      image, prompt, outputDir, metadataPath, pollIntervalMs,
      model: options.model, faceCount: options.faceCount ?? 100000, autoSize: true,
      metadata: { kind: "world", index, world }, assetName: world
    });
  const model = generation.downloaded_files.find((file) => /\.glb$/i.test(file.path));
  if (!model) throw new Error("Tripo environment generation did not return a GLB mesh.");
  const preview = generation.downloaded_files.find((file) => /render|preview/i.test(file.label) && /\.(png|jpe?g|webp)$/i.test(file.path));
  const downloaded = [];
  for (const file of generation.downloaded_files) {
    const slug = file === model ? "world" : file === preview ? "world-thumbnail" : `world-${file.label}`;
    const dest = artifactPath(outputDir, index, slug, path.extname(file.path));
    if (file.path !== dest) await rename(file.path, dest);
    downloaded.push({ ...file, path: dest });
  }
  const glb = downloaded.find((file) => file.label === model.label).path;
  const thumbnail = preview ? downloaded.find((file) => file.label === preview.label).path : undefined;
  let plate;
  if (sourceImage && !isUrl(sourceImage) && await pathExists(sourceImage)) {
    plate = artifactPath(outputDir, index, "world-plate", path.extname(sourceImage));
    await copyFile(sourceImage, plate);
  }
  const output = generation.result.output;
  const timestamp = new Date().toISOString();
  const manifest = {
    world_id: generation.request_id, display_name: world, provider: "tripo", environment_type: "mesh",
    world_marble_url: "", tags: null, world_prompt: caption || null,
    created_at: generation.submitted_at, updated_at: timestamp,
    assets: {
      mesh: { collider_mesh_url: output.model_url, render_materials: true },
      imagery: { pano_url: "" },
      splats: { spz_urls: {}, semantics_metadata: { metric_scale_factor: 1, ground_plane_offset: 0, flip_y: false } },
      thumbnail_url: output.rendered_image_url || "", caption: caption || "Tripo mesh environment"
    }
  };
  const worldPath = artifactPath(outputDir, index, "world", ".json");
  await writeJson(worldPath, manifest);
  await writeJson(metadataPath, {
    ...generation, kind: "world", index, world, prompt: caption,
    input_files: sourceImage ? [sourceImage] : [],
    output_files: [worldPath, ...downloaded.map((file) => file.path), ...(plate ? [plate] : [])],
    downloaded_files: downloaded, completed_at: timestamp
  });
  return { world, index, task_id: generation.request_id, request_metadata: metadataPath, world_json: worldPath, glb, thumbnail, plate, environment_type: "mesh", route: `/${world}` };
}

async function main() {
  const { flags } = parseArgs();
  const result = await generateWorld({
    world: one(flags, "world"), image: one(flags, "image"),
    prompt: [...many(flags, "prompt"), ...many(flags, "description")].join("\n").trim() || undefined,
    regenerate: Boolean(flags.regenerate), pollIntervalMs: one(flags, "poll-interval-ms", 5000),
    model: one(flags, "model"), faceCount: one(flags, "face-count")
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
