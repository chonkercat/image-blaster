#!/usr/bin/env node
import { rename } from "node:fs/promises";
import path from "node:path";
import { callFalQueue, downloadRemoteFiles, ensureDir, many, one, parseArgs, readJson, slugify, toModelInputUrl, writeJson } from "../asset-pipeline/fal-queue.mjs";
import { finishAssetRequest, requestNeedsResume } from "../asset-pipeline/resume-request.mjs";
import { artifactPath, buildRequestSummary, nextIndex, requestMetadataFiles, requestPath } from "../asset-pipeline/request-metadata.mjs";
import { setInputFile } from "../tripo/run-tripo.mjs";

export async function runFalWildcard(options) {
  const { endpoint, outputDir, files = [] } = options;
  if (!endpoint || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(endpoint)) throw new Error("--endpoint must be a FAL model ID (for example fal-ai/nano-banana-2).");
  if (!outputDir) throw new Error("--output-dir is required.");
  if (options.mode && options.mode !== "queue") throw new Error("Use --mode queue so FAL jobs can resume safely.");
  const input = typeof options.input === "string" ? JSON.parse(options.input) : structuredClone(options.input || {});
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("--input-json must be a JSON object.");
  await ensureDir(outputDir);
  const slug = slugify(options.outputSlug || endpoint.split("/").at(-1));
  if (!slug) throw new Error("Invalid output slug.");
  const latest = (await requestMetadataFiles(outputDir, { slug })).find((record) => record.data.endpoint === endpoint && record.data.provider !== "tripo");
  const request = await requestNeedsResume(latest) ? latest : undefined;
  const index = request?.index ?? await nextIndex(outputDir);
  const metadataPath = request?.path || requestPath(outputDir, index, slug);
  const inputFiles = [];
  if (!request) {
    for (const assignment of files) {
      const equals = assignment.indexOf("=");
      if (equals < 1) throw new Error("Use --file <input.key>=<local-path>.");
      const file = assignment.slice(equals + 1);
      setInputFile(input, assignment.slice(0, equals), await toModelInputUrl(file));
      inputFiles.push(file);
    }
  }
  let summary;
  if (request) summary = await finishAssetRequest(request, outputDir, slug, { pollIntervalMs: options.pollIntervalMs });
  else {
    const metadata = { kind: options.kind || "resource", service: "fal", index, output_slug: slug, provider: endpoint, input_files: inputFiles, prompt: options.userPrompt || input.prompt };
    const result = await callFalQueue(endpoint, input, { metadataPath, metadata, pollIntervalMs: options.pollIntervalMs });
    const downloaded = options.downloadOutputs === false ? [] : await downloadRemoteFiles(result.data, outputDir, slug);
    summary = buildRequestSummary({ kind: metadata.kind, provider: endpoint, endpoint, metadata,
      requestId: result.requestId, submittedAt: result.submittedAt, inputFiles,
      outputFiles: downloaded.map((file) => file.path), downloadedFiles: downloaded, result: result.data });
  }
  const downloaded = [];
  for (let i = 0; i < summary.downloaded_files.length; i++) {
    const file = summary.downloaded_files[i];
    const dest = artifactPath(outputDir, index, i === 0 ? slug : `${slug}-${i}-${file.label}`, path.extname(file.path));
    if (file.path !== dest) await rename(file.path, dest);
    downloaded.push({ ...file, path: dest });
  }
  const result = { ...summary, mode: "queue", output_files: downloaded.map((file) => file.path), downloaded_files: downloaded, request_metadata: metadataPath };
  await writeJson(metadataPath, result);
  return result;
}

async function main() {
  const { flags } = parseArgs();
  if (flags["input-file"] && flags["input-json"]) throw new Error("Use only one of --input-file or --input-json.");
  const input = flags["input-file"] ? await readJson(one(flags, "input-file")) : JSON.parse(one(flags, "input-json", "{}"));
  for (const assignment of many(flags, "input")) {
    const equals = assignment.indexOf("=");
    if (equals < 1) throw new Error("Use --input key=value.");
    let value = assignment.slice(equals + 1);
    try { value = JSON.parse(value); } catch {}
    setInputFile(input, assignment.slice(0, equals), value);
  }
  console.log(JSON.stringify(await runFalWildcard({ endpoint: one(flags, "endpoint") || one(flags, "model"), input,
    outputDir: one(flags, "output-dir"), outputSlug: one(flags, "output-slug") || one(flags, "slug"),
    mode: one(flags, "mode", "queue"), kind: one(flags, "kind"), files: many(flags, "file"),
    pollIntervalMs: one(flags, "poll-interval-ms", 5000), userPrompt: one(flags, "user-prompt") }), null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
