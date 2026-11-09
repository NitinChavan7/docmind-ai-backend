require("dotenv").config();

const {
  generateEmbeddings,
} = require("./modules/rag/services/embedding.service");

const testEmbedding = async () => {
  try {
    const texts = [
      "I am a Full Stack Developer",
      "I have experience in React and Node.js",
    ];

    const embeddings = await generateEmbeddings(texts);

    console.log("Total embeddings:", embeddings.length);
    console.log("Vector dimensions:", embeddings[0].length);
    console.log("First 5 values:", embeddings[0].slice(0, 5));
  } catch (error) {
    console.error("Embedding error:", error.message);
  }
};

testEmbedding();
