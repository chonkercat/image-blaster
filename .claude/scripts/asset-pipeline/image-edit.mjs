#!/usr/bin/env node
import { loadDotEnv, many, one, parseArgs } from "./fal-queue.mjs";
import { requestPath } from "./request-metadata.mjs";
import { runTripoTask, toTripoInput } from "./tripo-client.mjs";

const IMAGE_MODELS = new Set(["seedream_v5", "seedream_v4", "banana", "banana_pro", "banana2", "chat_image_2", "chat_image_2.5_flare", "chat_image_2.5_sunburst"]);

export function resolveImageEditProvider(provider) {
  const resolved = provider || process.env.ASSET_IMAGE_EDIT_PROVIDER || "tripo";
  if (resolved !== "tripo") throw new Error(`Image generation uses Tripo only. Replace provider "${resolved}" with "tripo".`);
  return resolved;
}

export async function runImageEdit(options) {
  await loadDotEnv();
  resolveImageEditProvider(options.provider);
  const { prompt, images = [], outputDir, outputFormat = "png" } = options;
  if (!prompt || !outputDir) throw new Error("prompt and outputDir are required.");
  if (Number(options.numImages ?? 1) !== 1) throw new Error("Generate one image per request (--num-images 1).");
  if (options.maskImage || options.seed !== undefined) throw new Error("Tripo image requests do not support this mask/seed option; describe the edit in the prompt.");
  const model = options.model || process.env.TRIPO_IMAGE_MODEL || "seedream_v5";
  if (!IMAGE_MODELS.has(model)) throw new Error(`Unsupported Tripo image model: ${model}`);
  if (images.length && model === "seedream_v4") throw new Error("Use seedream_v5 for Tripo image editing; seedream_v4 is for text-to-image.");
  const maxImages = model.startsWith("seedream") ? 4 : model.startsWith("banana") ? 10 : 16;
  if (images.length > maxImages) throw new Error(`${model} accepts at most ${maxImages} reference images.`);
  const format = outputFormat === "jpg" ? "jpeg" : outputFormat;
  if (!["png", "jpeg"].includes(format)) throw new Error("Tripo image format must be png or jpeg.");
  const input = {
    model, prompt, output_format: format,
    size: options.imageSize || options.resolution || (model === "banana" ? "1024x1024" : model.startsWith("chat_image") ? "2048x2048" : "2K")
  };
  if (options.aspectRatio && options.aspectRatio !== "auto") {
    if (model.startsWith("banana")) input.aspect_ratio = options.aspectRatio;
    else input.prompt += `\nOutput aspect ratio: ${options.aspectRatio}.`;
  }
  if (options.quality !== undefined) {
    if (!model.startsWith("chat_image")) throw new Error("--quality is only supported by Tripo chat_image models.");
    input.quality = options.quality;
  }
  if (images.length) {
    const inputs = [];
    for (const image of images) inputs.push(await toTripoInput(image));
    if (inputs.length === 1) input.input = inputs[0];
    else input.inputs = inputs;
  }
  const endpoint = images.length ? "generation/image-to-image" : "generation/text-to-image";
  const summary = await runTripoTask(endpoint, input, {
    ...options,
    metadataPath: options.metadataPath || requestPath(outputDir, 0, "image-edit"),
    metadata: { ...options.metadata, kind: "2d", input_files: images, prompt, provider_alias: "tripo" }
  });
  return { ...summary, provider_alias: "tripo" };
}

async function main() {
  const { flags } = parseArgs();
  const summary = await runImageEdit({
    provider: one(flags, "provider"), model: one(flags, "model"),
    prompt: one(flags, "prompt"), images: [...many(flags, "image"), ...many(flags, "input-image")],
    outputDir: one(flags, "output-dir"), numImages: one(flags, "num-images", 1),
    outputFormat: one(flags, "format", "png"), resolution: one(flags, "resolution"),
    aspectRatio: one(flags, "aspect-ratio"), quality: one(flags, "quality"),
    imageSize: one(flags, "image-size"), maskImage: one(flags, "mask-image"), seed: one(flags, "seed")
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
