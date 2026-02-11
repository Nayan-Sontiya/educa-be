// scripts/normalizeCalendarDates.js
// This script normalizes all calendar entry dates to UTC midnight
// Run this to fix existing entries with inconsistent date formats

const mongoose = require('mongoose');
require('dotenv').config();

const StudentCalendar = require('../models/StudentCalendar');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const normalizeDateToLocalMidnight = (date) => {
  const dateObj = new Date(date);
  // Get the date components in local timezone
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  // Create a new date at local midnight
  return new Date(year, month, day, 0, 0, 0, 0);
};

const normalizeCalendarDates = async () => {
  try {
    const calendars = await StudentCalendar.find({});
    console.log(`Found ${calendars.length} student calendars`);

    let totalEntries = 0;
    let normalizedEntries = 0;

    for (const calendar of calendars) {
      let calendarUpdated = false;

      for (let i = 0; i < calendar.entries.length; i++) {
        const entry = calendar.entries[i];
        totalEntries++;

        // Normalize date to local midnight
        const normalizedDate = normalizeDateToLocalMidnight(entry.date);
        const originalDateStr = entry.date.toISOString();
        const normalizedDateStr = normalizedDate.toISOString();

        // Only update if date has changed
        if (originalDateStr !== normalizedDateStr) {
          calendar.entries[i].date = normalizedDate;
          normalizedEntries++;
          calendarUpdated = true;
          console.log(
            `  Entry ${i}: ${entry.type} ${entry.attendanceStatus || entry.eventTitle} - ` +
            `${originalDateStr} -> ${normalizedDateStr}`
          );
        }
      }

      if (calendarUpdated) {
        await calendar.save();
        console.log(`  Updated calendar for studentId: ${calendar.studentId}`);
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Total entries processed: ${totalEntries}`);
    console.log(`  Entries normalized: ${normalizedEntries}`);
    console.log(`  Calendars updated: ${calendars.filter(c => c.isModified()).length}`);
  } catch (error) {
    console.error('Error normalizing calendar dates:', error);
    throw error;
  }
};

const main = async () => {
  await connectDB();
  await normalizeCalendarDates();
  await mongoose.connection.close();
  console.log('\nNormalization completed!');
  process.exit(0);
};

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
