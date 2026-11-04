import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { AuthenticatedUser, SafiContext } from "./types.js";

const secret = new TextEncoder().encode(config.context.secret);

export interface SignedContext {
  token: string;
  expiresAt: string;
}

export async function signContext(user: AuthenticatedUser): Promise<SignedContext> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.context.ttlSeconds;

  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(config.context.issuer)
    .setAudience(config.context.audience)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);

  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export async function verifyContext(token: string | undefined): Promise<SafiContext> {
  if (!token) {
    throw new Error("missing_safi_context");
  }

  const { payload } = await jwtVerify(token, secret, {
    issuer: config.context.issuer,
    audience: config.context.audience,
    algorithms: ["HS256"]
  });

  if (!payload.sub || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    throw new Error("invalid_safi_context");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    aud: config.context.audience,
    iss: config.context.issuer,
    exp: payload.exp,
    iat: payload.iat,
    jti: typeof payload.jti === "string" ? payload.jti : ""
  };
}
