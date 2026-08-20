require('dotenv').config();
const mongoose = require('mongoose');

async function cleanupFrankMainaData() {
  const isConfirm = process.argv.includes('--confirm');
  console.log(`=======================================================`);
  console.log(` FRANK MAINA TEST DATA CLEANUP SCRIPT`);
  console.log(` Mode: ${isConfirm ? '*** EXECUTE DELETION (--confirm) ***' : '--- DRY RUN ONLY (Pass --confirm to delete) ---'}`);
  console.log(`=======================================================\n`);

  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay';
    console.log(`Connecting to MongoDB at: ${mongoUri.replace(/:([^@]+)@/, ':****@')}`);
    await mongoose.connect(mongoUri);
    console.log('Connected successfully.\n');

    const db = mongoose.connection.db;

    const rawUserIds = [
      "6a79b841e8a2ed927ba68d90",
      "6a1f2e71d174ed6e7b700b0b",
      "699c3f3cd0ade6ed1a637a7e",
      "6a706b16932e8b6ba67ce09f",
      "6a835236e4654c68facab48f"
    ];

    const objectUserIds = rawUserIds.map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch(e) { return null; }
    }).filter(Boolean);

    const allUserIds = [...rawUserIds, ...objectUserIds];

    const emails = [
      "mainafrank400@gmail.com",
      "brainstormer184@gmail.com"
    ];

    const phones = [
      "254111949314",
      "0111949314",
      "111949314",
      "+254769777634",
      "254769777634",
      "254738380692",
      "254701159155"
    ];

    const firebaseUids = [
      "HfoFdBnPXcUfit60UeE6eIvSuf13"
    ];

    const specificTxHashes = [
      "2dbf8ea8f9d7fbbb30fea9ef6a1f04d711ce9ddce94bb2c6ce0237b4690901b5",
      "49d9f4d51db5990bcb593a1e8045b80cae9707d2c4963dc2427a853f079cf799",
      "1a1431061444e852962affa8a1ab3a82a3bbe5c8f6ee09d5f07056ec062165cf",
      "a3f17c57b3f02ea63f2321765cb62acb41a8c2d12305fa2c80d032e46b5bd5a0"
    ];

    const collections = await db.listCollections().toArray();
    let totalMatchesFound = 0;
    let totalDeleted = 0;

    for (const colInfo of collections) {
      const colName = colInfo.name;
      const collection = db.collection(colName);

      const query = {
        $or: [
          { _id: { $in: allUserIds } },
          { user: { $in: allUserIds } },
          { userId: { $in: allUserIds } },
          { student: { $in: allUserIds } },
          { studentId: { $in: allUserIds } },
          { toUser: { $in: allUserIds } },
          { fromUser: { $in: allUserIds } },
          { sponsor: { $in: allUserIds } },
          { sponsorId: { $in: allUserIds } },
          { vendor: { $in: allUserIds } },
          { approvedBy: { $in: allUserIds } },
          { email: { $in: emails } },
          { sponsorEmail: { $in: emails } },
          { phone: { $in: phones } },
          { phoneNumber: { $in: phones } },
          { firebaseUid: { $in: firebaseUids } },
          { stellarTxHash: { $in: specificTxHashes } }
        ]
      };

      const matchCount = await collection.countDocuments(query);

      if (matchCount > 0) {
        totalMatchesFound += matchCount;
        console.log(`Collection [${colName}]: ${matchCount} document(s) targeted.`);

        if (isConfirm) {
          const deleteResult = await collection.deleteMany(query);
          totalDeleted += deleteResult.deletedCount;
          console.log(`  -> Deleted ${deleteResult.deletedCount} document(s) from [${colName}].`);
        }
      }
    }

    // Also remove notifications containing "Frank Maina" or "Frank" test references
    const notifCol = db.collection('notifications');
    const notifQuery = { message: { $regex: /Frank Maina/i } };
    const notifCount = await notifCol.countDocuments(notifQuery);
    if (notifCount > 0) {
      totalMatchesFound += notifCount;
      console.log(`Collection [notifications]: ${notifCount} notification(s) matching "Frank Maina" text.`);
      if (isConfirm) {
        const notifDel = await notifCol.deleteMany(notifQuery);
        totalDeleted += notifDel.deletedCount;
        console.log(`  -> Deleted ${notifDel.deletedCount} notification(s).`);
      }
    }

    console.log(`\n=======================================================`);
    if (isConfirm) {
      console.log(` CLEANUP COMPLETE: Successfully deleted ${totalDeleted} test record(s).`);
    } else {
      console.log(` DRY RUN COMPLETE: Found ${totalMatchesFound} matching test record(s).`);
      console.log(` To execute actual deletion, re-run with: node scripts/cleanup_frank_maina_data.js --confirm`);
    }
    console.log(`=======================================================\n`);

  } catch (err) {
    console.error("Cleanup script error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupFrankMainaData();
