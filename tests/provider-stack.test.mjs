import { test, beforeEach, afterEach } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generationConfig, resolveGenerationStack, resolveImageEditProvider, resolve3DProvider, resolveWorldProvider } from "../.claude/scripts/asset-pipeline/provider-config.mjs";
import { runImageEdit } from "../.claude/scripts/asset-pipeline/image-edit.mjs";
import { generateEdit } from "../.claude/scripts/image-edit/generate-edit.mjs";
import { generateSingleObject } from "../.claude/scripts/asset-pipeline/generate-single-asset.mjs";
import { generateWorld } from "../.claude/scripts/world/generate-world.mjs";
import { runResource } from "../.claude/scripts/asset-pipeline/run-resource.mjs";
import { pollFalQueue } from "../.claude/scripts/asset-pipeline/fal-queue.mjs";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
let dir, calls, failDownloads;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const worldAssets = {
  world_id: "world_fixture", assets: { mesh: { collider_mesh_url: "https://cdn.example/room.glb" },
    imagery: { pano_url: "https://cdn.example/pano.png" }, thumbnail_url: "https://cdn.example/thumb.webp",
    splats: { spz_urls: { full_res: "https://cdn.example/room.spz" }, semantics_metadata: { metric_scale_factor: 1 } } }
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "image-blaster-stack-"));
  process.chdir(dir);
  process.env.ASSET_GENERATION_STACK = "original";
  process.env.FAL_KEY = "fixture-fal-secret";
  process.env.WORLD_LABS_API_KEY = "fixture-world-secret";
  delete process.env.ASSET_IMAGE_EDIT_PROVIDER;
  delete process.env.ASSET_3D_PROVIDER;
  delete process.env.ASSET_WORLD_PROVIDER;
  delete process.env.WORLD_LABS_MODEL;
  delete process.env.TRIPO_API_KEY;
  calls = [];
  failDownloads = false;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(dir, { recursive: true, force: true });
});

function fakeProviders({ worldIdOnly = false, worldError = false } = {}) {
  const tasks = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.startsWith("https://cdn.example/")) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.["WLT-Api-Key"], undefined);
      return failDownloads ? new Response("unavailable", { status: 503 }) : new Response("fixture-asset");
    }
    if (value.startsWith("https://queue.fal.run/")) {
      assert.equal(options.headers.Authorization, "Key fixture-fal-secret");
      if (options.method === "POST") {
        const id = `fal-${tasks.size + 1}`;
        tasks.set(id, { endpoint: value, input: JSON.parse(options.body) });
        return json({ request_id: id, status_url: `https://queue.fal.run/test/requests/${id}/status`, response_url: `https://queue.fal.run/test/requests/${id}` });
      }
      const match = value.match(/requests\/(fal-\d+)/);
      assert(match);
      if (value.includes("/status")) return json({ status: "COMPLETED" });
      const task = tasks.get(match[1]);
      assert(task);
      return json(task.endpoint.includes("3d")
        ? { model_glb: { url: "https://cdn.example/object.glb", content_type: "model/gltf-binary" }, thumbnail: { url: "https://cdn.example/model.png", content_type: "image/png" } }
        : { images: [{ url: "https://cdn.example/image.png", content_type: "image/png" }] });
    }
    assert(value.startsWith("https://api.worldlabs.ai/marble/v1/"), `Unexpected API: ${value}`);
    assert.equal(options.headers["WLT-Api-Key"], "fixture-world-secret");
    if (options.method === "POST") return json({ operation_id: "op_fixture", done: false });
    if (value.includes("/operations/")) return json({ operation_id: "op_fixture", done: true, error: worldError ? { message: "Bad input" } : null,
      response: worldIdOnly ? { world_id: worldAssets.world_id } : worldAssets });
    assert(value.endsWith(`/worlds/${worldAssets.world_id}`));
    return json(worldAssets);
  };
}

const posts = () => calls.filter((call) => call.options.method === "POST");
async function image() { const file = path.join(dir, "source.png"); await writeFile(file, "fixture-source"); return file; }

test("master switch selects original defaults, Tripo defaults, and explicit overrides", () => {
  assert.deepEqual([resolveImageEditProvider(), resolve3DProvider(), resolveWorldProvider()], ["nano-banana", "hunyuan", "world-labs"]);
  assert.deepEqual(generationConfig().required_keys.sort(), ["FAL_KEY", "WORLD_LABS_API_KEY"]);
  assert.equal(resolve3DProvider("tripo"), "tripo");
  process.env.ASSET_IMAGE_EDIT_PROVIDER = "gpt-image-2";
  assert.equal(resolveImageEditProvider(), "gpt-image-2");
  assert.equal(resolveImageEditProvider("nano-banana"), "nano-banana");
  delete process.env.ASSET_IMAGE_EDIT_PROVIDER;
  delete process.env.ASSET_GENERATION_STACK;
  assert.equal(resolveGenerationStack(), "tripo");
  assert.deepEqual([resolveImageEditProvider(), resolve3DProvider(), resolveWorldProvider()], ["tripo", "tripo", "tripo"]);
  process.env.ASSET_GENERATION_STACK = "typo";
  assert.throws(() => resolve3DProvider(), /tripo or original/);
});

