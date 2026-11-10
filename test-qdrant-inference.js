require("dotenv").config();

const { randomUUID } = require("crypto");
const qdrant = require("./config/qdrant");

const COLLECTION = "document_chunks_v2";
const MODEL = "sentence-transformers/all-minilm-l6-v2";

async function main() {
  const pointId = randomUUID();

  try {
    await qdrant.upsert(COLLECTION, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: {
            text: "React is a JavaScript library for building user interfaces.",
            model: MODEL,
          },
          payload: {
            userId: "integration-test",
            documentId: "integration-test",
            content: "React is a JavaScript library.",
          },
        },
      ],
    });

    console.log("Qdrant inference insert successful!");

    const result = await qdrant.query(COLLECTION, {
      query: {
        text: "What is React?",
        model: MODEL,
      },
      filter: {
        must: [
          {
            key: "userId",
            match: { value: "integration-test" },
          },
        ],
      },
      limit: 3,
      with_payload: true,
    });

    console.log("Search matches:", result.points.length);
  } catch (error) {
    console.error("Qdrant inference failed:", error.message);
    process.exitCode = 1;
  } finally {
    await qdrant
      .delete(COLLECTION, {
        wait: true,
        points: [pointId],
      })
      .catch((error) => {
        console.error("Test cleanup failed:", error.message);
      });
  }
}

main();
