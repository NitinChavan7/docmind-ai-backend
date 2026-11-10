require("dotenv").config();

const supabase = require("./config/supabase");

async function testStorage() {
  try {
    const bucket = process.env.SUPABASE_BUCKET;

    const { data, error } = await supabase.storage.getBucket(bucket);

    if (error) {
      throw error;
    }

    console.log("Supabase connection successful!");
    console.log("Bucket:", data.name);
    console.log("Public:", data.public);
  } catch (error) {
    console.error("Supabase test failed:", error.message);
    process.exitCode = 1;
  }
}

testStorage();
