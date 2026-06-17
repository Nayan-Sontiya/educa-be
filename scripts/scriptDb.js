const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

function getMongoUri() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MongoDB URI not set. Add MONGO_URI to educa-be/.env (see .env.example)."
    );
  }
  return uri;
}

async function connectScriptDb() {
  const mongoose = require("mongoose");
  await mongoose.connect(getMongoUri());
  return mongoose;
}

module.exports = { getMongoUri, connectScriptDb };