test("configuration reports missing names and never exposes keys", () => {
  assert.deepEqual(generationConfig().missing_keys, []);
  delete process.env.WORLD_LABS_API_KEY;
  process.env.FAL_KEY = "your_fal_key_here";
  const config = generationConfig();
  assert.deepEqual(config.missing_keys.sort(), ["FAL_KEY", "WORLD_LABS_API_KEY"]);
  assert(!JSON.stringify(config).includes("your_fal_key_here"));
});

test("original stack generates and edits images through FAL with local inputs", async () => {
  fakeProviders();
  await runImageEdit({ prompt: "A chair", outputDir: dir });
  const result = await runImageEdit({ prompt: "Isolate", images: [await image()], outputDir: dir });
  assert(posts()[0].url.endsWith("fal-ai/nano-banana-2"));
  assert(posts()[1].url.endsWith("fal-ai/nano-banana-2/edit"));
  const input = JSON.parse(posts()[1].options.body);
  assert(input.image_urls[0].startsWith("data:image/png;base64,"));
  assert.equal(input.resolution, "1K");
  assert.equal(result.provider_alias, "nano-banana");
  const metadata = await readFile(path.join(dir, ".0-image-edit-request.json"), "utf8");
  assert(!metadata.includes("fixture-fal-secret"));
  assert(!metadata.includes("data:image/png;base64,"));
});

test("FAL GPT Image override supports masks and text-only requests", async () => {
  fakeProviders();
  await runImageEdit({ provider: "gpt-image-2", prompt: "Edit", images: [await image()], maskImage: await image(), outputDir: dir });
  assert(posts()[0].url.endsWith("openai/gpt-image-2/edit"));
  assert(JSON.parse(posts()[0].options.body).mask_image_url.startsWith("data:"));
  await runImageEdit({ provider: "gpt-image-2", prompt: "Generate", outputDir: dir });
  assert(posts()[1].url.endsWith("openai/gpt-image-2"));
});

test("original object workflow uses Nano Banana and Hunyuan, then preserves completed assets across switching", async () => {
  fakeProviders();
  const options = { world: "example", directImage: await image(), objectName: "chair", imageEditPrompt: "Isolate the chair" };
  const result = await generateSingleObject(options);
  assert.equal(result.model_provider, "hunyuan");
  assert(result.model_files.includes("worlds/example/output/chair/0-chair.glb"));
  assert(posts()[1].url.endsWith("fal-ai/hunyuan3d-v3/image-to-3d"));
  assert.equal(JSON.parse(posts()[1].options.body).face_count, 50000);
  process.env.ASSET_GENERATION_STACK = "tripo";
  assert.equal((await generateSingleObject(options)).skipped, true);
  assert.equal(posts().length, 2);
});

test("Meshy override routes the model request to FAL", async () => {
  fakeProviders();
  const result = await generateSingleObject({ world: "example", directImage: await image(), objectName: "chair", imageEditPrompt: "Isolate", modelProvider: "meshy", targetPolycount: 20000 });
  assert.equal(result.model_provider, "meshy");
  assert(posts()[1].url.endsWith("fal-ai/meshy/v6/image-to-3d"));
  assert.equal(JSON.parse(posts()[1].options.body).target_polycount, 20000);
});

test("image edit repairs downloads through saved FAL provider after switching to Tripo", async () => {
  fakeProviders();
  const options = { images: [await image()], prompt: "Clean plate", outputDir: dir, outputSlug: "plate" };
  failDownloads = true;
  await assert.rejects(generateEdit(options), /Download failed/);
  failDownloads = false;
  process.env.ASSET_GENERATION_STACK = "tripo";
  const result = await generateEdit(options);
  assert.equal(result.output_image, path.join(dir, "0-plate.png"));
  await access(result.output_image);
  assert.equal(posts().length, 1);
});

test("World Labs downloads splat assets and repairs them with the original provider after switching", async () => {
  fakeProviders();
  await mkdir("worlds/example/source", { recursive: true });
  await writeFile("worlds/example/source/0-room.png", "fixture-source");
  const options = { world: "example", prompt: "An empty timber room", pollIntervalMs: 0 };
  const first = await generateWorld(options);
  assert.equal(first.environment_type, "splat");
  await Promise.all([first.glb, first.pano, first.thumbnail, first.spz.full_res, first.plate].map((file) => access(file)));
  const input = JSON.parse(posts()[0].options.body);
  assert.equal(input.model, "marble-1.1");
  assert.equal(input.world_prompt.type, "image");
  assert.equal(input.world_prompt.text_prompt, options.prompt);
  const metadata = await readFile(first.request_metadata, "utf8");
  assert(!metadata.includes("fixture-world-secret"));
  assert(!metadata.includes(Buffer.from("fixture-source").toString("base64")));
  assert.equal((await generateWorld(options)).skipped, true);
  await rm(first.spz.full_res);
  process.env.ASSET_GENERATION_STACK = "tripo";
  const repaired = await generateWorld(options);
  await access(repaired.spz.full_res);
  assert.equal(repaired.index, first.index);
  assert.equal(posts().length, 1);
});

