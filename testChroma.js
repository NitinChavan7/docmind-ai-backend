require("dotenv").config();

const {
  getVectorCollection,
} = require("./modules/rag/services/vector.service");

const testChroma = async () => {
  try {
    const collection = await getVectorCollection();

    console.log("ChromaDB connected successfully");
    console.log("Collection:", collection.name);
    console.log("Stored vectors:", await collection.count());
  } catch (error) {
    console.error("ChromaDB error:", error);
  }
};

testChroma();
