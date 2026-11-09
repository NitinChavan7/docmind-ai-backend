const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const db = await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected successfully");
    console.log("Database:", db.connection.name);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);

    throw error;
  }
};

module.exports = connectDB;
