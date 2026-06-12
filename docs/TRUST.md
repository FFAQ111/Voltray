# Voltray Trust & Integration Model

> Where the data comes from, who you have to trust to believe it, and what it would
> take to trust them less. This is the honest companion to `ARCHITECTURE.md`: that
> document describes what the contract enforces; this one describes what it *cannot*
> enforce and why.

---

## 1. The oracle problem, stated plainly

A blockchain cannot see the physical world. Voltray pays a user for reducing grid
consumption, but "reduced consumption" is a fact about a meter in someone's garage,
not a fact the chain can check. Someone off-chain has to **attest** to it. Whoever
that someone is, they are a trust assumption.

This is unavoidable. No contract, encryption scheme, or zero-knowledge proof makes a
forged kilowatt-hour true. The honest goal is therefore not "remove trust" but
**make the trusted party as narrow, as accountable, and as expensive-to-cheat as
possible** — and to be explicit about the part that stays trusted.

So we split the system into two questions:

- **Structural correctness** — what the contract *can* guarantee on-chain.
- **Physical truth** — what only an off-chain attestation can supply.

The contract is already strong on the first and silent on the second. The rest of
this document is about the second.

---

## 2. What the contract already guarantees (structural)

These hold regardless of who the oracle is, enforced in `contracts/sources/voltray.move`:

| Invariant | Mechanism |
|---|---|
| Only the event's funder can settle | `assert!(ctx.sender() == event.utility)` (E_NOT_UTILITY) |
| A settle call cannot drain an unrelated vault | `assert!(vault.event_id == object::id(event))` (E_WRONG_VAULT) |
| No response is paid twice | per-`meter_id` dynamic field on the vault (E_ALREADY_SETTLED) |
| No meter responds twice to one event | per-`event_id` dynamic field on the owned meter (E_ALREADY_RESPONDED) |
| Payout never exceeds the pre-funded pool | FCFS draw-down of `remaining_units`, capped balance |
| Only the meter owner can respond for it | `assert!(meter.owner == ctx.sender())` (E_NOT_METER_OWNER) |
| `saved_units` must be signed by the event's authorised charger | `ed25519_verify` over `(event_id, meter_id, responder, saved_units)` against `DREvent.charger_pubkey` (E_BAD_SIGNATURE) |

None of these say the kWh number is real. They say nobody can be paid twice, out of
turn, or from money that was never deposited. That is the floor, not the ceiling.

---

## 3. The three trust layers (and where each can be forged)

Between a real charging session and an on-chain payout there are three places a lie
can enter.

### 3.1 Meter identity — *is this really the user's meter?*

- **Today:** `SmartMeter.label` is a free-form string. No hardware binding. Anyone can
  register a meter claiming to be any device.
- **Why it is tolerable for now:** `respond()` pays nothing. Registering a fake meter
  only buys you the right to *pledge*; the value gate is at `settle`, which needs a
  matching session (§3.2). A fake meter with no session earns nothing.
- **Hardening path:** bind the meter to a hardware-signed serial or an attested device
  key at registration, so a meter id corresponds to a physical unit, not a label.

### 3.2 Session authenticity — *did this charge actually happen, for this energy?*

This is the load-bearing layer. `saved_units` is the energy of a charging session.

- **Today (MVP):** the reading is **signed by the event's authorised charger key and
  verified on-chain** before payout (§5.1, shipped). The operator can no longer type an
  arbitrary `saved_units` — `settle` rejects anything not signed by the charger. The
  sessions themselves are still synthesised by `oracle/src/simulator.ts` and signed by a
  demo charger key the oracle holds, so what stays trusted has narrowed from "the operator's
  word" to "the charger key": whoever holds that key can still sign a false reading. The demo
  proves the *mechanism*; real key custody is the next layer.
- **Hardening path:** move the charger key into tamper-resistant hardware / a TEE so a signed
  reading also attests the firmware that produced it (§5.4), and feed real CDRs (§6) instead of
  the simulator. Then trust rests on "the chip signed it," not "the operator holds the key."

