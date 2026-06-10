import {
  ArrowRight,
  Banknote,
  Building2,
  Coins,
  Eye,
  Layers,
  Plug,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GITHUB_URL, TRUST_DOC_URL } from "../lib/config";
import { VoltrayMark } from "@/components/Logo";

// lucide-react dropped brand marks, so the GitHub logo is an inline SVG.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const STEPS = [
  {
    icon: Building2,
    title: "Utility posts an event",
    body: "A utility opens a demand-response window and pre-funds a USDC reward vault on-chain. The funds are locked to that one event.",
  },
  {
    icon: Plug,
    title: "Users respond",
    body: "Anyone registers a smart meter and opts in during the window. Each response is a public, timestamped on-chain event.",
  },
  {
    icon: Coins,
    title: "Oracle settles in USDC",
    body: "After the window, an oracle verifies the reduction and pays each participant from the vault in USDC. Unspent funds return to the utility.",
  },
];

const FEATURES = [
  {
    icon: Banknote,
    title: "Stable USDC rewards",
    body: "Payouts are denominated in USDC, so a kWh saved is worth the same tomorrow — no token-price roulette.",
  },
  {
    icon: Eye,
    title: "Auditable by design",
    body: "Every event, response, and payout is an on-chain event. Anyone can reconstruct who was paid what, and why.",
  },
  {
    icon: Layers,
    title: "Built for scale",
    body: "No growing participant list lives in shared state, so responses never contend on a global lock — settlement stays cheap as events grow.",
  },
  {
    icon: RotateCcw,
    title: "Funds you can reclaim",
    body: "Locked too much? Once the window closes, the utility recovers the unspent balance in a single transaction.",
  },
];

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="space-y-24 pb-12">
      {/* Hero */}
      <section className="relative flex flex-col items-center pt-10 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="relative flex flex-col items-center gap-6 duration-700 animate-in fade-in slide-in-from-bottom-3">
          <span className="flex size-20 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <VoltrayMark className="size-12" />
          </span>
          <Badge variant="secondary" className="gap-1.5">
            Sui Overflow 2026 · DeFi &amp; Payments
          </Badge>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Get paid to ease the grid.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            Voltray is on-chain demand response: utilities pre-fund reward
            vaults, people cut consumption when the grid is stressed, and
            payouts settle automatically in USDC on Sui.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button className="h-11 px-6 text-base" onClick={onLaunch}>
              Launch app <ArrowRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="h-11 px-6 text-base"
              render={
                <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" />
              }
            >
              <GithubMark className="size-4" /> GitHub
            </Button>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Peak demand is the grid's most expensive problem.
        </h2>
        <p className="mt-4 text-muted-foreground">
          When everyone draws power at once, utilities fire up costly peaker
          plants or risk blackouts. Paying consumers to cut load — demand
          response — is cheaper than any power plant, but today it settles
          through opaque intermediaries, slow reconciliation, and trust you
          can't audit.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          How it works
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="relative">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Why it works on Sui
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardContent className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="font-medium">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.body}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Trust teaser */}
      <section className="mx-auto max-w-3xl">
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </span>
            <div className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">
                We don't hand-wave the oracle problem.
              </h2>
              <p className="text-sm text-muted-foreground">
                The hard part of any energy-DR system is proving a real-world
                reduction actually happened. Voltray is explicit about what the
                chain guarantees — structural correctness — versus what it must
                trust — the meter reading — and ships a trust-minimization
                roadmap: hardware-signed readings → issuer attestation →
                multisig / staked settlers → TEE, with real-world integration
                through OCPP / OCPI.
              </p>
              <a
                href={TRUST_DOC_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Read the trust model <ArrowRight className="size-4" />
              </a>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer CTA */}
      <section className="flex flex-col items-center gap-5 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Try it on Sui Testnet.
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button className="h-11 px-6 text-base" onClick={onLaunch}>
            Launch app <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-11 px-6 text-base"
            render={
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" />
            }
          >
            <GithubMark className="size-4" /> View source
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Hackathon MVP · Sui Testnet · rewards in test USDC
        </p>
      </section>
    </div>
  );
}
