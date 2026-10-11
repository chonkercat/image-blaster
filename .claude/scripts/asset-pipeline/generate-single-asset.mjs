#!/usr/bin/env node
import { readdir, rename } from "node:fs/promises";
import path from "node:path";
import { TRIPO_3D_PROVIDER, runTripo3D } from "./tripo-3d.mjs";
import { finishTripoRequest } from "./tripo-client.mjs";
import { runImageEdit } from "./image-edit.mjs";
import {
  ensureDir,
  one,
  parseArgs,
  pathExists,
  readJson,
  safeFileName,
  sanitizeForMetadata,
  slugify,
  writeJson
} from "./fal-queue.mjs";
import {
  artifactPath,
  nextIndex,
  parseIndexedName,
  requestPath
} from "./request-metadata.mjs";

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const MODEL_EXTENSIONS = new Set([".blend", ".fbx", ".glb", ".obj", ".stl", ".usdz"]);
const GENERATED_OBJECT_FIELDS = new Set(["status"]);
export const DEFAULT_3D_PROVIDER = TRIPO_3D_PROVIDER;

async function readJsonIfExists(filePath) {
  return (await pathExists(filePath)) ? readJson(filePath) : undefined;
}

async function directoryFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name));
}

function cleanObject(object, workingDir) {
  const cleaned = { ...object, working_dir: object.working_dir || workingDir };
  for (const field of GENERATED_OBJECT_FIELDS) delete cleaned[field];
  return cleaned;
}

function collectSourceImages(object, directImage) {
  const images = new Set();

  if (directImage) images.add(directImage);

  for (const image of object.source_images || []) {
    images.add(image);
  }

  for (const evidence of object.evidence || []) {
    if (evidence.image) images.add(evidence.image);
  }

  return [...images];
}

function firstGeneratedImage(imageEditSummary) {
  return (imageEditSummary.downloaded_files || []).find((downloaded) => {
    const contentType = downloaded.source?.content_type || "";
    return contentType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(downloaded.path);
  });
}

function buildDirectObject({ objectId, objectName, description, image, world }) {
  const name = objectName || objectId || path.basename(image, path.extname(image));
  const id = objectId || slugify(name);
  return {
    id,
    name,
    description: description || name,
    source_images: image ? [image] : [],
    evidence: image ? [{ image, notes: "Direct single-image object input" }] : [],
    generate_as_3d_object: true,
    working_dir: `worlds/${world}/output/${id}`
  };
}

function resolve3DProvider(value = DEFAULT_3D_PROVIDER) {
  if (value !== "tripo") throw new Error(`3D generation uses Tripo only. Replace provider "${value}" with "tripo".`);
  return TRIPO_3D_PROVIDER;
}

function modelRequestPrefix() { return TRIPO_3D_PROVIDER; }
async function run3DProvider(options) { return runTripo3D(options); }

function nowIso() {
  return new Date().toISOString();
}

function statusText(value) {
  return String(value || "").toLowerCase();
}

function isCompletedRequest(request) {
  return ["completed", "succeeded", "success"].includes(statusText(request.data?.status));
}

function isFailedRequest(request) {
  const status = statusText(request.data?.status);
  return Boolean(request.data?.error) || ["failed", "error", "cancelled", "canceled"].includes(status);
}

function isUsableRequest(request) {
  return Boolean(request.data?.request_id && request.data?.endpoint) && !isFailedRequest(request);
}

function isActiveRequest(request) {
  return isUsableRequest(request) && !isCompletedRequest(request);
}

function latestByIndex(entries) {
  return entries
    .filter((entry) => Number.isInteger(entry.index))
    .sort((a, b) => b.index - a.index)
    .at(0);
}

async function latestArtifact(dirPath, slug, extensions) {
  const files = await directoryFiles(dirPath);
  const artifacts = files
    .map((filePath) => {
      const parsed = parseIndexedName(filePath);
      return parsed && !parsed.hidden && parsed.slug === slug && extensions.has(parsed.extension.toLowerCase())
        ? { ...parsed, path: filePath }
        : undefined;
    })
    .filter(Boolean);
  return latestByIndex(artifacts);
}

