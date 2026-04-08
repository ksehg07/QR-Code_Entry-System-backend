require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Registration = require("./models/Registration");
const QRCode = require("qrcode");
const Settings = require('./models/Settings');

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const MONGODB_URI = process.env.MONGODB_URI;

// Error Logging Utility
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
};

// Validate required environment variables
if (!MONGODB_URI) {
  logger.error("MONGODB_URI is not defined in environment variables");
  process.exit(1);
}

// Middleware - CORS Configuration
const corsOptions = {
  origin: NODE_ENV === "production" ? CLIENT_URL : [CLIENT_URL, "http://localhost:3000"],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// MongoDB connection
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,  // 5 second timeout for server selection
    socketTimeoutMS: 45000,           // 45 second timeout for socket operations
    retryWrites: true,                // Enable write retries for reliability
    w: 'majority',                    // Write concern for data durability
  })
  .then(() => logger.info("✅ MongoDB connected"))
  .catch((err) => {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// 📌 Register route
app.post("/register", async (req, res) => {
  try {
    const existingUser = await Registration.findOne({
      $or: [{ email: req.body.email }, { collegeId: req.body.collegeId }],
    });

    if (existingUser) {
      return res
        .status(409)
        .json({ success: false, message: "You have already registered." });
    }

    const registrationData = new Registration(req.body);

    const qrData = registrationData.collegeId; // Unique & scannable
    const qrImage = await QRCode.toDataURL(qrData);

    //Attach base64 QR image to DB
    registrationData.qrCode = qrImage;

    await registrationData.save();
    logger.info(`✅ New registration: ${req.body.email}`);

    res.status(201).json({
      success: true,
      message: "Registration successful",
      qrCode: qrImage,
    });
  } catch (err) {
    logger.error(`Error saving registration: ${err.message}`);
    res.status(500).json({ success: false, error: "Failed to register" });
  }
});

app.post("/check-user", async (req, res) => {
  try {
    const user = await Registration.findOne({ email: req.body.email });
    if (user) {
      res.json({ registered: true, user });
    } else {
      res.json({ registered: false });
    }
  } catch (err) {
    logger.error(`Check user error: ${err.message}`);
    res.status(500).json({ error: "Error checking user" });
  }
});

app.post("/admin/set-target", async (req, res) => {
  const { target } = req.body;

  try {
    let settings = await Settings.findOne({ festName: "default" });
    if (!settings) {
      settings = new Settings({ festName: "default", target });
    } else {
      settings.target = target;
    }

    await settings.save();
    logger.info(`Target updated to ${target}`);
    res.json({
      success: true,
      message: "Target updated successfully",
      target: settings.target,
    });
  } catch (err) {
    logger.error(`Failed to update target: ${err.message}`);
    res.status(500).json({ error: "Failed to update target" });
  }
});

// ✅ Route for QR scan & attendance marking
app.post("/verify-scan", async (req, res) => {
  const { qrData } = req.body; // qrData = collegeId
  try {
    const user = await Registration.findOne({ collegeId: qrData });

    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    if (user.attended) {
      return res.json({
        status: "already",
        message: "Already marked as attended",
        name: user.name,
        collegeId: user.collegeId,
      });
    }

    user.attended = true;
    await user.save();

    res.json({
      status: "success",
      message: "Marked as attended",
      name: user.name,
      collegeId: user.collegeId,
    });
  } catch (err) {
    logger.error(`Verification error: ${err.message}`);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// Add this route in server/index.js
app.get("/admin/stats", async (req, res) => {
  try {
    const allUsers = await Registration.find();
    const attendedUsers = await Registration.find({ attended: true });
    const notAttendedUsers = await Registration.find({ attended: false });

    res.json({
      total: allUsers.length,
      attended: attendedUsers.length,
      notAttended: notAttendedUsers.length,
      users: allUsers,
    });
  } catch (err) {
    logger.error(`Error fetching admin stats: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.get("/admin/progress", async (req, res) => {
  try {
    const attended = await Registration.countDocuments({ attended: true });
    const total = await Registration.countDocuments();

    // Fetch target from DB
    let settings = await Settings.findOne({ festName: "default" });
    if (!settings) {
      // if no settings found, create default
      settings = await Settings.create({ festName: "default", target: 200 });
    }

    const progress = Math.round((attended / settings.target) * 100);

    res.json({
      attended,
      total,
      target: settings.target,
      progress,
    });
  } catch (err) {
    logger.error(`Progress card error: ${err.message}`);
    res.status(500).json({ error: "Failed to get progress data" });
  }
});


app.get("/admin/graph-data", async (req, res) => {
  try {
    // Get all users with attended field true
    const attendedUsers = await Registration.find({ attended: true });

    // Group them by registration date (DD MMM format)
    const grouped = {};

    attendedUsers.forEach((user) => {
      const date = new Date(user.createdAt || user._id.getTimestamp());
      const key = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

      grouped[key] = (grouped[key] || 0) + 1;
    });

    // Convert grouped object to array of { date, attended }
    const result = Object.keys(grouped).map((date) => ({
      date,
      attended: grouped[date],
    }));

    // Sort by date order (optional but clean)
    result.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json(result);
  } catch (err) {
    logger.error(`Graph data error: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch graph data" });
  }
});


app.get("/user/profile", async (req, res) => {
  const { email } = req.query;
  const user = await Registration.findOne({ email }); // use Registration, not UserModel
  if (!user) return res.status(404).send("User not found");
  res.json(user);
});

// Centralized Error Handler Middleware (MUST be after all routes)
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    error: NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// 404 Handler (should be before error handler)
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
app.listen(PORT, () => {
  logger.info(`✅ Server running on port ${PORT} (${NODE_ENV} mode)`);
});
