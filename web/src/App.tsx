import { useState } from "react";
import { ConnectButton } from "@mysten/dapp-kit";
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚡ SuiWatt</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.view}
              className={view === t.view ? "tab active" : "tab"}
              onClick={() => setView(t.view)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ConnectButton />
      </header>

      <main className="content">
        {view === "dashboard" && <Dashboard />}
        {view === "list" && <EventList onOpen={openDetail} />}
        {view === "create" && <CreateEvent onCreated={() => setView("list")} />}
        {view === "detail" && selected && (
          <EventDetail event={selected} onBack={() => setView("list")} />
        )}
      </main>
    </div>
  );
}

export default App;
