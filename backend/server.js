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

  // Minimal, well-documented Responses API shape:
  // top-level "instructions" for system-level guidance + a plain string "input"
  // for the user turn. This avoids ambiguity around role-tagged input arrays,
  // which some model families reject with a 400.
  const requestBody = {
    model: OPENAI_MODEL,
    instructions: systemInstructions,
    input: `Build a website for: ${prompt}`,
    max_output_tokens: 8000
  };

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const raw = await openaiResponse.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error("OPENAI request failed: non-JSON response —", raw.slice(0, 500));
      return res.status(502).json({
        error: "OpenAI returned an unreadable response.",
        details: raw.slice(0, 500)
      });
    }

    if (!openaiResponse.ok) {
      const safeMessage = extractOpenAIErrorMessage(data);
      const errType = data && data.error && typeof data.error === "object" ? data.error.type : undefined;
      const errCode = data && data.error && typeof data.error === "object" ? data.error.code : undefined;

      console.error(
        `OPENAI request failed: [HTTP ${openaiResponse.status}] ${safeMessage} ` +
        `(model: ${OPENAI_MODEL}${errType ? `, type: ${errType}` : ""}${errCode ? `, code: ${errCode}` : ""})`
      );

      return res.status(502).json({
        error: "OpenAI API request failed.",
        details: `HTTP ${openaiResponse.status}: ${safeMessage}`,
        type: errType || null,
        code: errCode || null
      });
    }

    const html = extractHtml(data);

    if (!html) {
      const preview = JSON.stringify(data).slice(0, 500);
      console.error(`OPENAI request failed: response contained no extractable HTML — ${preview}`);
      return res.status(502).json({
        error: "OpenAI response did not contain any generated HTML.",
        details: preview
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

    console.error(`OPENAI request failed: ${err.name || "Error"} — ${err.message}`);
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

// Safely extracts a human-readable message from an OpenAI error payload,
// whatever shape it comes back in. Never touches process.env, so there is
// no path by which this could leak the API key.
function extractOpenAIErrorMessage(data) {
  if (!data) return "No error body returned.";
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") {
    return (
      data.error.message ||
      [data.error.type, data.error.code, data.error.param].filter(Boolean).join(" / ") ||
      JSON.stringify(data.error)
    );
  }
  return JSON.stringify(data).slice(0, 300);
}

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
  
