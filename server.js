
// // server.js
// const express = require("express");
// const cors = require("cors");
// const dotenv = require("dotenv");
// const connectDB = require("./config/db");

// dotenv.config();
// connectDB();

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json({ limit: "1mb" }));

// // Routes (keep existing logic)
// app.use("/api/auth", require("./routes/authRoutes"));
// app.use("/api/student", require("./routes/studentRoutes"));
// app.use("/api/sponsor", require("./routes/sponsorRoutes"));
// app.use("/api/vendor", require("./routes/vendorRoutes"));
// app.use("/api/delivery", require("./routes/deliveryRoutes"));
// app.use("/api/wallet", require("./routes/walletRoutes"));
// app.use("/api/notifications", require("./routes/notificationRoutes"));
// app.use("/api/payment", require("./routes/paymentRoutes"));
// app.use("/api/admin", require("./routes/adminRoutes"));
// app.use("/api/mpesa", require("./routes/mpesaRoutes"));
// app.use("/api/payhero", require("./routes/payheroRoutes"));

// // Testimonials (dedupe: keep ONE mounting style)
// app.use("/api/testimonials", require("./routes/testimonialsRoutes"));

// // Subscribers (your Newsletter calls POST `${API_BASE_URL}/api/subscribe`)
// app.use("/api/subscribe", require("./routes/subscriberRoutes"));

// // Meals
// app.use("/api/meals", require("./routes/mealRoutes"));

// // Cart
// app.use("/api/cart", require("./routes/cartRoutes"));

// // Sponsors
// app.use("/api/sponsors", require("./routes/Sponsors"));

// //DELIVERY LOCATIONS 
// const DeliveryLocation = require("./routes/DeliveryLocation");
// app.use("/api/delivery-locations", DeliveryLocation);



// // ✅ Nutri AI (RapidAPI proxy)
// app.use("/api/nutri-ai", require("./routes/nutriAi.routes"));



// // Basic route
// app.get("/", (req, res) => {
//   res.send("NutriPay Backend Running");
// });

// // Error handling (keep last)
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(500).send("Server Error");
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server started on port ${PORT}`));





// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();
connectDB();

const app = express();

/* =========================
   CORS FIX
   ========================= */

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,

  // React CRA local frontend
  "http://localhost:3000",
  "http://127.0.0.1:3000",

  // Vite local frontend, keep this too in case you use it later
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow Postman, mobile apps, curl, server-to-server requests
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("CORS blocked origin:", origin);
    return callback(new Error(`CORS not allowed for origin: ${origin}`));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],

  optionsSuccessStatus: 204,
};

// Must come before routes
app.use(cors(corsOptions));

// Handles browser preflight OPTIONS requests
app.options(/.*/, cors(corsOptions));

/* =========================
   BODY PARSER
   ========================= */

app.use(express.json({ limit: "1mb" }));

/* =========================
   ROUTES
   ========================= */

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/student", require("./routes/studentRoutes"));
app.use("/api/sponsor", require("./routes/sponsorRoutes"));
app.use("/api/vendor", require("./routes/vendorRoutes"));
app.use("/api/delivery", require("./routes/deliveryRoutes"));
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/mpesa", require("./routes/mpesaRoutes"));
app.use("/api/payhero", require("./routes/payheroRoutes"));

app.use("/api/testimonials", require("./routes/testimonialsRoutes"));
app.use("/api/subscribe", require("./routes/subscriberRoutes"));
app.use("/api/meals", require("./routes/mealRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/sponsors", require("./routes/Sponsors"));

const DeliveryLocation = require("./routes/DeliveryLocation");
app.use("/api/delivery-locations", DeliveryLocation);

app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/nutri-ai", require("./routes/nutriAi.routes"));

/* =========================
   BASIC ROUTE
   ========================= */

app.get("/", (req, res) => {
  res.send("NutriPay Backend Running");
});

/* =========================
   404 HANDLER
   ========================= */

app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* =========================
   ERROR HANDLER
   ========================= */

app.use((err, req, res, next) => {
  console.error("SERVER_ERROR:", err);

  if (String(err.message || "").includes("CORS not allowed")) {
    return res.status(403).json({
      message: err.message,
    });
  }

  return res.status(500).json({
    message: "Server Error",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  console.log("Allowed CORS origins:", allowedOrigins);
});