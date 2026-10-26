// Server-only MongoDB access. One document per workspace (an anonymous, per-browser ID).
// Env: MONGODB_URI (may contain <db_password> / <password>), MONGODB_PASSWORD, MONGODB_DB.
import { MongoClient, type Collection } from "mongodb";

export interface WorkspaceDoc {
  _id: string;
  shipments: unknown[];
  file: unknown;
  updatedAt: string; // ISO timestamp
}

function connectionString(): string | null {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return null;
  const pw = process.env.MONGODB_PASSWORD;
  // Atlas hands out strings like mongodb+srv://user:<db_password>@cluster/...
  return pw ? uri.replace(/<db_password>|<password>/g, encodeURIComponent(pw)) : uri;
}

export const dbConfigured = () => !!connectionString();

// Reuse one client across hot reloads and serverless invocations, keyed by connection string so
// a changed .env (or a dead server) gets a fresh client.
const g = globalThis as unknown as { _shipcheckMongo?: { uri: string; client: Promise<MongoClient> } };

export function resetDb() {
  const old = g._shipcheckMongo;
  g._shipcheckMongo = undefined;
  old?.client.then((c) => c.close()).catch(() => {});
}

export async function workspaces(): Promise<Collection<WorkspaceDoc>> {
  const uri = connectionString();
  if (!uri) throw new Error("db_not_configured");
  if (g._shipcheckMongo?.uri !== uri) {
    resetDb();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 }).connect();
    g._shipcheckMongo = { uri, client };
    client.catch(() => {
      if (g._shipcheckMongo?.client === client) g._shipcheckMongo = undefined; // try again next request
    });
  }
  const client = await g._shipcheckMongo!.client;
  return client.db(process.env.MONGODB_DB || "shipcheck").collection<WorkspaceDoc>("workspaces");
}

/** Log a database error without leaking credentials. */
export function logDbError(where: string, e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[db] ${where}:`, msg.replace(/mongodb(\+srv)?:\/\/[^@\s]*@/g, "mongodb$1://***@").slice(0, 400));
}

/** Workspace IDs are random 24-char base36 strings made in the browser. */
export const isWorkspaceId = (id: string) => /^[a-z0-9]{24}$/.test(id);
