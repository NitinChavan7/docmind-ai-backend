require("dotenv").config();

const {
  generateAnswer,
  streamAnswer,
} = require("./modules/rag/services/llm.service");

async function main() {
  const answer = await generateAnswer(
    "What is the name?",
    "The person's name is Rahul Sharma.",
    [],
  );

  console.log("Normal answer:", answer);

  console.log("\nStreaming answer:");

  for await (const token of streamAnswer(
    "What is the name?",
    "The person's name is Rahul Sharma.",
    [],
  )) {
    process.stdout.write(token);
  }

  console.log("\n\nGroq test completed");
}

main().catch((error) => {
  console.error("Groq test failed:", error.message);
  process.exitCode = 1;
});
