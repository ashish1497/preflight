// Client side of cloud sync. Each browser gets a random workspace ID (no login); anyone with the
// code can open the same workspace, so it's shown to the user as a private code.

const ID_KEY = "shipcheck.workspace";
const SAVED_KEY = "shipcheck.savedAt";

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export function workspaceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[a-z0-9]{24}$/.test(id)) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return randomId(); // storage blocked: a fresh workspace for this visit
  }
}

export function switchWorkspace(id: string) {
  try {
    localStorage.setItem(ID_KEY, id);
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* ignore */
  }
}

export const localSavedAt = () => {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
};
export const markLocalSaved = (iso: string) => {
  try {
    localStorage.setItem(SAVED_KEY, iso);
  } catch {
    /* ignore */
  }
};

export type CloudState = "checking" | "synced" | "saving" | "offline" | "off";

export interface Remote {
  shipments: unknown[] | null;
  file: unknown | null;
  updatedAt: string | null;
}

export async function pull(id: string): Promise<{ state: CloudState; data?: Remote }> {
  const r = await fetch(`/api/workspace/${id}`).catch(() => null);
  if (!r) return { state: "offline" };
  if (r.status === 503) {
    const e = await r.json().catch(() => ({}));
    return { state: e.error === "db_not_configured" ? "off" : "offline" };
  }
  if (!r.ok) return { state: "offline" };
  return { state: "synced", data: await r.json() };
}

export async function push(id: string, body: { shipments: unknown[]; file: unknown }): Promise<{ state: CloudState; updatedAt?: string }> {
  const r = await fetch(`/api/workspace/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { state: "offline" };
  if (r.status === 503) {
    const e = await r.json().catch(() => ({}));
    return { state: e.error === "db_not_configured" ? "off" : "offline" };
  }
  if (!r.ok) return { state: "offline" };
  const d = await r.json();
  return { state: "synced", updatedAt: d.updatedAt };
}
