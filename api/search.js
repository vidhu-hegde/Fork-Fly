const dotenv = require("dotenv");
const { handleSearchRequest } = require("../lib/fork-and-fly");

dotenv.config();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = await readJsonBody(req);
    const result = await handleSearchRequest(body);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: error.message || "Something went wrong while building the guide.",
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
