const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const {
  allowedOrigins,
  verifyOrigin,
} = require("./middleware/origin.middleware");
const { verifyCsrf } = require("./middleware/csrf.middleware");

const modules = require("./modules");

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));

app.use(
  cors({
    origin: allowedOrigins(),
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", verifyOrigin);
app.use("/api/auth", verifyCsrf);

app.get("/api/health", (req, res) => {
  return res.json({
    success: true,
    message: "DocMind AI backend is running",
  });
});

// Register all module routes
app.use("/api", modules);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status =
    error.code === "LIMIT_FILE_SIZE"
      ? 413
      : [400, 404, 409, 413, 429].includes(error.status)
        ? error.status
        : error.message === "Only PDF files are allowed"
          ? 400
          : 500;
  console.error("Request failed:", error.name);
  res
    .status(status)
    .json({
      success: false,
      message:
        status === 413
          ? "PDF must be under 10 MB"
          : status < 500
            ? error.type === "entity.parse.failed"
              ? "Invalid JSON"
              : error.message
            : "Unable to complete request",
    });
});

module.exports = app;
