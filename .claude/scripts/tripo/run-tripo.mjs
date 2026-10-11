#!/usr/bin/env node
import { rename } from "node:fs/promises";
import path from "node:path";
import { finishTripoRequest, requestNeedsResume, runTripoTask, toTripoInput, TRIPO_ENDPOINTS } from "../asset-pipeline/tripo-client.mjs";
import { ensureDir, many, one, parseArgs, slugify, writeJson } from "../asset-pipeline/fal-queue.mjs";
import { artifactPath, nextIndex, requestMetadataFiles, requestPath } from "../asset-pipeline/request-metadata.mjs";

export function setInputFile(input, key, value) {
  const parts = key.split(".");
  if (parts.some((part) => !part || ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("Invalid --file input key.");
  let target = input;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    target[part] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
    if (typeof target[part] !== "object" || target[part] === null) throw new Error(`Invalid --file path: ${key}`);
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

export async function runTripoResource(options) {
  const { endpoint, outputDir, files = [] } = options;
  if (!TRIPO_ENDPOINTS.has(endpoint)) throw new Error(`Choose a supported Tripo endpoint: ${[...TRIPO_ENDPOINTS].join(", ")}`);
  if (!outputDir) throw new Error("--output-dir is required.");
  const input = typeof options.input === "string" ? JSON.parse(options.input) : structuredClone(options.input || {});
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("--input-json must be a JSON object.");
  await ensureDir(outputDir);
  const slug = slugify(options.outputSlug || endpoint.split("/").at(-1));
  if (!slug) throw new Error("Invalid output slug.");
  const requests = await requestMetadataFiles(outputDir, { slug });
  const latest = requests.find((entry) => entry.data.endpoint === endpoint);
  const request = await requestNeedsResume(latest) ? latest : undefined;
  const index = request?.index ?? await nextIndex(outputDir);
  const metadataPath = request?.path || requestPath(outputDir, index, slug);
  const inputFiles = [];
  if (!request) {
    for (const assignment of files) {
      const equals = assignment.indexOf("=");
      if (equals < 1) throw new Error("Use --file <input.key>=<local-path>.");
      const file = assignment.slice(equals + 1);
      setInputFile(input, assignment.slice(0, equals), await toTripoInput(file));
      inputFiles.push(file);
    }
  }
  const summary = request ? await finishTripoRequest(request, outputDir, slug) : await runTripoTask(endpoint, input, {
    outputDir, metadataPath, metadata: { kind: "resource", index, output_slug: slug, input_files: inputFiles, prompt: options.userPrompt || input.prompt }
  });
  const downloaded = [];
  for (let i = 0; i < summary.downloaded_files.length; i++) {
    const file = summary.downloaded_files[i];
    const dest = artifactPath(outputDir, index, i === 0 ? slug : `${slug}-${file.label}`, path.extname(file.path));
    if (file.path !== dest) await rename(file.path, dest);
    downloaded.push({ ...file, path: dest });
  }
  const result = { ...summary, output_files: downloaded.map((file) => file.path), downloaded_files: downloaded };
  await writeJson(metadataPath, result);
  return result;
}

async function main() {
  const { flags } = parseArgs();
  console.log(JSON.stringify(await runTripoResource({
    endpoint: one(flags, "endpoint"), input: one(flags, "input-json", "{}"),
    outputDir: one(flags, "output-dir"), outputSlug: one(flags, "output-slug"),
    files: many(flags, "file"), userPrompt: one(flags, "user-prompt")
  }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
