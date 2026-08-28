import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.json({
    name: "JOSYNX AI",
    status: "online"
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Please describe the website you want to build."
      });
    }

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      instructions: `
You are JOSYNX, an AI website builder.

Turn the user's idea into a complete, modern, responsive website.

Return ONLY valid HTML.
Include:
- HTML
- CSS inside <style>
- JavaScript inside <script>

Do not use Markdown.
Do not wrap the answer in code fences.
      `,
      input: prompt
    });

    res.json({
      success: true,
      html: response.output_text
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "JOSYNX AI could not generate the website."
    });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`JOSYNX backend running on port ${PORT}`);
});
