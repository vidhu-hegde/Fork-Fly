const MEMORIES_ENDPOINT =
  "https://api.memories.ai/serve/api/v1/search_public";
const MEMORIES_DETAIL_ENDPOINT =
  "https://api.memories.ai/serve/api/v1/get_public_video_detail";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

async function handleSearchRequest(input, options = {}) {
  const logger = createRequestLogger(options.requestId, options.logger);
  const { destination, platforms, budget, focus, recency } = input || {};

  if (!destination || typeof destination !== "string") {
    throw withStatus("Destination is required.", 400);
  }

  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw withStatus("Select at least one platform to search.", 400);
  }

  if (!process.env.MEMORIES_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    throw withStatus(
      "Server configuration is incomplete. Add MEMORIES_API_KEY and ANTHROPIC_API_KEY to the environment.",
      500
    );
  }

  const cleanDestination = destination.trim();
  const cleanFocus = Array.isArray(focus) ? focus : [];

  logger.info("search request validated", {
    destination: cleanDestination,
    platforms,
    budget: budget || "all",
    recency: recency || "past_year",
    focusCount: cleanFocus.length,
    hasMemoriesKey: Boolean(process.env.MEMORIES_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  const memoriesResult = await searchMemories({
    destination: cleanDestination,
    platforms,
    budget,
    focus: cleanFocus,
    recency,
  }, logger);

  const guide = await buildGuideWithClaude({
    destination: cleanDestination,
    budget,
    focus: cleanFocus,
    videos: memoriesResult.videos,
    usedGeneralKnowledge: memoriesResult.videos.length === 0,
  }, logger);

  logger.info("search request completed", {
    destination: cleanDestination,
    videoCount: memoriesResult.videos.length,
    usedGeneralKnowledge: memoriesResult.videos.length === 0,
  });

  return {
    videos: memoriesResult.videos,
    guide,
    logs: memoriesResult.logs,
    note:
      memoriesResult.videos.length === 0
        ? "No matching source videos were returned, so the guide was built from general knowledge."
        : null,
  };
}

async function searchMemories(
  { destination, platforms, budget, focus, recency },
  logger
) {
  const logs = ["Querying Memories.ai public video search..."];
  const query = buildMemoriesQuery({ destination, budget, focus, recency });
  const supportedPlatforms = platforms
    .map((platform) => ({
      original: platform,
      apiType: toMemoriesPlatformType(platform),
    }))
    .filter((platform) => platform.apiType);

  if (supportedPlatforms.length === 0) {
    logger.info("memories search skipped", {
      reason: "No supported public-search platforms selected.",
      platforms,
    });
    logs.push("No supported public-search platforms were selected.");
    return { videos: [], logs };
  }

  logger.info("memories request started", {
    endpoint: MEMORIES_ENDPOINT,
    platforms: supportedPlatforms.map((platform) => platform.apiType),
    queryLength: query.length,
    requestedTopK: 10,
  });

  const platformResults = await Promise.all(
    supportedPlatforms.map((platform) =>
      searchPublicPlatform(platform, query, logger)
    )
  );

  const candidateVideos = platformResults
    .flat()
    .sort((left, right) => (right.score || 0) - (left.score || 0))
    .slice(0, 10);

  logs.push(`Found ${candidateVideos.length} ranked Memories.ai matches.`);

  const videos = await Promise.all(
    candidateVideos.map((video) => fetchPublicVideoDetails(video, logger))
  );

  logs.push(
    videos.length
      ? `Collected ${videos.length} source videos.`
      : "No source videos were found."
  );

  logger.info("memories request completed", {
    videoCount: videos.length,
  });

  return { videos, logs };
}

async function searchPublicPlatform(platform, query, logger) {
  const payload = {
    search_param: query,
    search_type: "BY_VIDEO",
    type: platform.apiType,
    top_k: 10,
    filtering_level: "medium",
  };

  logger.info("memories platform search started", {
    platform: platform.apiType,
    payload: {
      search_type: payload.search_type,
      type: payload.type,
      top_k: payload.top_k,
      filtering_level: payload.filtering_level,
      searchParamLength: payload.search_param.length,
    },
  });

  const response = await fetch(MEMORIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MEMORIES_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await safeReadText(response);
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed || parsed.code !== "0000") {
    logger.error("memories platform search failed", {
      platform: platform.apiType,
      upstreamStatus: response.status,
      upstreamBody: truncate(rawText),
    });
    throw withStatus(
      `Memories.ai ${platform.apiType} search failed: ${
        parsed?.msg || rawText || `HTTP ${response.status}`
      }`,
      502
    );
  }

  const matches = Array.isArray(parsed.data) ? parsed.data : [];
  logger.info("memories platform search completed", {
    platform: platform.apiType,
    matchCount: matches.length,
  });

  return matches.map((item) => ({
    videoNo: firstString(item.videoNo, item.video_no),
    title: firstString(item.videoName, item.video_name, item.title),
    platform: platform.original,
    score: Number(item.score) || 0,
  }));
}

async function fetchPublicVideoDetails(video, logger) {
  if (!video.videoNo) {
    return normalizeVideo(video, 0);
  }

  const url = new URL(MEMORIES_DETAIL_ENDPOINT);
  url.searchParams.set("video_no", video.videoNo);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: process.env.MEMORIES_API_KEY,
    },
  });

  const rawText = await safeReadText(response);
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed || parsed.code !== "0000") {
    logger.error("memories detail fetch failed", {
      videoNo: video.videoNo,
      platform: video.platform,
      upstreamStatus: response.status,
      upstreamBody: truncate(rawText),
    });
    return normalizeVideo(video, 0);
  }

  return normalizeVideo(
    {
      title: video.title,
      platform: video.platform,
      ...parsed.data,
    },
    0
  );
}

