const express = require("express");
const router = express.Router();

const documentController = require("./controller");

const upload = require("../../middleware/upload.middleware");
const documentOperation = require('../../middleware/document-operation.middleware');

router.post(
  "/upload",
  upload.single("file"),
  documentController.uploadDocument,
);

router.get("/", documentController.getDocuments);

router.get("/:documentId/file", documentController.viewDocument);
router.get("/:documentId/view", documentController.viewDocument);

router.get("/:documentId", documentController.getDocument);

router.delete("/:documentId", documentOperation(documentController.deleteDocument));

router.post("/:documentId/process", documentOperation(documentController.processDocument));
module.exports = router;
