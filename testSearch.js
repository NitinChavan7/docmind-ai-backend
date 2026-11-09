require("dotenv").config();

const {
  generateEmbeddings,
} = require("./modules/rag/services/embedding.service");

const {
  searchDocumentChunks,
} = require("./modules/rag/services/vector.service");

const testSearch = async () => {
  try {
    const documentId = "6aedbd847d7b52e317ef0712";

    const question =
      "What technologies does this developer have experience with?";

    console.log("Question:", question);

    // Step 1: Convert question into embedding
    const embeddings = await generateEmbeddings([question]);

    const questionEmbedding = embeddings[0];

    console.log("Question embedding dimensions:", questionEmbedding.length);

    // Step 2: Search ChromaDB
    const results = await searchDocumentChunks(
      documentId,
      questionEmbedding,
      3,
    );

    console.log("Matching chunks found:", results.length);

    // Step 3: Display results
    results.forEach((result, index) => {
      console.log(`\n--- Result ${index + 1} ---`);
      console.log("Page:", result.metadata?.pageNumber);
      console.log("Distance:", result.distance);
      console.log("Content:", result.content);
    });

    if (results.length === 0) {
      console.log("No matching chunks found. Check the document ID.");
    }
  } catch (error) {
    console.error("Search failed:", error);
  }
};

testSearch();
