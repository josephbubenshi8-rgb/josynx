// JOSYNX AI backend — Gemini

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_PROMPT_LENGTH = 4000;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

const ALLOWED_ORIGINS = [
  "https://josephbubenshi8-rgb.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("Not allowed by CORS: " + origin)
      );
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "JOSYNX AI",
    status: "online",
    provider: "Google Gemini"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: GEMINI_MODEL
  });
});

app.post("/api/edit", async (req, res) => {
  const html = req.body && typeof req.body.html === "string" ? req.body.html.trim() : "";
  const instruction = req.body && typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
  const MAX_HTML_LENGTH = 150000;

  if (!html) return res.status(400).json({ error: "Missing 'html'." });
  if (!instruction) return res.status(400).json({ error: "Missing 'instruction'." });
  if (html.length > MAX_HTML_LENGTH) return res.status(413).json({ error: "Website HTML is too large to edit. Please export and simplify the page first." });
  if (instruction.length > MAX_PROMPT_LENGTH) return res.status(413).json({ error: `Edit instruction is too long. Please keep it under ${MAX_PROMPT_LENGTH} characters.` });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server misconfiguration: GEMINI_API_KEY is not set." });

  const systemInstructions = `
You are JOSYNX, an AI website editor.

You will receive an existing standalone HTML5 website and one user edit instruction.

Rules:
- Return ONLY the complete updated raw HTML document.
- Do NOT use markdown code fences or explanations.
- Preserve the existing content, styling, layout, and functionality unless the user asks to change them.
- Apply the requested edit directly to the existing website.
- Keep all existing working features unless the requested change requires otherwise.
- The document must remain a complete standalone HTML5 document.
- Keep all CSS inside style tags and JavaScript inside script tags.
- Do not add external files, CDNs, external images, or remote dependencies.
- Use inline SVG or CSS for graphics when needed.
- Keep the website responsive, polished, and functional.
`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstructions }] },
          contents: [{
            role: "user",
            parts: [{
              text: "EXISTING WEBSITE HTML:\\n\\n" + html + "\\n\\nUSER EDIT INSTRUCTION:\\n" + instruction
            }]
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 16000
          }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);
    const raw = await geminiResponse.text();
    let data;
    try { data = JSON.parse(raw); }
    catch {
      return res.status(502).json({ error: "Gemini returned an unreadable response." });
    }

    if (!geminiResponse.ok) {
      const message = data && data.error && data.error.message ? data.error.message : "Gemini API request failed.";
      return res.status(502).json({
        error: "Gemini API request failed.",
        details: message,
        type: data && data.error && data.error.status ? data.error.status : null
      });
    }

    const updatedHtml = extractHtml(data);
    if (!updatedHtml) return res.status(502).json({ error: "Gemini did not return updated HTML." });
    return res.json({ html: updatedHtml });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") return res.status(504).json({ error: "Edit timed out after 90 seconds." });
    return res.status(500).json({ error: "Unexpected server error while editing the website.", details: err.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const prompt =
    req.body &&
    typeof req.body.prompt === "string"
      ? req.body.prompt.trim()
      : "";

  if (!prompt) {
    return res.status(400).json({
      error: "Missing 'prompt'."
    });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(413).json({
      error: `Prompt is too long. Please keep it under ${MAX_PROMPT_LENGTH} characters.`
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error:
        "Server misconfiguration: GEMINI_API_KEY is not set."
    });
  }

  const systemInstructions = `
You are JOSYNX, an AI website builder.

Given a short description of a website, generate ONE complete,
self-contained HTML5 document.

Rules:
- Return ONLY raw HTML.
- Do NOT use markdown code fences.
- Do NOT include explanations before or after the HTML.
- The document must start with <!DOCTYPE html>.
- Include <html>, <head>, and <body>.
- Put all CSS inside a single <style> tag.
- Put all JavaScript inside a single <script> tag near the end of body.
- Do not depend on external files, CDNs, or external images.
- Use inline SVG or CSS for graphics when needed.
- Use system fonts.
- Make the website modern, responsive, attractive and polished.
- Make buttons and interactive elements functional.
- Make the generated page work as a standalone static website.
`;

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 90000);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },

        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemInstructions
              }
            ]
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Build a website for: ${prompt}`
                }
              ]
            }
          ],

          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 12000
          }
        }),

        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const raw = await geminiResponse.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.error(
        "Gemini returned non-JSON:",
        raw.slice(0, 500)
      );

      return res.status(502).json({
        error: "Gemini returned an unreadable response."
      });
    }

    if (!geminiResponse.ok) {
      const message =
        data &&
        data.error &&
        data.error.message
          ? data.error.message
          : "Gemini API request failed.";

      console.error("Gemini API error:", data);

      return res.status(502).json({
        error: "Gemini API request failed.",
        details: message,
        type:
          data &&
          data.error &&
          data.error.status
            ? data.error.status
            : null
      });
    }

    const html = extractHtml(data);

    if (!html) {
      console.error(
        "Gemini response contained no HTML:",
        JSON.stringify(data).slice(0, 1000)
      );

      return res.status(502).json({
        error:
          "Gemini did not return any generated HTML."
      });
    }

    return res.json({
      html
    });

  } catch (err) {
    clearTimeout(timeout);

    if (err.name === "AbortError") {
      return res.status(504).json({
        error:
          "Generation timed out after 90 seconds."
      });
    }

    console.error(
      "Gemini request failed:",
      err.message
    );

    return res.status(500).json({
      error:
        "Unexpected server error while generating the website.",
      details: err.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: `No route for ${req.method} ${req.path}`
  });
});

function extractHtml(responseBody) {
  let text = "";

  if (
    responseBody &&
    Array.isArray(responseBody.candidates)
  ) {
    for (const candidate of responseBody.candidates) {
      if (
        candidate.content &&
        Array.isArray(candidate.content.parts)
      ) {
        for (const part of candidate.content.parts) {
          if (typeof part.text === "string") {
            text += part.text;
          }
        }
      }
    }
  }

  text = text.trim();

  const fenceMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);\n\n  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const htmlStart = text.search(/<!DOCTYPE html>/i);

  if (htmlStart > 0) {
    text = text.slice(htmlStart);
  }

  return text || null;
}

app.listen(PORT, () => {
  console.log(
    `JOSYNX backend running on port ${PORT}`
  );
  console.log(
    `Gemini model: ${GEMINI_MODEL}`
  );
});