async function requestMetadataFiles(dirPath, slug, scope) {
  const files = await directoryFiles(dirPath);
  const requests = [];

  for (const filePath of files) {
    const parsed = parseIndexedName(filePath);
    if (!parsed?.hidden || parsed.slug !== slug || parsed.scope !== scope) continue;
    const data = await readJsonIfExists(filePath);
    if (!data) continue;
    requests.push({
      ...parsed,
      path: filePath,
      data
    });
  }

  return requests;
}

async function resolveObject(options) {
  const { world, objectId, directImage, objectName, description } = options;
  const directObject = directImage
    ? buildDirectObject({ objectId, objectName, description, image: directImage, world })
    : undefined;
  const resolvedId = objectId || directObject?.id;

  if (!resolvedId) {
    throw new Error("objectId or directImage is required.");
  }

  const objectDir = `worlds/${world}/output/${resolvedId}`;
  const objectJsonPath = path.join(objectDir, "object.json");
  const existing = await readJsonIfExists(objectJsonPath);

  if (existing?.object) {
    return {
      object: {
        ...cleanObject(existing.object, objectDir),
        ...(directImage
          ? {
              source_images: [...new Set([...(existing.object.source_images || []), directImage])],
              evidence: [
                ...(existing.object.evidence || []),
                { image: directImage, notes: "Direct single-image object input" }
              ]
            }
          : {})
      },
      objectDir,
      objectJsonPath
    };
  }

  if (directObject) {
    return {
      object: cleanObject(directObject, objectDir),
      objectDir,
      objectJsonPath
    };
  }

  throw new Error(`Object file not found: ${objectJsonPath}`);
}

async function writeObjectIntent(objectJsonPath, world, object) {
  const state = {
    schema_version: 1,
    world,
    object,
    updated_at: nowIso()
  };
  await writeJson(objectJsonPath, state);
  return state;
}

async function normalizeReferenceImage(downloadedImage, objectDir, objectId, requestIndex) {
  const extension = path.extname(downloadedImage.path) || ".png";
  const numberedPath = artifactPath(objectDir, requestIndex, objectId, extension);
  if (downloadedImage.path !== numberedPath) {
    await rename(downloadedImage.path, numberedPath);
  }
  return {
    ...downloadedImage,
    path: numberedPath
  };
}

async function normalizeModelFiles(downloadedFiles, objectDir, objectId, requestIndex) {
  const safeSlug = safeFileName(objectId);
  const seen = new Set();
  let primaryModelUsed = false;

  const normalized = [];
  for (let index = 0; index < downloadedFiles.length; index += 1) {
    const downloaded = downloadedFiles[index];
    const extension = path.extname(downloaded.path) || ".bin";
    const label = safeFileName(downloaded.label || `file-${index + 1}`);
    const usePrimaryName = MODEL_EXTENSIONS.has(extension.toLowerCase()) && !primaryModelUsed;
    if (usePrimaryName) primaryModelUsed = true;
    const baseName =
      usePrimaryName
        ? `${requestIndex}-${safeSlug}${extension}`
        : `${requestIndex}-${safeSlug}-${label}${extension}`;
    const dedupedName = seen.has(baseName)
      ? `${requestIndex}-${safeSlug}-${label}-${index + 1}${extension}`
      : baseName;
    seen.add(dedupedName);

    const outputPath = path.join(objectDir, dedupedName);
    if (downloaded.path !== outputPath) {
      await rename(downloaded.path, outputPath);
    }
    normalized.push({
      ...downloaded,
      path: outputPath
    });
  }

  return normalized;
}

async function resumeTripoRequest(request, prefix, outputDir, pollIntervalMs = 5000) {
  return finishTripoRequest(request, outputDir, prefix, { pollIntervalMs });
}

