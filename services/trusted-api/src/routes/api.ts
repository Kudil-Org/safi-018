import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { signContext } from "../context.js";
import {
  createArtifact,
  getArtifact,
  listArtifacts,
  mutateArtifact
} from "../artifacts.js";
import { requireSupabase, userOf } from "../middleware.js";
import { parseBody, parseQuery, DateOnly } from "../validation.js";
import { listSlots } from "../calnode.js";
import { bookApprovedSlot } from "../booking.js";
import { HttpError } from "../http-error.js";

export const apiRouter = Router();

apiRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok", release: config.release, service: "safi-trusted-api" });
});

apiRouter.get("/config", (_req, res) => {
  res.json({
    supabaseUrl: config.supabase.publicUrl,
    supabaseAnonKey: config.supabase.anonKey,
    platformUrl: config.platformUrl,
    release: config.release,
    eventSlug: config.calnode.eventSlug,
    timezone: config.calnode.timezone
  });
});

apiRouter.get("/me", requireSupabase, (req, res) => {
  const user = userOf(req);
  res.json({ user });
});

apiRouter.get("/chat-session", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    const context = await signContext(user);

    res.json({
      baseUrl: "",
      workspace: config.windmill.workspace,
      flowPath: config.windmill.flowPath,
      context: context.token,
      contextExpiresAt: context.expiresAt,
      eventSlug: config.calnode.eventSlug,
      timezone: config.calnode.timezone
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/artifacts", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    res.json({ artifacts: await listArtifacts(user.id) });
  } catch (error) {
    next(error);
  }
});

const CreateArtifactBody = z.object({
  title: z.string().min(1).max(200).default("Meeting checklist")
});

apiRouter.post("/artifacts", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    const body = parseBody(CreateArtifactBody, req.body);
    const created = await createArtifact(user.id, body.title);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/artifacts/:id", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    res.json(await getArtifact(user.id, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

const MutateBody = z.object({
  expectedVersion: z.number().int().positive(),
  mutation: z.unknown()
});

apiRouter.post("/artifacts/:id/mutate", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    const body = parseBody(MutateBody, req.body);
    const result = await mutateArtifact(user.id, String(req.params.id), body.expectedVersion, body.mutation);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const SlotsQuery = z.object({
  from: DateOnly,
  to: DateOnly,
  tz: z.string().min(1).max(80).optional()
});

apiRouter.get("/artifacts/:id/slots", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    const query = parseQuery(SlotsQuery, req.query);
    await getArtifact(user.id, String(req.params.id));

    const timezone = query.tz ?? config.calnode.timezone;
    const result = await listSlots({
      eventTypeSlug: config.calnode.eventSlug,
      from: query.from,
      to: query.to,
      timezone
    });

    res.json({
      eventTypeSlug: config.calnode.eventSlug,
      timezone,
      slots: result.slots,
      degraded: result.degraded,
      source: "calnode"
    });
  } catch (error) {
    next(error);
  }
});

const BookBody = z.object({
  startAt: z.string().min(1),
  timezone: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  email: z.string().email().max(200),
  approved: z.literal(true)
});

apiRouter.post("/artifacts/:id/book", requireSupabase, async (req, res, next) => {
  try {
    const user = userOf(req);
    const body = parseBody(BookBody, req.body);

    if (body.approved !== true) {
      throw new HttpError(422, "approval_required", "The user must explicitly approve the slot first.");
    }

    const result = await bookApprovedSlot(user.id, String(req.params.id), body);
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});
