#!/usr/bin/env node
import { loadDotEnv, pathExists } from "../asset-pipeline/fal-queue.mjs";
import { resolveWorldProvider } from "../asset-pipeline/provider-config.mjs";
import { artifactPath, requestMetadataFiles } from "../asset-pipeline/request-metadata.mjs";
import { generateTripoWorld } from "./tripo-world.mjs";
import { generateWorldLabs } from "./world-labs.mjs";
import { many, one, parseArgs } from "../asset-pipeline/fal-queue.mjs";

export async function generateWorld(options) {
  await loadDotEnv();
  const { world, regenerate = false } = options;
  if (!world || !/^[a-zA-Z0-9_-]+$/.test(world)) throw new Error("world must be a single safe project slug.");
  const outputDir = `worlds/${world}/output/world`;
  let provider = resolveWorldProvider(options.provider);
  const latest = (await requestMetadataFiles(outputDir, { slug: "world" }))[0];
  let request;
  if (!regenerate && latest?.data.request_id && !latest.data.error && !["failed", "cancelled", "canceled"].includes(String(latest.data.status).toLowerCase())) {
    const manifest = artifactPath(outputDir, latest.index, "world", ".json");
    const files = [...(latest.data.output_files || []), ...(latest.data.downloaded_files || []).map((file) => typeof file === "string" ? file : file.path)];
    if (String(latest.data.status).toLowerCase() === "completed" && files.length && (await Promise.all(files.map(pathExists))).every(Boolean) && await pathExists(manifest)) {
      return { world, index: latest.index, skipped: true, provider: latest.data.provider, world_json: manifest, route: `/${world}` };
    }
    request = latest;
    provider = latest.data.provider;
  }
  if (provider === "tripo") return generateTripoWorld(options);
  if (provider === "world-labs") return generateWorldLabs({ ...options, request });
  throw new Error(`Cannot resume unknown world provider: ${provider}`);
}

async function main() {
  const { flags } = parseArgs();
  const result = await generateWorld({
    world: one(flags, "world"), provider: one(flags, "provider"), image: one(flags, "image"),
    prompt: [...many(flags, "prompt"), ...many(flags, "description")].join("\n").trim() || undefined,
    regenerate: Boolean(flags.regenerate), pollIntervalMs: one(flags, "poll-interval-ms", 5000),
    model: one(flags, "model"), faceCount: one(flags, "face-count")
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
