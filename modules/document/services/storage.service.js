const supabase = require("../../../config/supabase");

const BUCKET = process.env.SUPABASE_BUCKET;

function getStorage() {
  if (!BUCKET) {
    throw new Error("SUPABASE_BUCKET is not configured");
  }

  return supabase.storage.from(BUCKET);
}

async function uploadPdf(objectKey, fileBuffer) {
  const { error } = await getStorage().upload(objectKey, fileBuffer, {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });

  if (error) throw error;
  return objectKey;
}

async function downloadPdf(objectKey) {
  const { data, error } = await getStorage().download(objectKey);

  if (error) throw error;
  if (!data) throw new Error("PDF not found in storage");

  return Buffer.from(await data.arrayBuffer());
}

async function deletePdf(objectKey) {
  const { error } = await getStorage().remove([objectKey]);

  if (error) throw error;
}

module.exports = {
  uploadPdf,
  downloadPdf,
  deletePdf,
};