export async function generateSingleObject(options) {
  const {
    world,
    objectId,
    directImage,
    objectName,
    description,
    imageEditPrompt,
    regenerate = false,
    imageEditProvider,
    modelProvider,
    faceCount,
    enablePbr = true,
    texture = true,
    lowPoly = false,
    model,
    referenceOnly = false,
    regenerateReference = false
  } = options;

  if (!world) throw new Error("world is required.");
  if (!objectId && !directImage) throw new Error("objectId or directImage is required.");

  const resolved = await resolveObject({
    world,
    objectId,
    directImage,
    objectName,
    description
  });

  const object = cleanObject(resolved.object, resolved.objectDir);
  const provider = resolve3DProvider(modelProvider || DEFAULT_3D_PROVIDER);
  const regenerateModel = regenerate || regenerateReference;
  await ensureDir(resolved.objectDir);
  await writeObjectIntent(resolved.objectJsonPath, world, object);

  const sourceImages = collectSourceImages(object, directImage);
  if (sourceImages.length === 0) {
    throw new Error(`Object ${object.id} does not have source images for image editing.`);
  }

  const imageRequests = regenerateReference ? [] : await requestMetadataFiles(resolved.objectDir, object.id, "image");
  const modelRequests = regenerateModel ? [] : await requestMetadataFiles(resolved.objectDir, object.id, "model");
  const activeImageRequest = latestByIndex(imageRequests.filter(isActiveRequest));
  const usableImageRequest = latestByIndex(imageRequests.filter(isUsableRequest));
  const activeModelRequest = latestByIndex(modelRequests.filter(isActiveRequest));
  const usableModelRequest = latestByIndex(modelRequests.filter(isUsableRequest));
  const existingImage = regenerateReference ? undefined : await latestArtifact(resolved.objectDir, object.id, IMAGE_EXTENSIONS);
  const existingModel = regenerateModel ? undefined : await latestArtifact(resolved.objectDir, object.id, MODEL_EXTENSIONS);

  if (existingModel && !activeModelRequest && !regenerateModel) {
    return {
      schema_version: 1,
      world,
      object,
      object_json: resolved.objectJsonPath,
      output_dir: resolved.objectDir,
      skipped: true,
      skip_reason: "Model artifact already exists. Pass --regenerate to create a new generation.",
      model: existingModel.path
    };
  }

  const requestIndex =
    activeModelRequest?.index ??
    (existingImage ? undefined : activeImageRequest?.index) ??
    (regenerateModel ? undefined : existingImage?.index) ??
    usableModelRequest?.index ??
    (existingImage ? undefined : usableImageRequest?.index) ??
    await nextIndex(resolved.objectDir, object.id);

  let generatedImagePath = existingImage?.path;
  let imageMetadataPath;
  let modelMetadataPath;
  let modelFiles = existingModel ? [existingModel.path] : [];

  try {
    if (!generatedImagePath) {
      const imageRequest =
        activeImageRequest && activeImageRequest.index === requestIndex
          ? activeImageRequest
          : usableImageRequest && usableImageRequest.index === requestIndex
            ? usableImageRequest
            : undefined;
      imageMetadataPath = imageRequest?.path || requestPath(resolved.objectDir, requestIndex, object.id, "image");
      if (!imageRequest && !imageEditPrompt) {
        throw new Error(
          `Image edit prompt is required to create a reference image for ${object.id}. Pass --image-edit-prompt "<prompt>".`
        );
      }
      const imageEdit = imageRequest
        ? await resumeTripoRequest(imageRequest, "image-edit", resolved.objectDir)
        : await runImageEdit({
            provider: imageEditProvider,
            prompt: imageEditPrompt,
            images: sourceImages,
            outputDir: resolved.objectDir,
            metadataPath: imageMetadataPath,
            metadata: { index: requestIndex },
            numImages: 1,
            resolution: "2K",
            aspectRatio: "1:1",
            outputFormat: "png",
            limitGenerations: true
          });

      const rawGeneratedImage = firstGeneratedImage(imageEdit);
      if (!rawGeneratedImage) {
        throw new Error(`Image edit did not return a downloadable image for ${object.id}.`);
      }

      const generatedImage = await normalizeReferenceImage(
        rawGeneratedImage,
        resolved.objectDir,
        object.id,
        requestIndex
      );
      generatedImagePath = generatedImage.path;
      const imageEditMetadata = (await readJsonIfExists(imageMetadataPath)) || imageEdit;
      await writeJson(imageMetadataPath, {
        ...imageEditMetadata,
        kind: "2d",
        index: requestIndex,
        output_files: [generatedImage.path],
        downloaded_files: (imageEdit.downloaded_files || []).map((file) =>
          file.path === rawGeneratedImage.path ? { ...file, path: generatedImage.path } : file
        ),
        updated_at: nowIso()
      });
    }

    if (referenceOnly) {
      return {
        schema_version: 1,
        world,
        object,
        object_json: resolved.objectJsonPath,
        output_dir: resolved.objectDir,
        reference_only: true,
        reference_image: generatedImagePath,
        request_metadata: [imageMetadataPath].filter(Boolean)
      };
    }

    const currentModel = regenerateModel ? undefined : await latestArtifact(resolved.objectDir, object.id, MODEL_EXTENSIONS);
    if (!currentModel || activeModelRequest) {
      const modelRequest =
        activeModelRequest && activeModelRequest.index === requestIndex
          ? activeModelRequest
          : usableModelRequest && usableModelRequest.index === requestIndex
            ? usableModelRequest
            : undefined;
      modelMetadataPath = modelRequest?.path || requestPath(resolved.objectDir, requestIndex, object.id, "model");
      const modelGeneration = modelRequest
        ? await resumeTripoRequest(
            modelRequest,
            modelRequestPrefix(modelRequest, provider),
            resolved.objectDir,
            10000
          )
        : await run3DProvider({
            provider,
            image: generatedImagePath,
            outputDir: resolved.objectDir,
            metadataPath: modelMetadataPath,
            metadata: { index: requestIndex, provider_slug: provider },
            assetName: object.name,
            faceCount,
            enablePbr,
            texture,
            lowPoly,
            model
          });

      if (!(modelGeneration.downloaded_files || []).some((file) => /\.glb$/i.test(file.path))) {
        throw new Error("Tripo did not return a GLB model required by the viewer.");
      }
      const normalizedModelFiles = await normalizeModelFiles(
        modelGeneration.downloaded_files || [],
        resolved.objectDir,
        object.id,
        requestIndex
      );
      modelFiles = normalizedModelFiles.map((file) => file.path);
      const modelMetadata = (await readJsonIfExists(modelMetadataPath)) || modelGeneration;
      await writeJson(modelMetadataPath, {
        ...modelMetadata,
        kind: "3d",
        index: requestIndex,
        provider_slug: modelMetadata.provider_slug || modelRequestPrefix(modelRequest, provider),
        output_files: modelFiles,
        downloaded_files: sanitizeForMetadata(normalizedModelFiles),
        updated_at: nowIso()
      });
    } else {
      modelFiles = [currentModel.path];
    }

    return {
      schema_version: 1,
      world,
      object,
      object_json: resolved.objectJsonPath,
      output_dir: resolved.objectDir,
      model_provider: provider,
      reference_image: generatedImagePath,
      model_files: modelFiles,
      request_metadata: [imageMetadataPath, modelMetadataPath].filter(Boolean)
    };
  } catch (error) {
    throw Object.assign(error, {
      object,
      object_json: resolved.objectJsonPath,
      output_dir: resolved.objectDir
    });
  }
}

