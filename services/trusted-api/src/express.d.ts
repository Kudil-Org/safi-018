import type { AuthenticatedUser, SafiContext } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      safiContext?: SafiContext;
    }
  }
}

export {};
