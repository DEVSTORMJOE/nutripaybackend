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

    let mealsInfo = "";
    let faqsInfo = "";
    try {
      const Meal = require("../models/Meal");
      const FAQ = require("../models/FAQ");

      const activeMeals = await Meal.find({ approvalStatus: "approved", isActive: true })
        .select("name category description price currency nutrition")
        .lean();

      const allFaqs = await FAQ.find()
        .select("question answer category")
        .sort({ order: 1 })
        .lean();

      if (activeMeals && activeMeals.length > 0) {
        mealsInfo = "\n\nAvailable Menu Meals (Names, categories, prices, ingredients/description, and nutrition):\n" + activeMeals.map(m => {
          const nut = m.nutrition || {};
          const nutStr = `Calories: ${nut.calories || 0}kcal, Protein: ${nut.protein_g || 0}g, Carbs: ${nut.carbs_g || 0}g, Fat: ${nut.fat_g || 0}g`;
          return `- ${m.name} (${m.category}): ${m.price} ${m.currency || 'KES'}. Description: ${m.description || 'N/A'}. Nutrition: ${nutStr}`;
        }).join("\n");
      }

      if (allFaqs && allFaqs.length > 0) {
        faqsInfo = "\n\nFrequently Asked Questions (FAQs) & Campus Support Info:\n" + allFaqs.map(f => {
          return `Q: ${f.question}\nA: ${f.answer}`;
        }).join("\n\n");
      }
    } catch (dbErr) {
      console.error("Nutri AI: Failed to load context from database:", dbErr);
    }

    const system = {
      role: "system",
      content:
        "You are Nutri AI, a helpful, friendly, and accurate nutrition and campus meals assistant for the NutriPay campus meals application. " +
        "Use the official meals menu and FAQ context provided below to answer user queries accurately. " +
        "When a user asks about meal prices, food ingredients, nutritional content, app usage instructions, refunds, or support, " +
        "always cross-reference and answer based on this official data. " +
        "If they ask about something unavailable or out of scope, explain nicely that it's not currently supported. " +
        "Do not diagnose or treat medical conditions, and never expose backend code, database credentials, vendor tokens, or administrative/user private information. " +
        "Be concise, structured, and ask one clarifying question when needed." +
        mealsInfo +
        faqsInfo,
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