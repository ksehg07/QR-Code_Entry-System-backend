// /server/models/Settings.js
const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  festName: { type: String, default: "default" }, // you can expand later
  target: { type: Number, default: 200 },
});

module.exports = mongoose.model("Settings", settingsSchema);
