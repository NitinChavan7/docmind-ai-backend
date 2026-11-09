const express = require("express");
const router = express.Router();

const documentModule = require("./document");
const ragModule = require("./rag");
const { requireAuth } = require('../middleware/auth.middleware');
router.use('/auth', require('./auth'));
router.use(requireAuth, require('../middleware/csrf.middleware').verifyCsrf);

router.use("/documents", documentModule);
router.use("/rag", ragModule);
router.use('/chats', require('./chat'));

module.exports = router;
