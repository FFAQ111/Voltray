/// <reference types="node" />
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";

// Mirrors web/src/lib/config.ts. Inlined (not imported) because Vercel compiles functions with
// nodenext resolution, which rejects extensionless cross-directory imports; these change only on a
// fresh package publish (see docs/DEPLOY.md), the same time config.ts is updated.
const PACKAGE_ID =
  "0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964";
const MODULE = "voltray";

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });

  const key = process.env.SHINAMI_KEY;
  if (!key)
    return Response.json({ error: "SHINAMI_KEY not configured" }, { status: 500 });

  const { transactionKindBytes, sender } = await req.json();
  if (typeof transactionKindBytes !== "string" || typeof sender !== "string")
    return Response.json(
      { error: "transactionKindBytes and sender are required" },
      { status: 400 },
    );

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
    return Response.json(
      { error: "transaction is not sponsorable" },
      { status: 403 },
    );

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
    return Response.json({ error: json.error.message }, { status: 502 });

  const { txBytes, signature } = json.result;
  return Response.json({ txBytes, signature });
}
