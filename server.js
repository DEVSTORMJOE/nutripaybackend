const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();

connectDB();

const app = express();

// --- 🛡️ CRITICAL cPanel/ModSecurity WAF WORKAROUND ---
// This MUST be the absolute first middleware. It strips headers from GET requests 
// that often trigger 415/406 errors on strict firewalls.
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const headersToStrip = [
      'content-type', 'Content-Type',
      'accept-charset', 'Accept-Charset',
      'content-length', 'Content-Length'
    ];
    headersToStrip.forEach(h => delete req.headers[h]);
  }
  next();
});

// --- 🛡️ PRODUCTION CORS & SECURITY HARDENING ---
const allowedOrigins = [
  'https://nutripay.co.ke',
  'https://www.nutripay.co.ke',
  'https://api.nutripay.co.ke',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      console.error(`CORS REJECTED: Origin "${origin}" is not in the allowed list.`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'Origin', 
    'Cache-Control', 
    'Pragma', 
    'Expires', 
    'Cookie'
  ],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 200
}));

// Secondary hardening for strict proxies
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  // Explicitly handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/student', require('./routes/studentRoutes'));
app.use('/api/sponsor', require('./routes/sponsorRoutes'));
app.use('/api/sponsors', require('./routes/publicSponsorRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));
app.use('/api/delivery', require('./routes/deliveryRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/mpesa', require('./routes/mpesaRoutes'));
app.use('/api/payhero', require('./routes/payheroRoutes'));
app.use("/api/nutri-ai", require("./routes/nutripayAI"));

// TESTIMONIAL ROUTES
app.use("/api", require("./routes/testimonialsRoutes"));

// SUBSCRIBER ROUTE 
const subscriberRoutes = require("./routes/subscriberRoutes");
app.use("/api/subscribe", subscriberRoutes);

//MEAL ROUTES
const mealRoutes = require("./routes/mealRoutes");
app.use("/api/meals", mealRoutes);

//CART ROUTES 
const cartRoutes = require("./routes/cartRoutes");
app.use("/api/cart", cartRoutes);

//WAITING LIST
const waitingListRoutes = require("./routes/waitingListRoutes");
app.use("/api/waitinglist", waitingListRoutes);


// Basic route
app.get('/', (req, res) => {
  res.send('NutriPay Backend Running');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.stack);
  
  // Ensure CORS headers on errors
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Server Error'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
