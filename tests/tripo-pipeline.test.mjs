import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pollTripoTask, runTripoTask, toTripoInput, finishTripoRequest } from "../.claude/scripts/asset-pipeline/tripo-client.mjs";
import { runImageEdit } from "../.claude/scripts/asset-pipeline/image-edit.mjs";
import { runTripo3D } from "../.claude/scripts/asset-pipeline/tripo-3d.mjs";
import { generateEdit } from "../.claude/scripts/image-edit/generate-edit.mjs";
import { generateSingleObject } from "../.claude/scripts/asset-pipeline/generate-single-asset.mjs";
import { generateWorld } from "../.claude/scripts/world/generate-world.mjs";
import { runTripoResource, setInputFile } from "../.claude/scripts/tripo/run-tripo.mjs";

const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();
const originalEnv = { ...process.env };
let dir;
let calls;
const json = (data, code = 0, status = 200) => new Response(JSON.stringify({ code, data }), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "image-blaster-tripo-"));
  process.chdir(dir);
  process.env.TRIPO_API_KEY = "test-tripo-secret";
  delete process.env.TRIPO_API_BASE_URL;
  delete process.env.TRIPO_IMAGE_MODEL;
  delete process.env.TRIPO_MODEL_VERSION;
  delete process.env.ASSET_IMAGE_EDIT_PROVIDER;
  delete process.env.FAL_KEY;
  delete process.env.WORLD_LABS_API_KEY;
  calls = [];
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(dir, { recursive: true, force: true });
});

function fakeTripo() {
  const tasks = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.startsWith("https://cdn.example.com/")) {
      assert.equal(options.headers?.Authorization, undefined, "Downloads must never receive API credentials");
      return new Response(Buffer.from("fixture-output"));
    }
    assert(value.startsWith("https://openapi.tripo3d.ai/v3/"), `Unexpected provider: ${value}`);
    assert.equal(options.headers.Authorization, "Bearer test-tripo-secret");
    if (value.endsWith("/files")) {
      assert(options.body instanceof FormData);
      assert(options.body.get("file") instanceof Blob);
      assert.equal(options.headers["Content-Type"], undefined, "Let fetch supply multipart boundary");
      return json({ file_token: "file_fixture" });
    }
    if (options.method === "POST") {
      const input = JSON.parse(options.body);
      const id = `task_${tasks.size + 1}`;
      tasks.set(id, { type: /to-image$/.test(value) ? "image" : "model", input });
      return json({ task_id: id });
    }
    const id = value.split("/").at(-1);
    const task = tasks.get(id);
    assert(task, `Unknown task ${id}`);
    return json({ task_id: id, status: "success", progress: 100, output: task.type === "image"
      ? { generated_image_url: "https://cdn.example.com/generated.png" }
      : { model_url: "https://cdn.example.com/model.glb?signature=example", rendered_image_url: "https://cdn.example.com/preview.png" } });
  };
}

async function inputImage() {
  const image = path.join(dir, "source.png");
  await writeFile(image, Buffer.from("fixture-source"));
  return image;
}

function posts() { return calls.filter((call) => call.options.method === "POST" && !call.url.endsWith("/files")); }

test("uploads local images and passes public URLs/task IDs directly", async () => {
  fakeTripo();
  assert.equal(await toTripoInput(await inputImage()), "file_fixture");
  assert.equal(await toTripoInput("https://example.com/image.png"), "https://example.com/image.png");
  assert.equal(await toTripoInput("task_fixture"), "task_fixture");
  assert.equal(calls.length, 1);
  await assert.rejects(toTripoInput("data:image/png;base64,eA=="), /local path/);
});

test("edits through Tripo and persists metadata without credentials", async () => {
  fakeTripo();
  const summary = await runImageEdit({ images: [await inputImage()], prompt: "Isolate a chair", outputDir: dir });
  const submit = posts()[0];
  assert(submit.url.endsWith("/generation/image-to-image"));
  assert.deepEqual(JSON.parse(submit.options.body), { model: "seedream_v5", prompt: "Isolate a chair", output_format: "png", size: "2K", input: "file_fixture" });
  assert.equal(summary.provider, "tripo");
  await access(summary.output_files[0]);
  const metadata = await readFile(path.join(dir, ".0-image-edit-request.json"), "utf8");
  assert(!metadata.includes("test-tripo-secret"));
  assert.equal(JSON.parse(metadata).status, "completed");
});

