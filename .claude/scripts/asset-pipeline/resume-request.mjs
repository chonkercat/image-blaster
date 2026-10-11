import { finishTripoRequest, requestNeedsResume } from "./tripo-client.mjs";
import { downloadRemoteFiles, getFalQueueResult, pollFalQueue, writeJson } from "./fal-queue.mjs";
import { buildRequestSummary } from "./request-metadata.mjs";

export { requestNeedsResume };

// Resume with the saved provider, regardless of today's stack selection.
export async function finishAssetRequest(request, outputDir, prefix, options = {}) {
  const record = request.data || request;
  if (record.provider === "tripo" || record.provider_slug === "tripo") {
    return finishTripoRequest(request, outputDir, prefix, options);
  }
  if (!/^(fal-ai|openai)\//.test(record.endpoint || "") && record.service !== "fal") {
    throw new Error(`Cannot resume unknown asset provider: ${record.provider || record.endpoint}`);
  }
  let result = record.result;
  if (String(record.status).toLowerCase() !== "completed" || !result) {
    await pollFalQueue(record.endpoint, record.request_id, {
      ...options, statusUrl: record.status_url, metadataPath: request.path
    });
    result = (await getFalQueueResult(record.endpoint, record.request_id, {
      responseUrl: record.response_url, metadataPath: request.path
    })).data;
  }
  const downloaded = await downloadRemoteFiles(result, outputDir, prefix);
  const summary = buildRequestSummary({
    kind: record.kind, provider: record.provider || record.endpoint, endpoint: record.endpoint,
    metadata: { ...record, service: "fal" }, requestId: record.request_id, submittedAt: record.submitted_at,
    prompt: record.prompt, inputFiles: record.input_files || [],
    outputFiles: downloaded.map((file) => file.path), downloadedFiles: downloaded, result
  });
  if (request.path) await writeJson(request.path, summary);
  return summary;
}
