import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { listSlots } from "../calnode.js";
import { createArtifact, getArtifact, mutateArtifact } from "../artifacts.js";
import { bookApprovedSlot } from "../booking.js";
import { contextOf, requireInternal } from "../middleware.js";
import { DateOnly, parseBody, parseQuery } from "../validation.js";
import { HttpError } from "../http-error.js";

export const internalRouter = Router();

internalRouter.use(requireInternal);

internalRouter.post("/verify", (req, res) => {
  const context = contextOf(req);
  res.json({
    user: { id: context.sub, email: context.email },
    expiresAt: new Date(context.exp * 1000).toISOString()
  });
});

const ContextQuery = z.object({
  artifact_id: z.string().uuid().optional()
});

internalRouter.get("/context", async (req, res, next) => {
  try {
    const context = contextOf(req);
    const query = parseQuery(ContextQuery, req.query);

    if (!query.artifact_id) {
      res.json({ user: { id: context.sub, email: context.email }, artifact: null });
      return;
    }

    const result = await getArtifact(context.sub, query.artifact_id);
    res.json({ user: { id: context.sub, email: context.email }, ...result });
  } catch (error) {
    next(error);
  }
});

const SlotsQuery = z.object({
  artifact_id: z.string().uuid(),
  from: DateOnly,
  to: DateOnly,
  tz: z.string().min(1).max(80).optional()
});

internalRouter.get("/calnode/slots", async (req, res, next) => {
  try {
    const context = contextOf(req);
    const query = parseQuery(SlotsQuery, req.query);

    await getArtifact(context.sub, query.artifact_id);

    const result = await listSlots({
      eventTypeSlug: config.calnode.eventSlug,
      from: query.from,
      to: query.to,
      timezone: query.tz ?? config.calnode.timezone
    });

    res.json({
      eventTypeSlug: config.calnode.eventSlug,
      timezone: query.tz ?? config.calnode.timezone,
      slots: result.slots,
      degraded: result.degraded,
      source: "calnode"
    });
  } catch (error) {
    next(error);
  }
});

const BookBody = z.object({
  artifact_id: z.string().uuid(),
  start_at: z.string().min(1),
  timezone: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  email: z.string().email().max(200),
  approved: z.literal(true)
});

internalRouter.post("/calnode/book", async (req, res, next) => {
  try {
    const context = contextOf(req);
    const body = parseBody(BookBody, req.body);

    if (body.approved !== true) {
      throw new HttpError(422, "approval_required", "The user must explicitly approve the slot first.");
    }

    const result = await bookApprovedSlot(context.sub, body.artifact_id, {
      startAt: body.start_at,
      timezone: body.timezone,
      name: body.name,
      email: body.email
    });

    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

const CreateArtifactBody = z.object({
  title: z.string().min(1).max(200).default("Meeting checklist")
});

internalRouter.post("/artifacts", async (req, res, next) => {
  try {
    const context = contextOf(req);
    const body = parseBody(CreateArtifactBody, req.body);
    const created = await createArtifact(context.sub, body.title);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

const InternalMutateBody = z.object({
  expectedVersion: z.number().int().positive(),
  mutation: z.unknown()
});

internalRouter.post("/artifacts/:id/mutate", async (req, res, next) => {
  try {
    const context = contextOf(req);
    const body = parseBody(InternalMutateBody, req.body);
    const result = await mutateArtifact(context.sub, String(req.params.id), body.expectedVersion, body.mutation);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
