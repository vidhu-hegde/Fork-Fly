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
  try {
    const result = await handleSearchRequest(req.body || {});
    return res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: error.message || "Something went wrong while building the guide.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Fork & Fly running at http://localhost:${PORT}`);
});
