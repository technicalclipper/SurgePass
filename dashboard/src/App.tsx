import { useEffect, useState } from "react";
import { admin, GATEWAY, getToken, setToken } from "./lib/api";
import { useLive } from "./lib/live";
import { Compare } from "./pages/Compare";
import { DropsPage } from "./pages/Drops";
import { Demo } from "./pages/Demo";
import { Proofs, Routes, Traffic } from "./pages/Other";
import { Overview } from "./pages/Overview";
import { PartnersPage } from "./pages/Partners";
import { LiveGate } from "./pages/LiveGate";
import { Btn, inputCls } from "./ui/console";

// SurgePass provider console.

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "compare", label: "Compare" },
  { id: "routes", label: "Routes" },
  { id: "normal", label: "Drops · Normal" },
  { id: "premium", label: "Drops · Premium" },
  { id: "partnerdrops", label: "Drops · Partner" },
  { id: "partners", label: "Partners" },
  { id: "gate", label: "Live gate" },
  { id: "traffic", label: "Traffic" },
  { id: "proofs", label: "Proofs" },
  { id: "demo", label: "Demo screen" },
] as const;
type Page = (typeof NAV)[number]["id"];

function usePage(): [Page, (p: Page) => void] {
  const read = () => ((location.hash.slice(1) || "overview") as Page);
  const [p, setP] = useState<Page>(read);
  useEffect(() => {
    const on = () => setP(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [p, (x) => (location.hash = x)];
}

export function App() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    admin("/health").then(
      () => setOk(true),
      () => setOk(false),
    );
  }, []);
  if (ok === null) return null;
  if (!ok) return <Login onDone={() => setOk(true)} />;
  return <Shell />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState(getToken());
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid min-h-screen place-items-center bg-gray-50">
      <form
        className="w-full max-w-sm rounded-3xl bg-gray-0 p-8 shadow-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setToken(t);
          try {
            await admin("/health");
            onDone();
          } catch {
            setErr("That token didn't work.");
          }
        }}
      >
        <Logo />
        <div className="mt-6 text-2xl font-semibold">Provider console</div>
        <div className="mt-1 text-sm text-gray-500">Gateway {GATEWAY}</div>
        <input type="password" placeholder="Admin token" value={t} onChange={(e) => setT(e.target.value)} className={`${inputCls} mt-6 w-full`} />
        {err && <div className="mt-2 text-sm text-error-600">{err}</div>}
        <div className="mt-6">
          <Btn type="submit">Sign in</Btn>
        </div>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-gray-0">S</span>
      <span className="text-base font-semibold tracking-[-0.01em]">SurgePass</span>
    </div>
  );
}

function Shell() {
  const [page, setPage] = usePage();
  const live = useLive();
  if (page === "demo") return <Demo />;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-gray-100 bg-gray-0 p-4">
        <div className="px-2 py-2">
          <Logo />
        </div>
        <div className="mt-1 px-2 font-mono text-2xs text-gray-500">{new URL(GATEWAY).host}</div>
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`h-10 rounded-xl px-3 text-left text-sm font-medium transition ${page === n.id ? "bg-gray-900 text-gray-0" : "text-gray-700 hover:bg-gray-50"}`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-2 text-xs text-gray-500">
          <span className={`size-2 rounded-full ${live.connected ? "bg-success-600" : "bg-error-600"}`} />
          {live.connected ? "Live" : "Reconnecting…"}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <div className="mx-auto max-w-7xl">
          {page === "overview" && <Overview />}
          {page === "compare" && <Compare />}
          {page === "routes" && <Routes />}
          {page === "normal" && <DropsPage key="normal" pool="normal" />}
          {page === "premium" && <DropsPage key="premium" pool="premium" />}
          {page === "partnerdrops" && <DropsPage key="partner" pool="partner" />}
          {page === "partners" && <PartnersPage />}
          {page === "gate" && <LiveGate />}
          {page === "traffic" && <Traffic />}
          {page === "proofs" && <Proofs />}
        </div>
      </main>
    </div>
  );
}