test("text images and multiple references use the documented Tripo request shapes", async () => {
  fakeTripo();
  await runImageEdit({ prompt: "A stone arch", outputDir: dir });
  assert(posts()[0].url.endsWith("/generation/text-to-image"));
  await runImageEdit({ images: ["https://example.com/a.png", "https://example.com/b.png"], prompt: "Combine", outputDir: dir });
  const input = JSON.parse(posts()[1].options.body);
  assert.deepEqual(input.inputs, ["https://example.com/a.png", "https://example.com/b.png"]);
  assert.equal(input.input, undefined);
});

test("generates low-poly geometry and validates before submitting", async () => {
  fakeTripo();
  await runTripo3D({ prompt: "A low-poly chest", outputDir: dir, lowPoly: true, texture: false });
  const input = JSON.parse(posts()[0].options.body);
  assert.equal(input.face_limit, 5000);
  assert.equal(input.smart_low_poly, true);
  assert.equal(input.texture, false);
  assert.equal(input.pbr, false);
  const count = posts().length;
  await assert.rejects(runTripo3D({ prompt: "Chest", outputDir: dir, faceCount: "invalid" }), /face-count/);
  await assert.rejects(runTripo3D({ prompt: "Chest", outputDir: dir, lowPoly: true, faceCount: 50000 }), /face-count/);
  assert.equal(posts().length, count);
});

test("rejects legacy providers and unsupported image options without a request", async () => {
  fakeTripo();
  await assert.rejects(runImageEdit({ provider: "gpt-image-2", prompt: "Edit", images: ["https://example.com/a.png"], outputDir: dir }), /Tripo only/);
  await assert.rejects(runImageEdit({ prompt: "Edit", outputDir: dir, maskImage: "mask.png" }), /mask\/seed/);
  await assert.rejects(runImageEdit({ prompt: "Edit", outputDir: dir, quality: "medium" }), /only supported/);
  assert.equal(calls.length, 0);
});

test("polls progress, saves terminal failures, and stops", async () => {
  let checks = 0;
  const metadataPath = path.join(dir, ".0-failed-request.json");
  globalThis.fetch = async () => json(++checks === 1
    ? { status: "running", progress: 50 }
    : { status: "failed", error_code: 1004, error_message: "Invalid input" });
  await assert.rejects(pollTripoTask("task_failed", { metadataPath, pollIntervalMs: 0 }), /Invalid input/);
  assert.equal(checks, 2);
  const saved = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "Invalid input");
});

test("timeout keeps the task resumable rather than submitting another job", async () => {
  const metadataPath = path.join(dir, ".0-timeout-request.json");
  globalThis.fetch = async () => json({ status: "running", progress: 10 });
  await assert.rejects(pollTripoTask("task_timeout", { metadataPath, pollIntervalMs: 1, timeoutMs: 15 }), /resume/);
  const saved = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(saved.request_id, "task_timeout");
  assert.equal(saved.status, "running");
});

test("API business errors and authentication errors stop before polling", async () => {
  globalThis.fetch = async () => json({}, 1004);
  await assert.rejects(runTripoTask("generation/text-to-image", { prompt: "A cat" }, { outputDir: dir }), /code 1004/);
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
  await assert.rejects(toTripoInput(await inputImage()), /401/);
});

test("complete image-to-object pipeline uses only Tripo and reuses indexed output", async () => {
  fakeTripo();
  const options = { world: "example", directImage: await inputImage(), objectName: "chair", imageEditPrompt: "Isolate the chair" };
  const result = await generateSingleObject(options);
  assert.equal(result.reference_image, "worlds/example/output/chair/0-chair.png");
  assert(result.model_files.includes("worlds/example/output/chair/0-chair.glb"));
  assert.equal(posts().length, 2);
  const repeated = await generateSingleObject(options);
  assert.equal(repeated.skipped, true);
  assert.equal(posts().length, 2);
});

