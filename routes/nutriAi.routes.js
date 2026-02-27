// routes/nutriAi.routes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const axios = require("axios");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25, // tune as needed
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeMessages(input) {
  const arr = Array.isArray(input) ? input : [];
  const cleaned = arr
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      role: m.role === "assistant" || m.role === "system" ? m.role : "user",
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0);

  // keep last 20 turns to control token usage
  return cleaned.slice(-20);
}

router.post("/chat", limiter, async (req, res) => {
  try {
    const { messages, message, web_access } = req.body || {};

    const base = normalizeMessages(messages);
    if (typeof message === "string" && message.trim()) {
      base.push({ role: "user", content: message.trim().slice(0, 4000) });
    }
    if (!base.length) {
      return res.status(400).json({ message: "No message provided." });
    }

    const system = {
      role: "system",
      content:
        "You are Nutri AI, a nutrition assistant for a campus meals app. " +
        "Give practical nutrition guidance, simple meal suggestions, and portion ideas. " +
        "Do not diagnose or treat medical conditions. " +
        "If the user mentions a medical condition, pregnancy, eating disorder, or medication, " +
        "advise consulting a clinician and provide general safe guidance only. " +
        "Be concise, structured, and ask one clarifying question when needed.",
    };

    const payload = {
      messages: [system, ...base],
      web_access: Boolean(web_access) === true ? true : false,
    };

    const url = process.env.RAPIDAPI_URL || "https://chatgpt-42.p.rapidapi.com/gpt4o";
    const host = process.env.RAPIDAPI_HOST || "chatgpt-42.p.rapidapi.com";
    const key = process.env.RAPIDAPI_KEY;

    if (!key) {
      return res.status(500).json({ message: "Missing RAPIDAPI_KEY in environment." });
    }

    const { data } = await axios.post(url, payload, {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    });

    const reply = String(data?.result ?? "").trim();
    if (!reply) {
      return res.status(502).json({ message: "Empty response from AI provider." });
    }

    return res.json({ reply });
  } catch (err) {
    const status = err?.response?.status || 500;
    const msg =
      err?.response?.data?.message ||
      err?.message ||
      "Nutri AI request failed.";
    return res.status(status).json({ message: msg });
  }
});

module.exports = router;