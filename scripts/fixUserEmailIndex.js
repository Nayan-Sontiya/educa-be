// scripts/fixUserEmailIndex.js
// This script fixes the email index to allow multiple null values for parent/student users
// Run this once if you encounter duplicate key errors for null emails

const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const fixEmailIndex = async () => {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Drop existing email index if it exists
    try {
      await collection.dropIndex('email_1');
      console.log('Dropped existing email_1 index');
    } catch (error) {
      if (error.codeName === 'IndexNotFound') {
        console.log('No existing email_1 index found');
      } else {
        throw error;
      }
    }

    // Create new sparse unique index
    await collection.createIndex({ email: 1 }, { unique: true, sparse: true });
    console.log('Created new sparse unique index on email');

    // Also ensure username index is sparse
    try {
      await collection.dropIndex('username_1');
      console.log('Dropped existing username_1 index');
    } catch (error) {
      if (error.codeName === 'IndexNotFound') {
        console.log('No existing username_1 index found');
      } else {
        throw error;
      }
    }

    await collection.createIndex({ username: 1 }, { unique: true, sparse: true });
    console.log('Created new sparse unique index on username');

    // Update any existing users with email: null to email: undefined
    const result = await collection.updateMany(
      { email: null, role: { $in: ['parent', 'student'] } },
      { $unset: { email: '' } }
    );
    console.log(`Updated ${result.modifiedCount} users to remove null email`);

    console.log('Index fix completed successfully!');
  } catch (error) {
    console.error('Error fixing index:', error);
    throw error;
  }
};

const main = async () => {
  await connectDB();
  await fixEmailIndex();
  await mongoose.connection.close();
  console.log('Connection closed');
  process.exit(0);
};

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
