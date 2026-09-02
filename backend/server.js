// backend/server.js
// JOSYNX AI backend — Express + OpenAI Responses API

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

// Which model to use. Override in Render env vars without redeploying code.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

// GitHub Pages origin (and localhost, for testing on your own machine).
const ALLOWED_ORIGINS = [
  "https://josephbubenshi8-rgb.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow no-origin requests (curl, server-to-server, some mobile webviews)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({ name: "JOSYNX AI", status: "online" });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
});

app.post("/api/generate", async (req, res) => {
  const prompt = req.body && typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    return res.status(400).json({
      error: "Missing 'prompt' in request body. Expected JSON: { \"prompt\": \"...\" }"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "Server misconfiguration: OPENAI_API_KEY is not set on the backend."
    });
  }

  const systemInstructions = `You are JOSYNX, an AI website builder.
Given a short description of a website, generate ONE complete, self-contained HTML5 document.

Rules:
- Return ONLY raw HTML. No markdown code fences, no commentary, no explanations before or after.
- The document must start with <!DOCTYPE html> and include <html>, <head>, and <body>.
- Put all CSS inside a single <style> tag in the <head>.
- Put all JavaScript inside a single <script> tag near the end of <body>.
- Do not reference any external files, images, or CDNs that might not load — use inline SVG or CSS for graphics, and system fonts.
- Make the design modern, responsive, and visually polished.
- The site should be fully functional as a static page (no server calls).`;

  // Abort if OpenAI takes too long (Render free tier + generation can be slow).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: systemInstructions },
          { role: "user", content: `Build a website for: ${prompt}` }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const raw = await openaiResponse.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error("OpenAI returned non-JSON response:", raw.slice(0, 500));
      return res.status(502).json({
        error: "OpenAI returned an unreadable response.",
        details: raw.slice(0, 500)
      });
    }

    if (!openaiResponse.ok) {
      console.error("OpenAI API error:", data);
      return res.status(502).json({
        error: "OpenAI API request failed.",
        details: (data && data.error && data.error.message) || JSON.stringify(data)
      });
    }

    const html = extractHtml(data);

    if (!html) {
      console.error("Could not extract HTML from OpenAI response:", JSON.stringify(data).slice(0, 500));
      return res.status(502).json({
        error: "OpenAI response did not contain any generated HTML.",
        details: JSON.stringify(data).slice(0, 500)
      });
    }

    return res.json({ html });
  } catch (err) {
    clearTimeout(timeout);

    if (err.name === "AbortError") {
      return res.status(504).json({
        error: "Generation timed out after 90 seconds. Try a shorter/simpler prompt."
      });
    }

    console.error("Unexpected /api/generate error:", err);
    return res.status(500).json({
      error: "Unexpected server error while generating the website.",
      details: err.message
    });
  }
});

// Catch-all so old/removed endpoints give a clear message instead of a bare 404.
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// Pulls the model's text output out of a Responses API payload and strips
// accidental markdown code fences if the model added them anyway.
function extractHtml(responseBody) {
  let text = "";

  if (Array.isArray(responseBody.output)) {
    for (const item of responseBody.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part.text === "string") {
            text += part.text;
          }
        }
      }
    }
  }

  // Fallback for SDKs/proxies that flatten this to output_text.
  if (!text && typeof responseBody.output_text === "string") {
    text = responseBody.output_text;
  }

  text = text.trim();

  // Strip ```html ... ``` or ``` ... ``` fences if the model added them.
  const fenceMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return text || null;
}

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`JOSYNX backend running on port ${PORT}`);
});
      
