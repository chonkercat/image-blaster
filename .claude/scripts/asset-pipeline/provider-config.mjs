#!/usr/bin/env node
import { loadDotEnv } from "./fal-queue.mjs";

export function resolveGenerationStack(value = process.env.ASSET_GENERATION_STACK || "tripo") {
  const stack = String(value).trim().toLowerCase();
  if (!["tripo", "original"].includes(stack)) {
    throw new Error(`Unsupported ASSET_GENERATION_STACK "${value}". Use tripo or original.`);
  }
  return stack;
}

function resolveProvider(value, envName, originalDefault, allowed) {
  const stack = resolveGenerationStack();
  const provider = String(value || process.env[envName] || (stack === "tripo" ? "tripo" : originalDefault)).trim().toLowerCase();
  if (!allowed.includes(provider)) throw new Error(`Unsupported ${envName} "${provider}". Use ${allowed.join(", ")}.`);
  return provider;
}

export function resolveImageEditProvider(value) {
  return resolveProvider(value, "ASSET_IMAGE_EDIT_PROVIDER", "nano-banana", ["tripo", "nano-banana", "gpt-image-2"]);
}

export function resolve3DProvider(value) {
  return resolveProvider(value, "ASSET_3D_PROVIDER", "hunyuan", ["tripo", "hunyuan", "meshy"]);
}

export function resolveWorldProvider(value) {
  return resolveProvider(value, "ASSET_WORLD_PROVIDER", "world-labs", ["tripo", "world-labs"]);
}

export function resolveResourceProvider(value) {
  const stack = resolveGenerationStack();
  const provider = value || (stack === "tripo" ? "tripo" : "fal");
  if (!["tripo", "fal"].includes(provider)) throw new Error("Resource provider must be tripo or fal.");
  return provider;
}

export function generationConfig() {
  const stack = resolveGenerationStack();
  const images = resolveImageEditProvider();
  const models = resolve3DProvider();
  const worlds = resolveWorldProvider();
  const resources = resolveResourceProvider();
  const requiredKeys = new Set();
  if ([images, models, worlds, resources].includes("tripo")) requiredKeys.add("TRIPO_API_KEY");
  if (images !== "tripo" || models !== "tripo" || resources === "fal") requiredKeys.add("FAL_KEY");
  if (worlds === "world-labs") requiredKeys.add("WORLD_LABS_API_KEY");
  const configured = (name) => {
    const value = process.env[name]?.trim();
    return Boolean(value && !/^(your_.*_key_here|changeme|todo)$/i.test(value));
  };
  return { stack, images, models, worlds, resources, required_keys: [...requiredKeys], missing_keys: [...requiredKeys].filter((key) => !configured(key)), sound_enabled: configured("FAL_KEY") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadDotEnv().then(() => {
    const config = generationConfig();
    if (!process.argv.includes("--check")) return console.log(JSON.stringify(config, null, 2));
    console.log(`Generation stack: ${config.stack}. Images: ${config.images}; models: ${config.models}; worlds: ${config.worlds}; resources: ${config.resources}.`);
    const keyUrls = { TRIPO_API_KEY: "https://developers.tripo3d.ai/", FAL_KEY: "https://fal.ai/dashboard/keys", WORLD_LABS_API_KEY: "https://platform.worldlabs.ai/api-keys" };
    for (const key of config.missing_keys) console.log(`${key} is missing in .env. Add it locally. Create an API key at ${keyUrls[key]}`);
    if (!config.sound_enabled) console.log("Optional sound generation is disabled; add FAL_KEY to enable it.");
  }).catch((error) => { console.error(error.message); process.exit(1); });
}
