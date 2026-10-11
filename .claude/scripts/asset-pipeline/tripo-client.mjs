import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  downloadRemoteFiles, inferMime, isUrl, pathExists, readJson, requireEnv, writeJson
} from "./fal-queue.mjs";
import { buildRequestSummary } from "./request-metadata.mjs";

export const TRIPO_ENDPOINTS = new Set([
  "generation/text-to-image", "generation/image-to-image",
  "generation/text-to-model", "generation/image-to-model", "generation/multiview-to-model",
  "generation/image-to-multiview", "generation/edit-multiview",
  "models/texture", "models/convert", "mesh/segment", "mesh/complete", "mesh/decimate",
  "animations/rig-check", "animations/rig", "animations/retarget"
]);

function baseUrl() {
  const value = (process.env.TRIPO_API_BASE_URL || "https://openapi.tripo3d.ai/v3").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("TRIPO_API_BASE_URL must be an HTTPS API URL without credentials or query parameters.");
  }
  return value;
}

async function api(route, options = {}) {
  const key = (await requireEnv("TRIPO_API_KEY")).trim();
  if (!key || key === "your_tripo_key_here") throw new Error("Set a real TRIPO_API_KEY in .env.");
  const response = await fetch(`${baseUrl()}/${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(60000),
    headers: { ...options.headers, Authorization: `Bearer ${key}` }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.code !== 0 || !body.data) {
    const detail = String(body?.message || body?.msg || body?.error_message || "Invalid API response").replaceAll(key, "[redacted]");
    const error = new Error(`Tripo ${route} failed (${response.status}, code ${body?.code ?? "unknown"}): ${detail}`);
    error.httpStatus = response.status;
    throw error;
  }
  return body.data;
}

async function patchMetadata(metadataPath, patch) {
  if (!metadataPath) return;
  const previous = await pathExists(metadataPath) ? await readJson(metadataPath) : {};
  await writeJson(metadataPath, { schema_version: 1, ...previous, ...patch, updated_at: new Date().toISOString() });
}

export async function toTripoInput(value) {
  if (typeof value !== "string" || !value) throw new Error("Tripo input must be a file path, public URL, file token, or task ID.");
  if (isUrl(value) || /^(file|task)_[a-zA-Z0-9_-]+$/.test(value)) return value;
  if (value.startsWith("data:")) throw new Error("Tripo requires a file upload; pass a local path instead of a data URI.");
  const bytes = await readFile(value);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Tripo input files must be between 1 byte and 20 MB.");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: inferMime(value) }), path.basename(value));
  const data = await api("files", { method: "POST", body: form });
  if (!data.file_token) throw new Error("Tripo upload did not return file_token.");
  return data.file_token;
}

export async function submitTripoTask(endpoint, input, options = {}) {
  if (!TRIPO_ENDPOINTS.has(endpoint)) throw new Error(`Unsupported Tripo endpoint: ${endpoint}`);
  const submittedAt = new Date().toISOString();
  const data = await api(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  if (!data.task_id) throw new Error("Tripo submission did not return task_id.");
  const submitted = {
    ...options.metadata, provider: "tripo", provider_slug: "tripo", endpoint,
    input, request_id: data.task_id, task_id: data.task_id, status: "submitted", submitted_at: submittedAt
  };
  await patchMetadata(options.metadataPath, submitted);
  if (options.onSubmit) await options.onSubmit(submitted);
  return submitted;
}

export async function pollTripoTask(taskId, options = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId || "")) throw new Error("Invalid Tripo task ID.");
  const interval = Number(options.pollIntervalMs ?? 5000);
  const timeout = Number(options.timeoutMs ?? 20 * 60 * 1000);
  if (!Number.isFinite(interval) || interval < 0 || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Tripo polling interval must be non-negative and timeout must be positive.");
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let task;
    try {
      task = await api(`tasks/${encodeURIComponent(taskId)}`, { signal: AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now()))) });
    } catch (error) {
      if (error.httpStatus !== 429 && !(error.httpStatus >= 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(interval, 1000), Math.max(0, deadline - Date.now()))));
      continue;
    }
    const status = task.status === "success" ? "completed" : task.status;
    const patch = {
      request_id: taskId, task_id: taskId, status, progress: task.progress,
      checked_at: new Date().toISOString(), result: task,
      ...(["failed", "cancelled", "canceled"].includes(status) ? { error: task.error_message || task.error_code || status } : {})
    };
    await patchMetadata(options.metadataPath, patch);
    if (options.onStatus) await options.onStatus(patch);
    if (task.status === "success") return task;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(`Tripo task ${taskId} ${task.status}: ${task.error_message || task.error_code || "no details"}`);
    }
    if (!["queued", "running", "pending", "processing", "waiting"].includes(task.status)) {
      throw new Error(`Unexpected Tripo task status: ${task.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`Tripo task ${taskId} timed out. Run the same command to resume it; no new task is needed.`);
}

export function tripoOutputFiles(output) {
  if (!output || typeof output !== "object") throw new Error("Tripo task has no output.");
  function convert(value, label) {
    if (typeof value === "string" && isUrl(value)) {
      const extension = path.extname(new URL(value).pathname) || (/model/i.test(label) ? ".glb" : /image|render|texture/i.test(label) ? ".png" : ".bin");
      return { url: value, content_type: inferMime(`asset${extension}`), file_name: `${label}${extension}` };
    }
    if (Array.isArray(value)) return value.map((child, index) => convert(child, `${label}-${index}`));
    if (value && typeof value === "object") {
      if (typeof value.url === "string") return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child, key)]));
    }
    return value;
  }
  return convert(output, "output");
}

export async function finishTripoRequest(request, outputDir, prefix = "tripo", options = {}) {
  const record = request.data || request;
  if (record.provider !== "tripo") {
    throw new Error("This request was created by a legacy provider. Pass --regenerate (and --regenerate-reference for objects) to generate with Tripo.");
  }
  const metadataPath = options.metadataPath || request.path;
  const task = await pollTripoTask(record.request_id, { ...options, metadataPath });
  const downloaded = await downloadRemoteFiles(tripoOutputFiles(task.output), outputDir, prefix);
  if (!downloaded.length) throw new Error(`Tripo task ${record.request_id} returned no downloadable assets.`);
  const summary = buildRequestSummary({
    kind: record.kind, provider: "tripo", endpoint: record.endpoint,
    metadata: { ...record, provider_slug: "tripo" },
    requestId: record.request_id, submittedAt: record.submitted_at,
    prompt: record.prompt || record.input?.prompt, inputFiles: record.input_files || [],
    outputFiles: downloaded.map((file) => file.path), downloadedFiles: downloaded, result: task,
    extra: { task_id: record.request_id }
  });
  if (metadataPath) await writeJson(metadataPath, summary);
  return summary;
}

export async function requestNeedsResume(request) {
  if (!request?.data?.request_id) return false;
  const record = request.data;
  if (["failed", "cancelled", "canceled"].includes(record.status)) return false;
  if (record.status !== "completed" || !record.output_files?.length) return true;
  const exists = await Promise.all(record.output_files.map(pathExists));
  return exists.some((value) => !value);
}

export async function runTripoTask(endpoint, input, options = {}) {
  const submitted = await submitTripoTask(endpoint, input, options);
  return finishTripoRequest(submitted, options.outputDir, "tripo", options);
}
