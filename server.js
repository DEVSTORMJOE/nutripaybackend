// const express = require('express');
// const cors = require('cors');
// const dotenv = require('dotenv');
// const connectDB = require('./config/db');

// dotenv.config();

// connectDB();

// const app = express();

// app.use(cors());
// app.use(express.json());

// // Routes
// app.use('/api/auth', require('./routes/authRoutes'));
// app.use('/api/student', require('./routes/studentRoutes'));
// app.use('/api/sponsor', require('./routes/sponsorRoutes'));
// app.use('/api/vendor', require('./routes/vendorRoutes'));
// app.use('/api/delivery', require('./routes/deliveryRoutes'));
// app.use('/api/wallet', require('./routes/walletRoutes'));
// app.use('/api/notifications', require('./routes/notificationRoutes'));
// app.use('/api/payment', require('./routes/paymentRoutes'));
// app.use('/api/admin', require('./routes/adminRoutes'));
// app.use('/api/mpesa', require('./routes/mpesaRoutes'));
// app.use('/api/payhero', require('./routes/payheroRoutes'));
// app.use('/api/testimonials', require('./routes/testimonialsRoutes'))

// //TESTINONIAL ROUTES
// const testimonialsRoutes = require("./routes/testimonialsRoutes");
// app.use("/api", testimonialsRoutes);

// //SUBSCIBER ROUTE 
// const subscriberRoutes = require("./routes/subscriberRoutes");
// app.use("/api/subscribe", subscriberRoutes);

// //MEAL ROUTES
// const mealRoutes = require("./routes/mealRoutes");
// app.use("/api/meals", mealRoutes);

// //CART ROUTES 
// const cartRoutes = require("./routes/cartRoutes");
// app.use("/api/cart", cartRoutes);


// //SPONSORS ROUTE
// const Sponsors = require("./routes/Sponsors");
// app.use("/api/sponsors", Sponsors);



// // Basic route
// app.get('/', (req, res) => {
//   res.send('NutriPay Backend Running');
// });

// // Error handling
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(500).send('Server Error');
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

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Routes (keep existing logic)
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

// Testimonials (dedupe: keep ONE mounting style)
app.use("/api/testimonials", require("./routes/testimonialsRoutes"));

// Subscribers (your Newsletter calls POST `${API_BASE_URL}/api/subscribe`)
app.use("/api/subscribe", require("./routes/subscriberRoutes"));

// Meals
app.use("/api/meals", require("./routes/mealRoutes"));

// Cart
app.use("/api/cart", require("./routes/cartRoutes"));

// Sponsors
app.use("/api/sponsors", require("./routes/Sponsors"));

// ✅ Nutri AI (RapidAPI proxy)
app.use("/api/nutri-ai", require("./routes/nutriAi.routes"));

// Basic route
app.get("/", (req, res) => {
  res.send("NutriPay Backend Running");
});

// Error handling (keep last)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));