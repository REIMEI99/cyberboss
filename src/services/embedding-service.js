const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
const DEFAULT_EMBEDDING_BATCH_SIZE = 10;

class EmbeddingService {
  constructor({ config }) {
    this.apiBaseUrl = normalizeText(config?.embeddingApiBaseUrl);
    this.apiKey = normalizeText(config?.embeddingApiKey);
    this.model = normalizeText(config?.embeddingModel) || "text-embedding-3-small";
    this.timeoutMs = Number(config?.embeddingTimeoutMs) || DEFAULT_EMBEDDING_TIMEOUT_MS;
    this.batchSize = Math.max(1, Number(config?.embeddingBatchSize) || DEFAULT_EMBEDDING_BATCH_SIZE);
  }

  isConfigured() {
    return Boolean(this.apiBaseUrl) && Boolean(this.apiKey);
  }

  async embed(texts) {
    const input = Array.isArray(texts) ? texts.map(normalizeText).filter(Boolean) : [];
    if (!input.length || !this.isConfigured()) {
      return [];
    }
    const results = [];
    for (let offset = 0; offset < input.length; offset += this.batchSize) {
      const batch = input.slice(offset, offset + this.batchSize);
      try {
        const response = await postJsonWithTimeout({
          url: joinUrl(this.apiBaseUrl, "embeddings"),
          apiKey: this.apiKey,
          timeoutMs: this.timeoutMs,
          body: { model: this.model, input: batch },
        });
        results.push(...extractEmbeddings(response));
      } catch (error) {
        this.lastError = error?.message || String(error);
        return [];
      }
    }
    this.lastError = "";
    return results;
  }
}

async function postJsonWithTimeout({ url, apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_EMBEDDING_TIMEOUT_MS));
  try {
    const headers = { "content-type": "application/json" };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }
    if (!response.ok) {
      throw new Error(`embedding API request failed (${response.status})`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmbeddings(response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  return data
    .filter((entry) => Array.isArray(entry?.embedding))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((entry) => entry.embedding);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom > 0 ? dot / denom : 0;
}

function rankByEmbedding(items, queryEmbedding, { limit = 20 } = {}) {
  const normalizedLimit = normalizeLimit(limit);
  return items
    .filter((item) => Array.isArray(item?.embedding) && item.embedding.length)
    .map((item) => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, normalizedLimit)
    .map((entry) => entry.item);
}

function joinUrl(baseUrl, suffix) {
  return `${normalizeText(baseUrl).replace(/\/+$/, "")}/${normalizeText(suffix).replace(/^\/+/, "")}`;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 100);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { EmbeddingService, cosineSimilarity, rankByEmbedding };
