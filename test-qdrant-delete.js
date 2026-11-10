require("dotenv").config();

const { randomUUID } = require("crypto");
const util = require("util");

const qdrant = require("./config/qdrant");

const COLLECTION = process.env.QDRANT_COLLECTION || "document_chunks_v2";

async function main() {
  // Unique test values that don't belong to a real user.
  const testUserId = `diagnostic-${randomUUID()}`;
  const testDocumentId = `diagnostic-${randomUUID()}`;

  const filter = {
    must: [
      {
        key: "userId",
        match: { value: testUserId },
      },
      {
        key: "documentId",
        match: { value: testDocumentId },
      },
    ],
  };

  try {
    console.log("[TEST] Checking Qdrant collection");

    const collection = await qdrant.getCollection(COLLECTION);

    console.log("Collection status:", collection.status);
    console.log(
      "Payload indexes:",
      Object.keys(collection.payload_schema || {}),
    );

    console.log("[TEST] Checking filtered point count");

    const countResult = await qdrant.count(COLLECTION, {
      filter,
      exact: true,
    });

    console.log("Matching points:", countResult.count);

    if (countResult.count !== 0) {
      throw new Error(
        "Unexpected matching points. Aborting diagnostic deletion.",
      );
    }

    console.log("[TEST] Trying deletion with unique test IDs");

    const result = await qdrant.delete(COLLECTION, {
      wait: true,
      filter,
    });

    console.log("[SUCCESS] Filtered deletion accepted!");
    console.log(result);
  } catch (error) {
    console.error("[ERROR] Qdrant request failed");

    console.error("Message:", error.message);
    console.error("Status:", error.status);

    console.error(
      "Response details:",
      util.inspect(error.data, {
        depth: 10,
        colors: false,
      }),
    );

    process.exitCode = 1;
  }
}

main();