test("World Labs handles operation responses containing only world_id and fresh generations preserve previous files", async () => {
  fakeProviders({ worldIdOnly: true });
  process.env.WORLD_LABS_MODEL = "marble-1.1-plus";
  const options = { world: "example", prompt: "A courtyard", pollIntervalMs: 0 };
  const first = await generateWorld(options);
  const second = await generateWorld({ ...options, regenerate: true });
  assert.equal(second.index, first.index + 1);
  await Promise.all([first.world_json, second.world_json].map((file) => access(file)));
  assert.equal(JSON.parse(posts()[0].options.body).model, "marble-1.1-plus");
  assert.equal(calls.filter((call) => call.url.endsWith("/worlds/world_fixture")).length, 2);
});

test("resource helper routes FAL requests and resumes the saved endpoint after switching", async () => {
  fakeProviders();
  const options = { endpoint: "fal-ai/nano-banana-2/edit", input: { prompt: "Clean up" }, files: [`image_urls.0=${await image()}`], outputDir: dir, outputSlug: "resource" };
  failDownloads = true;
  await assert.rejects(runResource(options), /Download failed/);
  failDownloads = false;
  process.env.ASSET_GENERATION_STACK = "tripo";
  const result = await runResource({ ...options, endpoint: "generation/image-to-image" });
  await access(result.output_files[0]);
  assert.equal(result.service, "fal");
  assert.equal(posts().length, 1);
  await assert.rejects(runResource({ endpoint: "fal-ai/nano-banana-2", input: {}, outputDir: dir, outputSlug: "new" }), /supported Tripo/);
});

test("missing FAL credentials and World Labs failures stop without a Tripo fallback", async () => {
  fakeProviders();
  delete process.env.FAL_KEY;
  await assert.rejects(runImageEdit({ prompt: "A chair", outputDir: dir }), /FAL_KEY/);
  assert.equal(calls.length, 0);
  fakeProviders({ worldError: true });
  await assert.rejects(generateWorld({ world: "example", prompt: "Room", pollIntervalMs: 0 }), /World Labs generation failed/);
  const metadata = JSON.parse(await readFile("worlds/example/output/world/.0-world-request.json", "utf8"));
  assert.equal(metadata.status, "failed");
});

test("FAL terminal failures stop polling and timeouts remain resumable", async () => {
  globalThis.fetch = async () => json({ status: "FAILED" });
  await assert.rejects(pollFalQueue("fal-ai/test", "fixture", { pollIntervalMs: 0 }), /failed/);
  globalThis.fetch = async () => json({ status: "IN_PROGRESS" });
  await assert.rejects(pollFalQueue("fal-ai/test", "fixture", { pollIntervalMs: 0, timeoutMs: 0 }), /resume/);
});


test("fresh CLI loads the master switch and keys from .env without exposing secrets", async () => {
  await writeFile(".env", "ASSET_GENERATION_STACK=original\nFAL_KEY=local-fixture-fal\nWORLD_LABS_API_KEY=local-fixture-world\n");
  const env = { ...process.env };
  for (const name of ["ASSET_GENERATION_STACK", "FAL_KEY", "WORLD_LABS_API_KEY"]) delete env[name];
  const script = fileURLToPath(new URL("../.claude/scripts/asset-pipeline/provider-config.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [script], { cwd: dir, env });
  const config = JSON.parse(stdout);
  assert.equal(config.stack, "original");
  assert.equal(config.worlds, "world-labs");
  assert.deepEqual(config.missing_keys, []);
  assert(!stdout.includes("local-fixture"));
});

test("pending FAL and World Labs jobs resume after a stack switch without another submission", async () => {
  fakeProviders();
  const fake = globalThis.fetch;
  let interrupt = true;
  globalThis.fetch = async (url, options) => {
    if (interrupt && (String(url).includes("/status") || String(url).includes("/operations/"))) return json({}, 503);
    return fake(url, options);
  };
  const edit = { images: [await image()], prompt: "Edit", outputDir: dir, outputSlug: "plate" };
  const world = { world: "example", prompt: "Empty room", pollIntervalMs: 0 };
  await assert.rejects(generateEdit(edit), /FAL status failed/);
  await assert.rejects(generateWorld(world), /World Labs poll failed/);
  interrupt = false;
  process.env.ASSET_GENERATION_STACK = "tripo";
  await access((await generateEdit(edit)).output_image);
  await access((await generateWorld(world)).world_json);
  assert.equal(posts().length, 2);
});