async function buildGuideWithClaude({
  destination,
  budget,
  focus,
  videos,
  usedGeneralKnowledge,
}, logger) {
  const prompt = buildClaudePrompt({
    destination,
    budget,
    focus,
    videos,
    usedGeneralKnowledge,
  });

  logger.info("anthropic request started", {
    endpoint: ANTHROPIC_ENDPOINT,
    model: "claude-sonnet-4-20250514",
    destination,
    sourceVideoCount: videos.length,
    usedGeneralKnowledge,
    promptLength: prompt.length,
  });

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await safeReadText(response);
    logger.error("anthropic request failed", {
      upstreamStatus: response.status,
      upstreamBody: truncate(details),
    });
    throw withStatus(
      details || `Anthropic request failed with ${response.status}.`,
      502
    );
  }

  const result = await response.json();
  const text = Array.isArray(result.content)
    ? result.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
    : "";

  const parsed = parseClaudeJson(text, logger);
  const guide = normalizeGuide(parsed, destination);

  logger.info("anthropic request completed", {
    textLength: text.length,
    dishesCount: guide.dishes.length,
    spotsCount: guide.spots.length,
  });

  return guide;
}

function buildMemoriesQuery({ destination, budget, focus, recency }) {
  const budgetLine = formatBudget(budget);
  const focusLine =
    Array.isArray(focus) && focus.length
      ? `Focus on ${focus.join(", ")}.`
      : "Focus on iconic local food, standout creators, and real places to eat.";
  const recencyLine = `Prefer videos from ${formatRecencyPhrase(recency)}.`;

  return [
    `Best recent food vlogs and creator videos about eating in ${destination}.`,
    budgetLine,
    focusLine,
    recencyLine,
    "Prioritize practical recommendations, neighborhoods, dishes, and hidden gems.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildClaudePrompt({
  destination,
  budget,
  focus,
  videos,
  usedGeneralKnowledge,
}) {
  const numberedVideos = videos.length
    ? videos
        .map((video, index) => {
          const platform = prettyPlatform(video.platform);
          return `${index + 1}. ${video.title} (${platform})`;
        })
        .join("\n")
    : "No source videos were found. Build the guide from general food knowledge for the destination.";

  return `You are a food travel expert creating a guide for a foodie visiting ${destination}.
Budget preference: ${formatBudget(budget, true)}
Food focus: ${formatFocus(focus)}

Real food videos found:
${numberedVideos}

${usedGeneralKnowledge ? "Important: no source videos were available, so infer carefully from general knowledge." : "Use the source videos as your primary signal and synthesize them into a practical guide."}

Return ONLY valid JSON with this exact shape and no markdown:
{
  "tagline": "one evocative sentence about the food scene (max 12 words)",
  "dishes": [{ "name": "", "emoji": "", "where": "" }],
  "spots": [{ "name": "", "description": "", "tags": [] }],
  "neighborhoods": [{ "name": "", "description": "", "best_for": "" }],
  "day_plan": [{ "time": "", "spot": "", "note": "" }],
  "tips": ["", "", "", ""]
}

Requirements:
- Provide exactly 6 dishes.
- Provide exactly 5 spots.
- Provide exactly 3 neighborhoods.
- Provide exactly 6 day_plan entries from early morning to late night.
- Provide exactly 4 insider tips.
- Keep tags short, vivid, and useful.
- Do not include any text before or after the JSON object.`;
}

