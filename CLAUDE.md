# Voltray

Decentralized energy Demand Response (DR) system on Sui. Utilities post DR events and pre-fund a reward vault; users register a smart meter and respond; an oracle settles payouts on-chain when participants reduce consumption.

**Status:** Hackathon project for Sui Overflow 2026 (deadline **2026-06-21**), DeFi & Payments track. MVP scope only.

---

## Key documents

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — object schema, function signatures, MVP decisions, open questions. **Read this before touching contracts.**
- [docs/TRUST.md](docs/TRUST.md) — trust model, the oracle problem, OCPP/OCPI integration paths, trust-minimisation roadmap, hosting by stage. Read this before touching the oracle or pitching the project.
- [docs/OPERATING.md](docs/OPERATING.md) — operating model: who funds it live, zkLogin/sponsored-gas onboarding, compliance posture, why-on-chain. Read this before pitching or writing go-to-market.
- [README.md](README.md) — public-facing project overview.

---

## Repo structure

```
Voltray/
├── contracts/                # Sui Move package — directory name; package name in Move.toml is "voltray"
│   ├── Move.toml             # [package] name = "voltray"
│   ├── sources/voltray.move  # All 3 structs + 4 entry functions in one file (< 200 lines)
│   └── tests/voltray_tests.move
├── web/                      # React + TS + Vite + @mysten/dapp-kit, managed with pnpm
│   └── src/
│       ├── pages/            # Dashboard, EventList, CreateEvent, EventDetail
│       └── lib/              # sui client config, queryEvents helpers, package ID
├── oracle/                   # Settlement daemon (charger-signed settle, polls Sui); deployed on Fly.io — see docs/DEPLOY.md
├── docs/
│   ├── ARCHITECTURE.md       # Contract design — source of truth before code
│   ├── TRUST.md              # Trust model, oracle problem, OCPP/OCPI integration, hosting
│   ├── OPERATING.md          # Operating model: funding, onboarding, compliance, why-on-chain
│   └── DEPLOY.md             # Testnet + Fly.io deploy steps, package ID, rename procedure
├── .gitignore
├── CLAUDE.md
└── README.md
```

**Monorepo policy: no root `package.json`, no workspace tooling.** `contracts/` (Move) and `web/` (JS) have disjoint toolchains and no shared dependencies — a workspace adds setup cost with zero hoisting benefit. Each subdirectory is self-contained.

**Scaffold commands (one-time, for reference):**
- Contracts: from repo root, `sui move new contracts`, then edit `contracts/Move.toml` to set `name = "voltray"`.
- Frontend: from repo root, `pnpm create vite web --template react-ts`, then add `@mysten/dapp-kit @mysten/sui @tanstack/react-query`.

---

## Conventions

- **Language:** all in-repo files (docs, code comments, commit messages) in **English**. Conversational chat may be in Traditional Chinese.
- **MVP-first:** prefer the simplest solution that demos. Skip generality, configurability, and abstractions that aren't strictly required. Bonus features only if the increment is small and the demo win is clear.
- **Document tradeoffs:** every "we chose X over Y for MVP" decision lives in **two places**:
  1. Inline `// TODO(post-MVP): <upgrade path>` comment in the code
  2. A row in `docs/ARCHITECTURE.md §5 MVP Decisions`

---

## Critical design rule

`DREvent` is a **Shared Object** — never store accumulating data (e.g. `vector<address>` of participants) inside it. Use Sui events (`emit MeterResponded {...}`) and let the off-chain oracle scan the event log when settling. Writing accumulating state into a Shared Object kills parallel writes and inflates gas per call. See `docs/ARCHITECTURE.md §2.2`.

---

## MVP scope

**In scope:** Move contracts (3 objects, 4 entry functions), React frontend (Dashboard / Event List / Create Event / Event Detail), Sui Testnet deployment, demo video (under 5 minutes), public GitHub repo.

**Out of scope:** Seal-encrypted consumption reports, full oracle network, marketing landing page, cross-event reputation system.
