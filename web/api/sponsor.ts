/// <reference types="node" />
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";

// Server-side gas sponsor proxy backed by Shinami's Sui Gas Station. The Shinami access key is a
// SECRET — it can spend our gas fund — so unlike the public Enoki key it must never reach the
// browser; this serverless function holds it (SHINAMI_KEY env) and the frontend only ever posts
// transaction bytes here. On testnet the fund is pre-seeded with free SUI by Shinami, so a zkLogin
// user pays zero SUI. Same code serves mainnet: swap SHINAMI_KEY (a mainnet key) and the URL's
// region/network, and keep the fund topped up. See docs/OPERATING.md §2.
//
// Shinami has no built-in move-call allowlist (Enoki did), so we enforce one here: only this
// package's register_meter / respond may be sponsored. Without it, anyone could point this endpoint
// at an arbitrary transaction and drain the fund.
const SHINAMI_URL = "https://api.us1.shinami.com/sui/gas/v1";
const SPONSORABLE = new Set(["register_meter", "respond"]);

// Mirrors web/src/lib/config.ts. Inlined (not imported) because Vercel compiles functions with
// nodenext resolution, which rejects extensionless cross-directory imports; these change only on a
// fresh package publish (see docs/DEPLOY.md), the same time config.ts is updated.
const PACKAGE_ID =
  "0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964";
const MODULE = "voltray";

// Minimal shape of Vercel's Node.js function args (we use only these fields). We use the Node
// (req, res) signature, NOT the Web Request/Response one: @vercel/node invokes functions this way
// for a Vite project, and a Web-style handler crashes at runtime with FUNCTION_INVOCATION_FAILED.
type Req = { method?: string; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => Res };

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const key = process.env.SHINAMI_KEY;
    if (!key)
      return res.status(500).json({ error: "SHINAMI_KEY not configured" });

    const { transactionKindBytes, sender } = (req.body ?? {}) as {
      transactionKindBytes?: string;
      sender?: string;
    };
    if (typeof transactionKindBytes !== "string" || typeof sender !== "string")
      return res
        .status(400)
        .json({ error: "transactionKindBytes and sender are required" });

    // Every command must be a MoveCall into one of this package's sponsorable entry functions.
    const commands = Transaction.fromKind(
      fromBase64(transactionKindBytes),
    ).getData().commands;
    const sponsorable = commands.every(
      (c) =>
        c.$kind === "MoveCall" &&
        c.MoveCall.package === PACKAGE_ID &&
        c.MoveCall.module === MODULE &&
        SPONSORABLE.has(c.MoveCall.function),
    );
    if (!sponsorable)
      return res.status(403).json({ error: "transaction is not sponsorable" });

    // Omitting gasBudget lets Shinami auto-budget (estimate + buffer); the fund pays the gas.
    const rpc = await fetch(SHINAMI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "gas_sponsorTransactionBlock",
        params: [transactionKindBytes, sender],
      }),
    });
    const json = await rpc.json();
    if (json.error)
      return res.status(502).json({ error: json.error.message });

    const { txBytes, signature } = json.result;
    return res.status(200).json({ txBytes, signature });
  } catch (e) {
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
