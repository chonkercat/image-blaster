#!/usr/bin/env node
import { rename } from "node:fs/promises";
import path from "node:path";
import { finishTripoRequest, requestNeedsResume } from "../asset-pipeline/tripo-client.mjs";
import { runImageEdit } from "../asset-pipeline/image-edit.mjs";
import {
  ensureDir,
  many,
  one,
  parseArgs,
  pathExists,
  readJson,
  slugify,
  writeJson
} from "../asset-pipeline/fal-queue.mjs";
import {
  artifactPath,
  nextIndex,
  requestMetadataFiles,
  requestPath
} from "../asset-pipeline/request-metadata.mjs";

async function readJsonIfExists(filePath) {
  return (await pathExists(filePath)) ? readJson(filePath) : undefined;
}

function isGeneratedImage(downloaded) {
  const contentType = downloaded.source?.content_type || "";
  return contentType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(downloaded.path);
}

function firstGeneratedImage(imageEditSummary) {
  return (imageEditSummary.downloaded_files || []).find(isGeneratedImage);
}

async function resumeImageEditRequest(request, outputDir, slug) {
  return finishTripoRequest(request, outputDir, slug);
}

export async function generateEdit(options) {
  const {
    images,
    prompt,
    outputDir,
    outputSlug,
    role = "image-edit",
    provider,
    numImages = 1,
    outputFormat = "png",
    resolution,
    aspectRatio,
    quality,
    imageSize,
    maskImage,
    seed
  } = options;

  if (!images?.length) throw new Error("At least one --image is required.");
  if (!prompt) throw new Error("--prompt is required.");
  if (!outputDir) throw new Error("--output-dir is required.");

  await ensureDir(outputDir);

  const slug = slugify(outputSlug || role);
  if (!slug) throw new Error("--output-slug or --role must produce a usable slug.");

  const latestRequest = (await requestMetadataFiles(outputDir, { slug }))[0];
  const activeRequest = await requestNeedsResume(latestRequest) ? latestRequest : undefined;
  const outputIndex = activeRequest?.index ?? await nextIndex(outputDir);
  const extension = `.${String(outputFormat).replace(/^\./, "") || "png"}`;
  const outputPath = artifactPath(outputDir, outputIndex, slug, extension);
  const metadataPath = activeRequest?.path ?? requestPath(outputDir, outputIndex, slug);

  const metadata = {
    index: outputIndex,
    role,
    output_slug: slug,
    input_images: images,
    mask_image: maskImage,
    provider_alias: provider
  };

  const imageEdit = activeRequest
    ? await resumeImageEditRequest(activeRequest, outputDir, slug)
    : await runImageEdit({
        provider,
        prompt,
        images,
        outputDir,
        metadataPath,
        metadata,
        numImages,
        outputFormat,
        resolution,
        aspectRatio,
        quality,
        imageSize,
        maskImage,
        seed
      });

  const rawGeneratedImage = firstGeneratedImage(imageEdit);
  if (!rawGeneratedImage) {
    throw new Error("Image edit did not return a downloadable image.");
  }

  if (rawGeneratedImage.path !== outputPath) {
    await rename(rawGeneratedImage.path, outputPath);
  }

  const previousMetadata = await readJsonIfExists(metadataPath);
  await writeJson(metadataPath, {
    ...previousMetadata,
    ...metadata,
    provider_alias: imageEdit.provider_alias,
    prompt,
    output_files: [outputPath],
    downloaded_files: (imageEdit.downloaded_files || []).map((file) =>
      file.path === rawGeneratedImage.path ? { ...file, path: outputPath } : file
    ),
    updated_at: new Date().toISOString()
  });

  return {
    schema_version: 1,
    role,
    prompt,
    input_images: images,
    output_image: outputPath,
    request_metadata: metadataPath
  };
}

async function main() {
  const { flags } = parseArgs();
  const images = [...many(flags, "image"), ...many(flags, "input-image")];
  const prompt = one(flags, "prompt");
  const outputDir = one(flags, "output-dir");

  if (!prompt || !outputDir || images.length === 0) {
    throw new Error(
      "Usage: node generate-edit.mjs --image <path-or-url> --prompt <prompt> --output-dir <dir> --output-slug <slug> [--role image-edit]"
    );
  }

  const result = await generateEdit({
    images,
    prompt,
    outputDir,
    outputSlug: one(flags, "output-slug") || one(flags, "slug"),
    role: one(flags, "role", "image-edit"),
    provider: one(flags, "provider") || one(flags, "image-edit-provider"),
    numImages: one(flags, "num-images", 1),
    outputFormat: one(flags, "format", "png"),
    resolution: one(flags, "resolution"),
    aspectRatio: one(flags, "aspect-ratio"),
    quality: one(flags, "quality"),
    imageSize: one(flags, "image-size"),
    maskImage: one(flags, "mask-image"),
    seed: one(flags, "seed")
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
