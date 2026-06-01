const mongoose = require('mongoose');

async function check() {
  const uri = "mongodb://localhost:27017/nutripay";
  console.log("Connecting to", uri);
  await mongoose.connect(uri);
  console.log("Connected.");

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  for (const col of collections) {
    if (col.name === 'deliverylocations') {
      console.log("Found deliverylocations collection:", JSON.stringify(col, null, 2));
      if (col.options && col.options.validator) {
        console.log("Collection has validator! Removing it...");
        await db.command({
          collMod: 'deliverylocations',
          validator: {},
          validationLevel: 'off'
        });
        console.log("Validator removed successfully.");
      } else {
        console.log("No collection-level validator found in MongoDB for deliverylocations.");
      }
    }
  }

  await mongoose.disconnect();
  console.log("Disconnected.");
}

check().catch(console.error);