export const generateSingleAsset = generateSingleObject;

async function main() {
  const { flags } = parseArgs();
  const world = one(flags, "world");
  const objectId = one(flags, "object-id") || one(flags, "asset-id");
  const directImage = one(flags, "image");

  if (!world || (!objectId && !directImage)) {
    throw new Error(
      "Usage: node generate-single-asset.mjs --world <world-name> (--object-id <object-id> | --image <path>) --image-edit-prompt <prompt> [--provider tripo] [--regenerate] [--regenerate-reference] [--reference-only] [--face-count 50000] [--enable-pbr true|false] [--texture true|false] [--low-poly true|false]"
    );
  }

  const result = await generateSingleObject({
    world,
    objectId,
    directImage,
    objectName: one(flags, "object-name") || one(flags, "asset-name"),
    description: one(flags, "description"),
    imageEditPrompt: one(flags, "image-edit-prompt") || one(flags, "prompt"),
    regenerate: Boolean(flags.regenerate),
    regenerateReference: Boolean(flags["regenerate-reference"]),
    referenceOnly: Boolean(flags["reference-only"]),
    imageEditProvider: one(flags, "image-edit-provider"),
    modelProvider: one(flags, "provider") || one(flags, "3d-provider") || one(flags, "model-provider"),
    faceCount: one(flags, "face-count") || one(flags, "target-polycount"),
    enablePbr: one(flags, "enable-pbr", true),
    texture: one(flags, "texture", true),
    lowPoly: one(flags, "low-poly", false),
    model: one(flags, "model")
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
