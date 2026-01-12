// server.js
const express = require("express");
const dotenv = require("dotenv");
const morgan = require("morgan");
const cors = require("cors");
const connectDB = require("./config/db");

dotenv.config();
const app = express();

// Middlewares
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

// Serve uploaded files statically
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
app.use(
  "/api/teacher-assignments",
  require("./routes/teacherAssignmentRoutes")
);
app.use("/api/leaves", require("./routes/leaveRoutes"));
app.use("/api/notices", require("./routes/noticeRoutes"));

app.get("/", (req, res) => res.send("EduVerse API is running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
