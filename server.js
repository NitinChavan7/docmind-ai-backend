require("dotenv").config();

require("./config/auth").validateAuthConfig();

const app = require("./app");
const connectDB = require("./config/db");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Step 1: Connect to MongoDB Atlas
    await connectDB();

    // Step 2: Initialize MongoDB model indexes
    await Promise.all(
      Object.values(require("./modules/database")).map((model) => model.init()),
    );

    // Step 3: Start Express server
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
