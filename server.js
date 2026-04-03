const crypto = require("crypto");
const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const { handleSearchRequest } = require("./lib/fork-and-fly");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/search", async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  try {
    console.log(`[fork-and-fly:${requestId}] /api/search received`, {
      destination:
        typeof req.body?.destination === "string" ? req.body.destination : null,
      platformCount: Array.isArray(req.body?.platforms)
        ? req.body.platforms.length
        : 0,
      focusCount: Array.isArray(req.body?.focus) ? req.body.focus.length : 0,
      recency: req.body?.recency || null,
    });

    const result = await handleSearchRequest(req.body || {}, {
      requestId,
      logger: console,
    });

    console.log(`[fork-and-fly:${requestId}] /api/search success`, {
      durationMs: Date.now() - startedAt,
      videoCount: result.videos.length,
      hasGuide: Boolean(result.guide),
    });

    return res.json({ ...result, requestId });
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
});

app.listen(PORT, () => {
  console.log(`Fork & Fly running at http://localhost:${PORT}`);
});
