import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { verifyContext } from "./context.js";
import { HttpError } from "./http-error.js";
import { verifySupabaseSession } from "./supabase.js";
import type { SafiContext } from "./types.js";

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function requireSupabase(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) {
      throw new HttpError(401, "missing_session", "A Supabase bearer token is required.");
    }
    req.user = await verifySupabaseSession(header.slice(7).trim());
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireInternal(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provided = req.header("x-internal-token") ?? "";
    if (!provided || !constantTimeEquals(provided, config.internalToken)) {
      throw new HttpError(401, "invalid_internal_token", "The internal service token is invalid.");
    }

    try {
      req.safiContext = await verifyContext(req.header("x-safi-context"));
    } catch {
      throw new HttpError(401, "invalid_safi_context", "The signed SAFI context is missing, invalid or expired.");
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function userOf(req: Request) {
  if (!req.user) {
    throw new HttpError(401, "missing_session", "No authenticated Supabase user on this request.");
  }
  return req.user;
}

export function contextOf(req: Request): SafiContext {
  if (!req.safiContext) {
    throw new HttpError(401, "invalid_safi_context", "No verified SAFI context on this request.");
  }
  return req.safiContext;
}
