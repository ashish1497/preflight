import { z } from "zod";
import { GeminiError, generateJson, type GeminiTurn } from "@/lib/gemini";
import { DEST_CITIES, ORIGIN_CITIES, ORIGIN_COUNTRIES_OF_GOODS } from "@/lib/reference";

export const maxDuration = 60;

const n = z.number().nullable();
const s = z.string().nullable();

const Extraction = z.object({
  reply: z.string(),
  booking: z.object({
    sellerName: s,
    originCity: z.enum(ORIGIN_CITIES as [string, ...string[]]).nullable(),
    destCity: z.enum(Object.keys(DEST_CITIES) as [string, ...string[]]).nullable(),
    destType: z.enum(["Warehouse", "Business address"]).nullable(),
    readyDate: s,
    neededBy: s,
    priority: z.enum(["Cheapest", "Fastest", "Most reliable", "Balanced"]).nullable(),
    pallets: n,
    cartons: n,
    declaredValue: n,
    grossWeight: n,
    appointment: z.boolean().nullable(),
    incoterm: z.enum(["DAP", "DDP"]).nullable(),
    exporterEori: s,
    consigneeName: s,
    consigneeAddress: s,
  }),
  items: z.array(
    z.object({
      action: z.enum(["add", "update", "remove"]),
      match: s,
      sku: s,
      description: s,
      hsCode: s,
      hsIsSuggestion: z.boolean(),
      quantity: n,
      unitPrice: n,
      unitsPerCarton: n,
      cartons: n,
      unitWeight: n,
      countryOfOrigin: z.enum(ORIGIN_COUNTRIES_OF_GOODS as [string, ...string[]]).nullable(),
    }),
  ),
});

const SYSTEM = `You turn a seller's chat messages into booking fields for a UK → EU road freight shipment.

Each turn you get the current booking draft (JSON) and the conversation. Return ONLY what the latest user message adds or changes:
- booking: set a field only if the latest message gives or changes it; otherwise null. For relative changes ("add a pallet", "make it 2 more cartons") compute the new absolute value from the draft.
- items: one entry per product mentioned. action "add" for a new product, "update" to change an existing one (set match to its SKU or description from the draft), "remove" to drop one. Unchanged fields null.
- Dates: output YYYY-MM-DD. Resolve relative dates ("next Thursday", "in a week") against today's date given below. readyDate = when goods are packed and ready for collection. neededBy = a date the seller says it must arrive by.
- Priority: map "cheap/budget/low cost" → Cheapest, "fast/urgent/asap" → Fastest, "reliable/on time/can't be late" → Most reliable, "no preference/balance/whatever's best" → Balanced.
- destType: "warehouse", "fulfilment centre", "FBA", "DC" → Warehouse; shop, office, store, customer business → Business address.
- incoterm: "DDP" if the seller says they will pay import duty/VAT or be the importer ("duty paid", "I pay the duties"); "DAP" if the receiver/customer pays duties or clears import. Copy DAP or DDP if named.
- appointment: true if they say a delivery slot/appointment is booked, false if not.
- Origin is always United Kingdom. Allowed origin cities: London, Manchester, Birmingham, Leeds. Destination cities: Berlin, Frankfurt, Hamburg (Germany), Paris, Lyon (France), Amsterdam, Rotterdam (Netherlands). If they name somewhere else, leave it null and say in reply that we only cover these cities.
- HS codes: if the seller gives one, copy its digits exactly with hsIsSuggestion false. If the seller doesn't know or didn't give one for a new product, suggest the most likely 6-digit HS 2022 subheading with hsIsSuggestion true. If they confirm a suggestion ("yes that's right"), send an update with the same code and hsIsSuggestion false.
- Never invent quantities, prices, weights or counts the seller didn't say.
- booking.cartons, booking.declaredValue and booking.grossWeight: ONLY when the seller states that total themselves ("90 boxes in total", "worth £5,400", "weighs 620 kg"). Never calculate them from items; the app does that. Unit weight ("half a kilo each") goes on the item, not grossWeight.
- item.cartons only if the seller says how many cartons/boxes of that product; don't calculate it.
- Don't flag rule problems yourself (dangerous goods, mismatched totals): the app checks those.

reply: one or two short, friendly sentences acknowledging what you understood or changed (e.g. "Got it, 4 pallets now."). Never say the shipment is booked or confirmed; the seller confirms in the app. Do NOT ask questions; the app asks for missing details itself.`;

// Gemini takes JSON Schema; nullable fields come out as anyOf [type, null].
const SCHEMA = z.toJSONSchema(Extraction, { target: "draft-2020-12" });
delete (SCHEMA as Record<string, unknown>).$schema;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) return Response.json({ error: "bad_request" }, { status: 400 });

  const turns: GeminiTurn[] = body.messages
    .slice(-16)
    .filter((m: { role: string; content: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m: { role: string; content: string }) => ({ role: m.role === "user" ? "user" : "model", text: m.content.slice(0, 4000) }));
  // The conversation must start with a user turn.
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length) return Response.json({ error: "bad_request" }, { status: 400 });

  const last = turns[turns.length - 1];
  if (last.role === "user")
    last.text = `Today is ${body.today}.\nCurrent draft:\n${JSON.stringify(body.draft ?? {})}\n\nLatest message:\n${last.text}`;

  try {
    const raw = await generateJson({ system: SYSTEM, turns, schema: SCHEMA });
    const parsed = Extraction.safeParse(raw);
    if (!parsed.success)
      return Response.json({ error: "parse_failed", message: "I didn't quite get that. Could you rephrase?" }, { status: 502 });
    return Response.json({ extraction: parsed.data });
  } catch (error) {
    if (error instanceof GeminiError) {
      if (error.message === "no_key")
        return Response.json({ error: "no_key", message: "The AI assistant isn't configured. You can fill the booking card directly." }, { status: 503 });
      if (error.status === 429)
        return Response.json({ error: "busy", message: "The assistant is busy. Try again in a few seconds, or edit the booking card directly." }, { status: 429 });
      return Response.json({ error: "api", message: "The assistant is unavailable right now. You can edit the booking card directly." }, { status: 502 });
    }
    throw error;
  }
}
