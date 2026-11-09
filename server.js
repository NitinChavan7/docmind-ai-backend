require("dotenv").config();
require('./config/auth').validateAuthConfig();

const app = require("./app");
const connectDB = require("./config/db");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    // Enforce uniqueness and query indexes before accepting authentication requests.
    await Promise.all(Object.values(require('./modules/database')).map(model => model.init()));

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
