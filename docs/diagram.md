# Preflight — diagrams (Mermaid)

## (a) The pre-flight loop

```mermaid
flowchart LR
  subgraph Capture["Capture"]
    T[Type]:::input
    V[Talk - optional]:::input
    F[Drop a booking file]:::input
  end

  U["Understand<br/><small>AI: text / speech → fields, suggestions<br/>never decides pass or fail</small>"]:::ai
  C["Check<br/><small>11 deterministic checks<br/>+ official UK Trade Tariff data</small>"]:::rules
  R["Recommend<br/><small>carrier + reason<br/>one-click fixes</small>"]:::rules
  H["Confirm<br/><small>you fix, acknowledge, decide</small>"]:::human
  O["Follow-through<br/><small>documents · alerts · Shipments dashboard</small>"]:::out

  T --> U
  V --> U
  F --> C
  U --> C --> R --> H --> O
  C -. "every change re-runs everything" .-> Capture

  C --- G1["Blocker<br/><small>stops confirm</small>"]:::red
  C --- G2["Warning<br/><small>needs a tick</small>"]:::amber
  C --- G3["Task<br/><small>owner + deadline</small>"]:::task
  C --- G4["Advisory<br/><small>source shown, never blocks</small>"]:::grey

  classDef input fill:#ffffff,stroke:#0b1f3a,color:#0b1f3a
  classDef ai fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef rules fill:#ccfbf1,stroke:#0f766e,color:#134e4a
  classDef human fill:#0b1f3a,stroke:#0b1f3a,color:#ffffff
  classDef out fill:#f5f7fa,stroke:#94a3b8,color:#0f172a
  classDef red fill:#fef2f2,stroke:#dc2626,color:#991b1b
  classDef amber fill:#fffbeb,stroke:#d97706,color:#92400e
  classDef task fill:#f0fdfa,stroke:#0f766e,color:#134e4a
  classDef grey fill:#f8fafc,stroke:#94a3b8,color:#334155
```

**Roles:** AI understands · Rules check · You decide. Files go straight to Check (no AI needed to read a structured sheet).

## (b) Where Preflight sits in the value chain

```mermaid
flowchart TB
  L1["1 Product & order data<br/><small>Seller: SKUs, HS codes, origin, prices, weights</small>"]:::made
  L2["2 Booking & planning<br/><small>Seller → forwarder: route, pallets, dates, carrier</small>"]:::made
  L3["3 Documents & compliance<br/><small>Seller / broker: invoice, packing list, origin, EORI, licences</small>"]:::made
  GATE{{"PRE-FLIGHT GATE<br/>Preflight checks here"}}:::gate
  L4["4 Collection & UK export<br/><small>Carrier, export broker: pickup, export declaration, border reference</small>"]:::flow
  L5["5 Border & EU import<br/><small>Broker, EU customs: pre-arrival filing, declaration, duty, holds</small>"]:::found
  L6["6 Delivery & receiving<br/><small>Carrier, warehouse: slot, count vs packing list</small>"]:::found
  L7["7 After delivery<br/><small>Seller, warehouse: proof of delivery, claims, reconciliation</small>"]:::flow

  L1 --> L2 --> L3 --> GATE --> L4 --> L5 --> L6 --> L7
  L1 -. "errors made here" .-> GATE
  L5 -. "today: errors found here, days later" .-> L5

  classDef made fill:#fef2f2,stroke:#dc2626,color:#7f1d1d
  classDef found fill:#fffbeb,stroke:#d97706,color:#78350f
  classDef flow fill:#f8fafc,stroke:#94a3b8,color:#0f172a
  classDef gate fill:#0f766e,stroke:#0b1f3a,color:#ffffff
```

**Reading it:** Preflight works in layers 1–3 and at the gate before collection. It doesn't move goods, file declarations or pay duty (layers 4–5); it hands carriers and brokers clean data so the holds in layers 5–6 don't happen.