### 3.3 Oracle honesty — *does the settler report truthfully?*

- **Today (MVP):** `settle` is admin-only; the oracle holds the utility's key and
  decides who gets paid. Single trusted key.
- **Hardening path:** require M-of-N oracle signatures or a multisig, so no single key
  can settle a lie. Eventually, stake-and-slash so a caught lie costs money (§5).

---

## 4. The last-mile problem (the part that stays hard)

Pushing trust down to "the charger's metering chip signs the reading" narrows the
attack surface a lot, but it does not close it. A physically tampered charger — a
modified meter chip, or false readings fed in *before* the chip signs — produces a
**validly signed false record**. The chain will accept it because the signature checks
out.

There is no purely on-chain fix for this. What exists is a set of ways to make it
**expensive and detectable**, not impossible:

- Tamper-evident enclosures; metering and communication on separate chips so the
  metering key never leaves the meter.
- Periodic remote attestation of charger firmware.
- Cross-checking metered totals against grid-level / substation data.
- Economic skin in the game: an operator bond that is slashed on a proven discrepancy.

> **Note for reviewers:** encryption (e.g. Seal) does **not** solve this. Encryption
> hides a reading from eavesdroppers; it does not make the reading true. A clear-eyed
> design says so instead of gesturing at "we'll encrypt it."

---

## 5. Roadmap: trust-minimisation in order of cost

Each step is independently shippable. We implement (1) for the hackathon and document
the rest as the path a mainnet pilot would walk.

### 5.1 Charger-signed sessions, verified on-chain  *(shipped)*

- The charger holds an ed25519 key and signs `event_id ‖ meter_id ‖ responder ‖ saved_units`
  (`oracle/src/signer.ts`).
- `create_event` registers the authorised `charger_pubkey` on the `DREvent` (one key per event
  for the MVP). `settle` takes the signature, rebuilds the message, and verifies it with
  `sui::ed25519::ed25519_verify` against that key (E_BAD_SIGNATURE) **before** paying.
- A session with no valid charger signature is rejected on-chain — the operator can no
  longer pay an arbitrary number.
- *Implementation note:* the fiddly part was byte-for-byte agreement between the TypeScript
  signer and the Move verifier on the serialised message (u64 little-endian, 32-byte ids/address).
  Covered by a Move test against an RFC-8032 vector plus a bad-signature reject test, and verified
  end-to-end on testnet. **Next steps:** authorise a *set* of charger keys per event, and bind a
  meter to its charger (§3.1) so a key can't sign for a meter it doesn't own.

### 5.2 Multiple oracles / multisig settlement

Replace the single admin key with M-of-N. No one key can settle alone.

### 5.3 Stake-and-slash

The settler posts a bond; a proven false settlement (via a dispute window or
grid cross-check) slashes it. Turns honesty from a request into an incentive.

### 5.4 TEE / hardware attestation

Run the metering/attestation in a TEE (Nitro Enclave, SGX) so the signed reading
carries an attestation of the code that produced it. Heaviest to build; real hardware
and attestation-verification plumbing required. Roadmap, not MVP.

---

## 6. How Voltray actually plugs into the real world

The most common misread of this project is "you need to own chargers." You do not.
You integrate at the **data layer**, and the protocol you integrate with is **not the
one most people name first**.

### 6.1 OCPP vs OCPI — the distinction that matters

- **OCPP (Open Charge Point Protocol)** is the language between a **charger and its own
  backend** (the CSMS — Charging Station Management System). It is *internal* to a
  charge-point operator. The session record we care about is the
  `StopTransaction` (OCPP 1.6) / `TransactionEvent(Ended)` (2.0.1) message: charger id,
  energy delivered (Wh), start/end timestamps. `oracle/src/simulator.ts` mimics exactly
  this record.
- **OCPI (Open Charge Point Interface)** is the language between a **CPO and a third
  party** — roaming hubs, e-mobility providers, and settlement layers like Voltray. Its
  **CDR (Charge Detail Record)** is the billing-grade record of one completed session.

