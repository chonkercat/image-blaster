#!/usr/bin/env node
import { loadDotEnv, one, parseArgs } from "./fal-queue.mjs";
import { requestPath } from "./request-metadata.mjs";
import { runTripoTask, toTripoInput } from "./tripo-client.mjs";

export const TRIPO_3D_PROVIDER = "tripo";
export const DEFAULT_TRIPO_FACE_COUNT = 50000;

export function asBoolean(value, name, fallback = true) {
  if (value === undefined) return fallback;
  if ([true, "true", "1", "yes", "on"].includes(value)) return true;
  if ([false, "false", "0", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

export async function runTripo3D(options) {
  await loadDotEnv();
  const { image, prompt, outputDir } = options;
  if ((!image && !prompt) || !outputDir) throw new Error("An image or prompt and outputDir are required.");
  const model = options.model || process.env.TRIPO_MODEL_VERSION || "v3.1-20260211";
  if (!["v3.1-20260211", "v3.0-20250812"].includes(model)) throw new Error("Use a Tripo H3 model: v3.1-20260211 or v3.0-20250812.");
  const lowPoly = asBoolean(options.lowPoly, "lowPoly", false);
  const faceCount = Number(options.faceCount ?? (lowPoly ? 5000 : DEFAULT_TRIPO_FACE_COUNT));
  if (!Number.isInteger(faceCount) || faceCount < (lowPoly ? 500 : 1000) || faceCount > (lowPoly ? 20000 : model === "v3.0-20250812" ? 1000000 : 1500000)) {
    throw new Error("Invalid --face-count: use 1000–1500000 (v3.0 max 1000000), or 500–20000 with --low-poly true.");
  }
  const texture = asBoolean(options.texture, "texture");
  const input = {
    model, face_limit: faceCount, texture,
    pbr: texture && asBoolean(options.enablePbr, "enablePbr"),
    auto_size: asBoolean(options.autoSize, "autoSize", false), smart_low_poly: lowPoly
  };
  if (image) input.input = await toTripoInput(image);
  else {
    if (prompt.length > 1024) throw new Error("Tripo 3D prompts must be at most 1024 characters.");
    input.prompt = prompt;
  }
  const endpoint = image ? "generation/image-to-model" : "generation/text-to-model";
  const summary = await runTripoTask(endpoint, input, {
    ...options,
    metadataPath: options.metadataPath || requestPath(outputDir, 0, "tripo"),
    metadata: { ...options.metadata, kind: options.metadata?.kind || "3d", input_files: image ? [image] : [], prompt, asset_name: options.assetName }
  });
  if (!(summary.downloaded_files || []).some((file) => /\.glb$/i.test(file.path))) {
    throw new Error("Tripo did not return a GLB model required by the viewer. Request a triangle mesh.");
  }
  return summary;
}

async function main() {
  const { flags } = parseArgs();
  const summary = await runTripo3D({
    image: one(flags, "image"), prompt: one(flags, "prompt"), outputDir: one(flags, "output-dir"),
    model: one(flags, "model"), assetName: one(flags, "asset-name"),
    faceCount: one(flags, "face-count"), enablePbr: one(flags, "enable-pbr"),
    texture: one(flags, "texture"), lowPoly: one(flags, "low-poly"), autoSize: one(flags, "auto-size")
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
