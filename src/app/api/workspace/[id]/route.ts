// GET / PUT one workspace's saved data (booked shipments + last checked file).
// No login: the workspace ID is a random secret held by the browser that created it.
import type { NextRequest } from "next/server";
import { dbConfigured, isWorkspaceId, logDbError, resetDb, workspaces } from "@/lib/db";

const MAX_BYTES = 1_000_000;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspace/[id]">) {
  const { id } = await ctx.params;
  if (!isWorkspaceId(id)) return Response.json({ error: "bad_id" }, { status: 400 });
  if (!dbConfigured()) return Response.json({ error: "db_not_configured" }, { status: 503 });
  try {
    const doc = await (await workspaces()).findOne({ _id: id });
    return Response.json(doc ? { shipments: doc.shipments, file: doc.file, updatedAt: doc.updatedAt } : { shipments: null, file: null, updatedAt: null });
  } catch (e) {
    logDbError("read", e);
    resetDb(); // reconnect on the next request
    return Response.json({ error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/workspace/[id]">) {
  const { id } = await ctx.params;
  if (!isWorkspaceId(id)) return Response.json({ error: "bad_id" }, { status: 400 });
  if (!dbConfigured()) return Response.json({ error: "db_not_configured" }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  let body: { shipments?: unknown; file?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  if (!Array.isArray(body.shipments) || typeof body.file !== "object" || body.file === null)
    return Response.json({ error: "bad_body" }, { status: 400 });
  const updatedAt = new Date().toISOString();
  try {
    await (await workspaces()).updateOne({ _id: id }, { $set: { shipments: body.shipments, file: body.file, updatedAt } }, { upsert: true });
    return Response.json({ ok: true, updatedAt });
  } catch (e) {
    logDbError("write", e);
    resetDb(); // reconnect on the next request
    return Response.json({ error: "db_unavailable" }, { status: 503 });
  }
}