**So the realistic integration is OCPI, not OCPP.** To act as a settlement layer you
consume CDRs from a CPO; you do not stand up a CSMS or speak OCPP to chargers (unless
you run your own pilot site — see below).

### 6.2 OCPP 2.0.1 is also an actuation layer

Worth knowing, even if out of scope: OCPP 2.0.1's `SetChargingProfile` lets a backend
command a charger's power limit and schedule — including curtailing to zero. So EV
charging is not only the *cleanest place to measure* demand response (one metered load,
one known window, no whole-home counterfactual baseline), it is also a place DR can be
*actuated*, not just measured after the fact.

### 6.3 The three integration paths, by real-world difficulty

| Path | You connect to | You receive | Reality |
|---|---|---|---|
| Direct OCPP | Your own CSMS; chargers connect to you | Raw OCPP messages | Only for a self-run or partnered single site; needs a site host |
| **OCPI (recommended)** | A CPO's backend | **CDRs** | The standard third-party hook |
| Roaming hub | Hubject / an OCPI hub | CDRs across many CPOs | Reach many operators at once; a commercial deal |

### 6.4 The honest go-to-market gap

Plugging in is a business problem, not a code problem. You need a CPO willing to share
CDRs over OCPI, or one site to run a direct-OCPP pilot. This is a chicken-and-egg:
no rewards volume → no operator interest, and vice-versa. The pitch is not "this is
solved" — it is "the integration surface is a known, standard protocol (OCPI/CDR), and
the first pilot is one operator conversation, not a platform rebuild."

---

## 7. Deployment & hosting (when it becomes a service)

For the demo there is no backend: the dApp reads the Sui RPC directly and `settle` is
run by hand (`oracle/`). A backend only appears when settlement becomes automatic.
Match the host to the stage — do not start on the heaviest option.

### 7.1 What the future backend actually does

| Job | Shape | Note |
|---|---|---|
| Auto-settlement | periodic (check every N min) | does **not** need a 24/7 connection |
| Watch on-chain events | poll `suix_queryEvents` (cron-friendly) **or** subscribe over WS (needs always-on) | prefer polling to stay serverless |
| Pull OCPI CDRs | periodic | a scheduled fetch from the CPO |
| CSMS | always-on WebSocket server | **only** if running a direct-OCPP pilot |

The dividing line: everything except a CSMS can run on scheduled/serverless compute.
Going the OCPI route means you never run a CSMS, so you rarely need an always-on box.

### 7.2 Hosting by stage

| Stage | Host | Why |
|---|---|---|
| Demo | manual `pnpm settle`, or the Fly.io worker below | a cloud deploy is optional here, not required |
| Post-hackathon pilot *(current)* | **Fly.io** — one always-on worker (`oracle/src/daemon.ts`, 30 s poll), secrets in the Fly secret store | fastest to stand up, lightest to operate (see DEPLOY.md "Oracle deployment") |
| Scale / compliance | **AWS** — Lambda + EventBridge for settlement, Fargate/EC2 only if a CSMS is needed, KMS for keys | AWS earns its operational weight at scale, not before |

### 7.3 The security red line

The utility key must never sit in plaintext env on a host. Use the platform secret
store at minimum, KMS/Secrets Manager properly. The real fix is §5.2: once settlement
is M-of-N, there is no single hot key to steal. Hosting choice does not solve key
custody — removing the single key does.

*Where we are:* the deployed worker keeps both hot keys (utility + charger) in Fly's
secret store — encrypted at rest, injected as env at runtime, excluded from the image
(`oracle/.dockerignore`). That meets the "platform secret store at minimum" bar and no
more: a single stolen key still settles lies until §5.2 lands.

### 7.4 The landing page needs no backend

A project/marketing page is static hosting (the dApp already has no server — it talks
to the Sui RPC). "Static" does not mean "no animation": JS/CSS animations run in the
browser on top of static files. Contact forms and analytics use third parties
(Formspree, Plausible), not a server you operate. Frontend code is public by design;
the only rule is that no secret — above all the utility key — is ever bundled into it.
