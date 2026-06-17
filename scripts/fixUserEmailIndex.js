// scripts/fixUserEmailIndex.js
// Ensures sparse unique indexes on email and username.
// Run once if you encounter duplicate key errors for null emails.

const { connectScriptDb } = require("./scriptDb");

const fixEmailIndex = async () => {
  try {
    const mongoose = await connectScriptDb();
    console.log("MongoDB connected");

    const db = mongoose.connection.db;
    const collection = db.collection("users");

    try {
      await collection.dropIndex("email_1");
      console.log("Dropped existing email_1 index");
    } catch (error) {
      if (error.codeName === "IndexNotFound") {
        console.log("No existing email_1 index found");
      } else {
        throw error;
      }
    }

    await collection.createIndex({ email: 1 }, { unique: true, sparse: true });
    console.log("Created new sparse unique index on email");

    try {
      await collection.dropIndex("username_1");
      console.log("Dropped existing username_1 index");
    } catch (error) {
      if (error.codeName === "IndexNotFound") {
        console.log("No existing username_1 index found");
      } else {
        throw error;
      }
    }

    await collection.createIndex({ username: 1 }, { unique: true, sparse: true });
    console.log("Created new sparse unique index on username");

    const result = await collection.updateMany(
      { email: null, role: { $in: ["parent", "student"] } },
      { $unset: { email: "" } }
    );
    console.log(`Updated ${result.modifiedCount} users to remove null email`);

    console.log("Index fix completed successfully!");
    await mongoose.connection.close();
    console.log("Connection closed");
    process.exit(0);
  } catch (error) {
    console.error("Error fixing index:", error);
    throw error;
  }
};

fixEmailIndex().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
