import { z } from "zod";
import { HttpError } from "./http-error.js";

export function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, "invalid_body", "Request body validation failed.", result.error.issues);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, "invalid_query", "Query validation failed.", result.error.issues);
  }
  return result.data;
}

export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
