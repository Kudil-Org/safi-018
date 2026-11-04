import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { internalRouter } from "./routes/internal.js";
import { windmillProxy } from "./routes/windmill.js";
import { requireSupabase } from "./middleware.js";
import { HttpError, isHttpError } from "./http-error.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-internal-token", "x-safi-context"],
    maxAge: 600
  })
);

app.use(express.json({ limit: "256kb" }));

app.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  next();
});

app.use("/api/w", requireSupabase, windmillProxy);
app.use("/api", apiRouter);
app.use("/internal", internalRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Unknown endpoint." } });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (isHttpError(error)) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error("[trusted-api] unhandled error:", error);
  res.status(500).json({ error: { code: "internal_error", message } });
});

const server = app.listen(config.port, () => {
  console.log(`[trusted-api] listening on :${config.port} release=${config.release}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

export { app, HttpError };
