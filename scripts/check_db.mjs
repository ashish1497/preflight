// Checks the MongoDB settings in .env.local: connect, ping, write/read/delete a test document.
// Run: node scripts/check_db.mjs
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
let uri = env.MONGODB_URI;
if (env.MONGODB_PASSWORD) uri = uri.replace(/<db_password>|<password>/g, encodeURIComponent(env.MONGODB_PASSWORD));
const t0 = Date.now();
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(env.MONGODB_DB || "shipcheck");
  const ping = await db.command({ ping: 1 });
  console.log("connect+ping:", ping.ok === 1 ? "OK" : ping, `${Date.now() - t0} ms`, "| db:", db.databaseName);
  const col = db.collection("workspaces");
  const id = "zzverify" + Date.now().toString(36).padStart(16, "0").slice(-16);
  await col.insertOne({ _id: id, shipments: [], file: { bookings: [], warnings: [], fileName: null }, updatedAt: new Date().toISOString() });
  const back = await col.findOne({ _id: id });
  await col.deleteOne({ _id: id });
  console.log("write/read/delete:", back ? "OK" : "FAILED");
  console.log("existing workspaces:", await col.countDocuments());
} catch (e) {
  console.log("FAILED:", e.name, "-", (e.message || "").replace(/mongodb(\+srv)?:\/\/[^@]*@/g, "mongodb://***@").slice(0, 300));
} finally {
  await client.close();
}