function extractMemoriesLog(payload) {
  const message =
    firstString(payload.message, payload.status_message, payload.detail) ||
    (typeof payload.status === "string" ? `Status: ${payload.status}` : "") ||
    (typeof payload.type === "string" && payload.type !== "final"
      ? `Step: ${humanize(payload.type)}`
      : "");

  return message || null;
}

function normalizeVideo(video, index) {
  if (!video || typeof video !== "object") {
    return null;
  }

  return {
    title:
      firstString(
        video.title,
        video.name,
        video.video_title,
        video.videoName,
        video.video_name,
        video.caption,
        video.description
      ) || `Source video ${index + 1}`,
    platform: normalizePlatform(
      firstString(video.platform, video.source, video.network, video.site) || ""
    ),
    thumbnail:
      firstString(
        video.thumbnail,
        video.thumbnail_url,
        video.thumbnailUrl,
        video.thumb,
        video.image,
        video.cover,
        video.cover_url,
        video.preview_image
      ) || "",
    viewCount: firstNumber(
      video.view_count,
      video.views,
      video.play_count,
      video.viewCount,
      video.view_count,
      video.statistics && video.statistics.viewCount,
      video.metrics && video.metrics.views
    ),
    url:
      firstString(
        video.url,
        video.link,
        video.video_url,
        video.videoUrl,
        video.permalink,
        video.share_url,
        video.watch_url,
        video.web_url
      ) || "",
  };
}

function parseClaudeJson(text, logger) {
  if (!text) {
    throw withStatus("Anthropic returned an empty response.", 502);
  }

  const candidates = buildClaudeJsonCandidates(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next cleaned candidate.
    }
  }

  logger?.error("anthropic JSON parse failed", {
    textLength: text.length,
    textPreview: truncate(text, 1200),
  });

  throw withStatus("Anthropic returned JSON that could not be parsed.", 502);
}

function buildClaudeJsonCandidates(text) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const extracted = extractFirstJsonObject(unfenced);
  const candidates = [trimmed, unfenced];

  if (extracted) {
    candidates.push(extracted);
  }

  candidates.push(
    ...[trimmed, unfenced, extracted]
      .filter(Boolean)
      .map((candidate) => repairLooseJson(candidate))
  );

  return [...new Set(candidates.filter(Boolean))];
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }
  return text.slice(start, end + 1);
}

