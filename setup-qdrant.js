require("dotenv").config();

const qdrant = require("./config/qdrant");

const COLLECTION = process.env.QDRANT_COLLECTION || "document_chunks";

async function setupQdrant() {
  try {
    const result = await qdrant.collectionExists(COLLECTION);

    if (!result.exists) {
      await qdrant.createCollection(COLLECTION, {
        vectors: {
          size: 768,
          distance: "Cosine",
        },
      });

      console.log("Collection created:", COLLECTION);
    } else {
      console.log("Collection already exists:", COLLECTION);
    }

    const collections = await qdrant.getCollections();
    console.log("Available collections:", collections.collections);
  } catch (error) {
    console.error("Qdrant setup failed:", error.message);
    process.exitCode = 1;
  }
}

setupQdrant();