test("image edits resume after download failure without a duplicate paid task", async () => {
  fakeTripo();
  const fake = globalThis.fetch;
  let fail = true;
  globalThis.fetch = (url, options) => String(url).startsWith("https://cdn.example.com/") && fail
    ? Promise.resolve(new Response("download unavailable", { status: 503 })) : fake(url, options);
  const options = { images: [await inputImage()], prompt: "Clean plate", outputDir: dir, outputSlug: "plate" };
  await assert.rejects(generateEdit(options), /Download failed/);
  fail = false;
  const result = await generateEdit(options);
  assert.equal(result.output_image, path.join(dir, "0-plate.png"));
  assert.equal(posts().length, 1);
});

test("environment generation writes a local textured mesh contract and reuses it", async () => {
  fakeTripo();
  const image = await inputImage();
  await mkdir("worlds/example/source", { recursive: true });
  await writeFile("worlds/example/source/0-room.png", await readFile(image));
  const result = await generateWorld({ world: "example", prompt: "An empty room" });
  const manifest = JSON.parse(await readFile(result.world_json, "utf8"));
  assert.equal(manifest.provider, "tripo");
  assert.equal(manifest.environment_type, "mesh");
  assert.equal(manifest.assets.mesh.render_materials, true);
  assert.equal(manifest.assets.splats.semantics_metadata.flip_y, false);
  assert.deepEqual(manifest.assets.splats.spz_urls, {});
  await access(result.glb);
  await access(result.thumbnail);
  await access(result.plate);
  assert.equal(JSON.parse(posts()[0].options.body).auto_size, true);
  assert.equal((await generateWorld({ world: "example" })).skipped, true);
  assert.equal(posts().length, 1);
});

test("resource runner uploads nested inputs and rejects unsafe or unsupported routes", async () => {
  fakeTripo();
  const result = await runTripoResource({ endpoint: "generation/image-to-image", input: { prompt: "Edit", model: "seedream_v5" }, files: [`inputs.0=${await inputImage()}`], outputDir: dir, outputSlug: "resource" });
  assert.deepEqual(JSON.parse(posts()[0].options.body).inputs, ["file_fixture"]);
  assert.equal(result.output_files[0], path.join(dir, "0-resource.png"));
  assert.throws(() => setInputFile({}, "__proto__.polluted", "x"), /Invalid/);
  await assert.rejects(runTripoResource({ endpoint: "https://fal.run/model", outputDir: dir }), /supported Tripo/);
});

test("legacy pending requests cannot fall back to FAL or World Labs", async () => {
  fakeTripo();
  await assert.rejects(finishTripoRequest({ data: { provider: "world-labs", request_id: "legacy" } }, dir), /legacy provider/);
  assert.equal(calls.length, 0);
});

test("generic resources resume an interrupted download without creating another task", async () => {
  fakeTripo();
  const fake = globalThis.fetch;
  let fail = true;
  globalThis.fetch = (url, options) => String(url).startsWith("https://cdn.example.com/") && fail
    ? Promise.resolve(new Response("unavailable", { status: 503 })) : fake(url, options);
  const options = { endpoint: "generation/text-to-image", input: { prompt: "A chest", model: "seedream_v5" }, outputDir: dir };
  await assert.rejects(runTripoResource(options), /Download failed/);
  fail = false;
  const result = await runTripoResource(options);
  await access(result.output_files[0]);
  assert.equal(posts().length, 1);
});

test("environment generation repairs missing local outputs without paying again", async () => {
  fakeTripo();
  const options = { world: "example", prompt: "A stone courtyard" };
  const first = await generateWorld(options);
  await rm(first.glb);
  const repaired = await generateWorld(options);
  assert.equal(repaired.index, first.index);
  await access(repaired.glb);
  assert.equal(posts().length, 1);
});