function repairLooseJson(text) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function normalizeGuide(guide, destination) {
  return {
    destination,
    tagline: firstString(guide.tagline) || "A city worth planning every meal around.",
    dishes: ensureArray(guide.dishes, 6, {
      name: "Signature dish",
      emoji: "🍽️",
      where: "Across the city",
    }).map((item) => ({
      name: firstString(item.name) || "Signature dish",
      emoji: firstString(item.emoji) || "🍽️",
      where: firstString(item.where) || "Across the city",
    })),
    spots: ensureArray(guide.spots, 5, {
      name: "Standout spot",
      description: "Worth seeking out.",
      tags: ["popular"],
    }).map((item) => ({
      name: firstString(item.name) || "Standout spot",
      description: firstString(item.description) || "Worth seeking out.",
      tags:
        Array.isArray(item.tags) && item.tags.length
          ? item.tags.map((tag) => String(tag))
          : ["popular"],
    })),
    neighborhoods: ensureArray(guide.neighborhoods, 3, {
      name: "Food district",
      description: "Packed with solid options.",
      best_for: "Trying a little of everything",
    }).map((item) => ({
      name: firstString(item.name) || "Food district",
      description: firstString(item.description) || "Packed with solid options.",
      best_for:
        firstString(item.best_for) || "Trying a little of everything",
    })),
    day_plan: ensureArray(guide.day_plan, 6, {
      time: "Anytime",
      spot: "Flexible stop",
      note: "Build around what you crave most.",
    }).map((item) => ({
      time: firstString(item.time) || "Anytime",
      spot: firstString(item.spot) || "Flexible stop",
      note: firstString(item.note) || "Build around what you crave most.",
    })),
    tips: ensureArray(guide.tips, 4, "Go where the lines are moving fast.").map(
      (tip) =>
        typeof tip === "string"
          ? tip
          : "Go where the lines are moving fast."
    ),
  };
}

function ensureArray(value, size, fallback) {
  const items = Array.isArray(value) ? [...value] : [];
  while (items.length < size) {
    items.push(fallback);
  }
  return items.slice(0, size);
}

function mapRecency(recency) {
  const allowed = new Set([
    "past_week",
    "past_month",
    "past_3_months",
    "past_year",
  ]);

  return allowed.has(recency) ? recency : "past_year";
}

function formatRecencyPhrase(recency) {
  const map = {
    past_week: "the past week",
    past_month: "the past month",
    past_3_months: "the past 3 months",
    past_year: "the past year",
  };

  return map[mapRecency(recency)] || "the past year";
}

function formatBudget(budget, userFacing = false) {
  const map = {
    all: userFacing ? "All budgets" : "Suitable for any budget.",
    casual: userFacing
      ? "Street food & casual"
      : "Emphasize street food and casual places.",
    midrange: userFacing
      ? "Mid-range restaurants"
      : "Lean toward mid-range restaurants.",
    splurge: userFacing
      ? "Fine dining & splurges"
      : "Include fine dining and splurge-worthy meals.",
  };

  return map[budget] || map.all;
}

function formatFocus(focus) {
  return Array.isArray(focus) && focus.length ? focus.join(", ") : "All food types";
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("you")) {
    return "youtube";
  }
  if (lower.includes("tik")) {
    return "tiktok";
  }
  if (lower.includes("insta")) {
    return "instagram";
  }
  if (lower.includes("twitter") || lower === "x") {
    return "twitter";
  }
  return lower || "unknown";
}

function prettyPlatform(platform) {
  const map = {
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
    twitter: "X/Twitter",
    unknown: "Unknown",
  };
  return map[platform] || platform;
}

function toMemoriesPlatformType(platform) {
  const map = {
    youtube: "YOUTUBE",
    tiktok: "TIKTOK",
    instagram: "INSTAGRAM",
  };

  return map[normalizePlatform(platform)] || null;
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const numeric = Number(value.replace(/[^\d.]/g, ""));
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }
  return null;
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createRequestLogger(requestId, logger = console) {
  const prefix = `[fork-and-fly:${requestId || "local"}]`;

  return {
    info(message, details = {}) {
      logger.log(prefix, message, details);
    },
    error(message, details = {}) {
      logger.error(prefix, message, details);
    },
  };
}

function truncate(value, maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

module.exports = {
  handleSearchRequest,
};
