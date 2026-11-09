const express = require("express");
const router = express.Router();

const ragController = require("./controller");

router.post("/ask", ragController.askQuestion);

module.exports = router;
