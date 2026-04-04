// server.js
const path = require("path");
// override: true — if STRIPE_* (etc.) exist in the OS env as empty placeholders, dotenv
// would otherwise skip them and leave secrets missing.
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const connectDB = require("./config/db");
const app = express();

const subscriptionController = require("./controllers/subscriptionController");

// Stripe webhook must receive raw body (before express.json)
app.post(
  "/api/subscription/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => subscriptionController.handleStripeWebhook(req, res)
);

// Middlewares
// Large limit: academic evidence can be sent as JSON base64 from Expo (multipart is unreliable on RN)
app.use(express.json({ limit: "30mb" }));
app.use(cors());
app.use(morgan("dev"));

// Serve uploaded files statically
// Files can be accessed at: http://localhost:5000/uploads/filename.ext
// Example: http://localhost:5000/uploads/1761501010261-277639906.png
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Brand assets (e.g. logo in transactional emails when API_PUBLIC_URL is set)
app.use("/brand", express.static(path.join(__dirname, "assets", "brand")));

// DB Connection
connectDB();

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/schools", require("./routes/schoolRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/teachers", require("./routes/teacherRoutes"));
app.use("/api/classes", require("./routes/classRoutes"));
app.use("/api/sections", require("./routes/sectionRoutes"));
app.use("/api/subjects", require("./routes/subjectRoutes"));
app.use("/api/class-sections", require("./routes/classSectionRoutes"));
app.use("/api/students", require("./routes/studentRoutes"));
app.use(
  "/api/teacher-assignments",
  require("./routes/teacherAssignmentRoutes")
);
app.use("/api/leaves", require("./routes/leaveRoutes"));
app.use("/api/notices", require("./routes/noticeRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/attendance", require("./routes/attendanceRoutes"));
app.use("/api/calendar", require("./routes/calendarRoutes"));
app.use("/api/parent-alerts", require("./routes/parentAlertRoutes"));
app.use("/api/conversations", require("./routes/conversationRoutes"));
app.use("/api/student-leaves", require("./routes/studentLeaveRoutes"));
app.use("/api/teacher-attendance", require("./routes/teacherAttendanceRoutes"));
app.use("/api/subscription", require("./routes/subscriptionRoutes"));

// Cron jobs
require("./cron/markTeachersAbsent");
require("./cron/subscriptionJobs");

app.get("/", (req, res) => res.send("EduVerse API is running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
