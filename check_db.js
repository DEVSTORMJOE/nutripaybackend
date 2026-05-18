const mongoose = require("mongoose");
const User = require("./models/User");

mongoose.connect(process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri").then(async () => {
  const sponsors = await User.find({ role: "sponsor" });
  console.log("Sponsors found:", sponsors.length);
  sponsors.forEach(s => console.log(s.email, s.name, s.createdAt));
  process.exit(0);
}).catch(console.error);
