import { useState } from "react";
import { ConnectButton } from "@mysten/dapp-kit";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EventSummary } from "./lib/suiwatt";
import Dashboard from "./pages/Dashboard";
import EventList from "./pages/EventList";
import CreateEvent from "./pages/CreateEvent";
import EventDetail from "./pages/EventDetail";

export type View = "dashboard" | "list" | "create" | "detail";

const TABS: { view: View; label: string }[] = [
  { view: "dashboard", label: "Dashboard" },
  { view: "list", label: "Events" },
  { view: "create", label: "Create Event" },
];

function App() {
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<EventSummary | null>(null);

  const openDetail = (event: EventSummary) => {
    setSelected(event);
    setView("detail");
  };

  const navActive = (v: View) => v === view || (view === "detail" && v === "list");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <button
            onClick={() => setView("dashboard")}
            className="flex items-center gap-2"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">SuiWatt</span>
          </button>

          <nav className="flex flex-1 items-center gap-1">
            {TABS.map((t) => (
              <Button
                key={t.view}
                variant={navActive(t.view) ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView(t.view)}
              >
                {t.label}
              </Button>
            ))}
          </nav>

          <ConnectButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {view === "dashboard" && <Dashboard />}
        {view === "list" && <EventList onOpen={openDetail} />}
        {view === "create" && (
          <CreateEvent
            onCreated={(event) => (event ? openDetail(event) : setView("list"))}
          />
        )}
        {view === "detail" && selected && (
          <EventDetail event={selected} onBack={() => setView("list")} />
        )}
      </main>
    </div>
  );
}

export default App;
