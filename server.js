const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();

connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/student', require('./routes/studentRoutes'));
app.use('/api/sponsor', require('./routes/sponsorRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));
app.use('/api/mealplans', require('./routes/mealPlanRoutes'));
app.use('/api/delivery', require('./routes/deliveryRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

//TESTINONIAL ROUTES
const testimonialsRoutes = require("./routes/testimonialsRoutes");
app.use("/api", testimonialsRoutes);

//SUBSCIBER ROUTE 
const subscriberRoutes = require("./routes/subscriberRoutes");
app.use("/api/subscribe", subscriberRoutes);

//MEAL ROUTES
const mealRoutes = require("./routes/mealRoutes");
app.use("/api/meals", mealRoutes);

//CART ROUTES 
const cartRoutes = require("./routes/cartRoutes");
app.use("/api/cart", cartRoutes);


// Basic route
app.get('/', (req, res) => {
  res.send('NutriPay Backend Running');
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Server Error');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
