// server/controllers/faqController.js
const FAQ = require("../models/FAQ");
const cacheService = require("../services/cacheService");

// Automatic Seeding of Mock FAQs if database collection is empty
const seedMockFAQs = async () => {
  try {
    const count = await FAQ.countDocuments();
    if (count === 0) {
      console.log("[FAQ Seeder] FAQ collection is empty. Initializing seed data...");
      const mockFAQs = [
        {
          question: "How do I place an order?",
          answer: "Go to Menu, add meals to Cart, then confirm your checkout. Your delivery schedule is created automatically based on your selected date/time slot and vendor availability.",
          category: "orders",
          order: 1,
        },
        {
          question: "What do the tracking statuses mean?",
          answer: "Pending: order confirmed and awaiting preparation. Preparing: vendor is cooking. Ready: packed and ready for pickup. Assigned: rider/driver allocated. Picked up: in transit. Delivered: completed. Failed/Cancelled: terminal state (no longer active).",
          category: "delivery",
          order: 2,
        },
        {
          question: "Can I cancel a scheduled meal?",
          answer: "Yes. If the meal is still Pending (and within the allowed cutoff), you can cancel it from your schedule. If it has progressed to Preparing/Ready/Assigned/Picked up, cancellation may be restricted to protect vendor and rider operations.",
          category: "orders",
          order: 3,
        },
        {
          question: "How do refunds work?",
          answer: "When eligible, cancelled pending meals are credited back to the sponsoring wallet (if sponsored) or to your personal wallet balance. Refund timing depends on payment channel and internal settlement.",
          category: "refunds",
          order: 4,
        },
        {
          question: "What if my delivery is late or I did not receive it?",
          answer: "Check tracking first. If the status is Picked up for too long or you did not receive your meal, contact Support immediately with your scheduled date/time slot and order details so we can coordinate with the vendor and delivery partner.",
          category: "delivery",
          order: 5,
        },
        {
          question: "What if a vendor runs out of stock?",
          answer: "If a meal becomes unavailable after you order, we may suggest a replacement or issue a credit for the affected item. In mixed (combo) orders, only the impacted vendor items may be adjusted.",
          category: "orders",
          order: 6,
        },
        {
          question: "Does Nutri AI provide medical advice?",
          answer: "No. Nutri AI offers general nutrition guidance and meal suggestions. It is not a substitute for professional medical advice. For allergies, chronic conditions, pregnancy, medication, or eating disorders, consult a qualified clinician.",
          category: "general",
          order: 7,
        },
        {
          question: "How do you handle allergies and dietary restrictions?",
          answer: "You can note preferences and restrictions, but cross-contamination can occur in shared kitchens. Always review meal descriptions and contact the vendor or Support if you have severe allergies.",
          category: "general",
          order: 8,
        },
        {
          question: "How do sponsored accounts work?",
          answer: "If you are sponsored, your wallet activity may be funded by a sponsor. Credits/refunds typically return to the sponsor wallet unless otherwise specified by program policy.",
          category: "refunds",
          order: 9,
        },
        {
          question: "How do I reach Support fast?",
          answer: "Use WhatsApp for fastest response during Mon–Sat, 8:00 AM – 6:00 PM (+254 738 380 692). You can also email nutripayorg@gmail.com.",
          category: "general",
          order: 10,
        },
        {
          question: "Do you store my chat messages?",
          answer: "We may store limited conversation logs to improve support quality and prevent abuse. Sensitive personal information should not be shared in chat unless necessary for support. You can request deletion where applicable under local law.",
          category: "general",
          order: 11,
        },
        {
          question: "Can NutriPay change these policies?",
          answer: "Yes. We may update policies to improve service, comply with law, or reflect product changes. The latest version is always posted on our Policy page.",
          category: "general",
          order: 12,
        },
      ];
      await FAQ.insertMany(mockFAQs);
      console.log("[FAQ Seeder] Mock FAQs seeded successfully in database.");
    }
  } catch (err) {
    console.error("[FAQ Seeder] Seeding failed:", err.message);
  }
};

// Initiate seeding
seedMockFAQs();

// GET /api/faqs
// Public: lists all FAQs sorted by order and category
exports.listFAQs = async (req, res) => {
  try {
    const category = req.query.category || 'all';
    const cacheKey = `faqs:list:${category}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const query = {};
    if (req.query.category) {
      query.category = req.query.category;
    }
    const faqs = await FAQ.find(query).sort({ order: 1, createdAt: 1 });
    
    await cacheService.set(cacheKey, faqs, 3600); // Cache for 1 hour
    res.json(faqs);
  } catch (error) {
    console.error("Failed to list FAQs:", error);
    res.status(500).json({ error: "Failed to list FAQs." });
  }
};

// POST /api/faqs/admin
// Admin: create a new FAQ
exports.createFAQ = async (req, res) => {
  try {
    const { question, answer, category, order } = req.body || {};
    if (!question || !answer) {
      return res.status(400).json({ error: "Question and answer are required." });
    }

    const doc = await FAQ.create({
      question: String(question).trim(),
      answer: String(answer).trim(),
      category: String(category || "general").trim(),
      order: Number(order || 0),
    });

    await cacheService.delPattern("faqs:*");
    res.status(201).json({ ok: true, item: doc });
  } catch (error) {
    console.error("Failed to create FAQ:", error);
    if (error.code === 11000) {
      return res.status(400).json({ error: "FAQ with this question already exists." });
    }
    res.status(500).json({ error: "Failed to create FAQ." });
  }
};

// PUT /api/faqs/admin/:id
// Admin: update an existing FAQ
exports.updateFAQ = async (req, res) => {
  try {
    const { question, answer, category, order } = req.body || {};
    const payload = {};

    if (question !== undefined) payload.question = String(question).trim();
    if (answer !== undefined) payload.answer = String(answer).trim();
    if (category !== undefined) payload.category = String(category).trim();
    if (order !== undefined) payload.order = Number(order);

    const doc = await FAQ.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return res.status(404).json({ error: "FAQ not found." });
    }

    await cacheService.delPattern("faqs:*");
    res.json({ ok: true, item: doc });
  } catch (error) {
    console.error("Failed to update FAQ:", error);
    if (error.code === 11000) {
      return res.status(400).json({ error: "FAQ with this question already exists." });
    }
    res.status(500).json({ error: "Failed to update FAQ." });
  }
};

// DELETE /api/faqs/admin/:id
// Admin: delete an FAQ
exports.deleteFAQ = async (req, res) => {
  try {
    const doc = await FAQ.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: "FAQ not found." });
    }
    await cacheService.delPattern("faqs:*");
    res.json({ ok: true, message: "FAQ deleted successfully." });
  } catch (error) {
    console.error("Failed to delete FAQ:", error);
    res.status(500).json({ error: "Failed to delete FAQ." });
  }
};
