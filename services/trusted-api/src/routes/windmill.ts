import { Readable } from "node:stream";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "../http-error.js";

const ALLOWED_PREFIXES = [
  "jobs/run/f/",
  "jobs_u/",
  "flow_conversations",
  "job_helpers/"
] as const;

function allowedSubpath(subpath: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => subpath.startsWith(prefix));
}

export async function windmillProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const prefix = "/api/w/";
    if (!req.originalUrl.startsWith(prefix)) {
      throw new HttpError(404, "not_found", "Unknown Windmill proxy path.");
    }

    const relative = req.originalUrl.slice(prefix.length);
    const expected = `${config.windmill.workspace}/`;
    if (!relative.startsWith(expected)) {
      throw new HttpError(404, "not_found", "Unknown Windmill workspace.");
    }

    const subpath = relative.slice(expected.length).split("?")[0] ?? "";
    if (!allowedSubpath(subpath)) {
      throw new HttpError(403, "windmill_path_forbidden", "This Windmill endpoint is not available through the proxy.");
    }

    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      throw new HttpError(405, "method_not_allowed", "Unsupported Windmill proxy method.");
    }

    const hasBody = req.method === "POST";
    const headers: Record<string, string> = {
      accept: req.header("accept") ?? "application/json",
      authorization: `Bearer ${config.windmill.chatToken}`
    };
    if (hasBody) {
      headers["content-type"] = "application/json";
    }

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    const init: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal
    };
    if (hasBody) {
      init.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(
      `${config.windmill.internalBaseUrl.replace(/\/+$/, "")}${req.originalUrl}`,
      init
    );

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }
    res.setHeader("cache-control", "no-store");

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    next(error);
  }
}
