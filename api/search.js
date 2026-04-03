const crypto = require("crypto");
const dotenv = require("dotenv");
const { handleSearchRequest } = require("../lib/fork-and-fly");

dotenv.config();

module.exports = async function handler(req, res) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  if (req.method !== "POST") {
    console.warn(`[fork-and-fly:${requestId}] method not allowed`, {
      method: req.method,
      url: req.url,
    });
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ error: "Method not allowed.", requestId });
  }

  try {
    const body = await readJsonBody(req);

    console.log(`[fork-and-fly:${requestId}] /api/search received`, {
      destination: typeof body.destination === "string" ? body.destination : null,
      platformCount: Array.isArray(body.platforms) ? body.platforms.length : 0,
      focusCount: Array.isArray(body.focus) ? body.focus.length : 0,
      recency: body.recency || null,
    });

    const result = await handleSearchRequest(body, {
      requestId,
      logger: console,
    });

    console.log(`[fork-and-fly:${requestId}] /api/search success`, {
      durationMs: Date.now() - startedAt,
      videoCount: result.videos.length,
      hasGuide: Boolean(result.guide),
    });

    return res.status(200).json({ ...result, requestId });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(`[fork-and-fly:${requestId}] /api/search failed`, {
      status,
      durationMs: Date.now() - startedAt,
      error: error.message || "Unknown error",
      stack: error.stack,
    });

    return res.status(status).json({
      error: error.message || "Something went wrong while building the guide.",
      requestId,
    });
  }
};

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
