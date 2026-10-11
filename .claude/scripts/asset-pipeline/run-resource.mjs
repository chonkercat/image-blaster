#!/usr/bin/env node
import { loadDotEnv, many, one, parseArgs, readJson, slugify } from "./fal-queue.mjs";
import { resolveResourceProvider } from "./provider-config.mjs";
import { requestMetadataFiles } from "./request-metadata.mjs";
import { requestNeedsResume } from "./resume-request.mjs";
import { runTripoResource } from "../tripo/run-tripo.mjs";
import { runFalWildcard } from "../fal/run-fal.mjs";

export async function runResource(options) {
  await loadDotEnv();
  let provider = resolveResourceProvider(options.provider);
  let endpoint = options.endpoint;
  if (!endpoint || !options.outputDir) throw new Error("--endpoint and --output-dir are required.");
  const slug = slugify(options.outputSlug || endpoint.split("/").at(-1));
  const latest = (await requestMetadataFiles(options.outputDir, { slug }))[0];
  if (await requestNeedsResume(latest)) {
    provider = latest.data.provider === "tripo" ? "tripo" : "fal";
    endpoint = latest.data.endpoint;
  }
  const run = provider === "tripo" ? runTripoResource : runFalWildcard;
  return run({ ...options, endpoint, outputSlug: slug });
}

async function main() {
  const { flags } = parseArgs();
  if (flags["input-file"] && flags["input-json"]) throw new Error("Use only one of --input-file or --input-json.");
  console.log(JSON.stringify(await runResource({ provider: one(flags, "provider"), endpoint: one(flags, "endpoint"),
    input: flags["input-file"] ? await readJson(one(flags, "input-file")) : one(flags, "input-json", "{}"),
    outputDir: one(flags, "output-dir"), outputSlug: one(flags, "output-slug"),
    files: many(flags, "file"), userPrompt: one(flags, "user-prompt") }), null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
