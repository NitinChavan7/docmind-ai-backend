require("dotenv").config();

const qdrant = require("./config/qdrant");

async function testConnection() {
  try {
    const collections = await qdrant.getCollections();

    console.log("Qdrant connected successfully!");
    console.log("Collections:", collections.collections);
  } catch (error) {
    console.error("Qdrant connection failed:", error.message);
    process.exitCode = 1;
  }
}

testConnection();
