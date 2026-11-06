import { useEffect, useState } from "react";
import { admin, GATEWAY, getToken, HOSTED, REPO_URL, setToken } from "./lib/api";
import { useLive } from "./lib/live";
import { Compare } from "./pages/Compare";
import { Integrate } from "./pages/Integrate";
import { Landing } from "./pages/Landing";
import { Deck } from "./pages/Deck";
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
  { id: "integrate", label: "Integrate" },
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

/** The base route (no hash) is the public landing page; every other page is the console. */
function useHash() {
  const [h, setH] = useState(() => location.hash.slice(1));
  useEffect(() => {
    const on = () => {
      setH(location.hash.slice(1));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export function App() {
  const hash = useHash();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    admin("/health").then(
      () => setOk(true),
      () => setOk(false),
    );
  }, []);
  if (location.pathname.replace(/\/+$/, "") === "/deck") return <Deck />;
  if (!hash) return <Landing />;
  if (HOSTED) return hash === "integrate" ? <PublicPage><Integrate /></PublicPage> : <HostedNotice />;
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

/** Hosted build: a light frame for the public integration guide. */
function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-gray-0/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <button onClick={() => (location.hash = "")}>
            <Logo />
          </button>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full bg-gray-900 px-5 text-sm font-semibold text-gray-0 hover:bg-gray-700">
            GitHub ↗
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}

/** Hosted build: console pages need a gateway, which runs alongside the live demo. */
function HostedNotice() {
  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 px-6">
      <div className="w-full max-w-lg rounded-3xl bg-gray-0 p-8 text-center shadow-card sm:p-10">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-8 text-3xl font-semibold tracking-[-0.02em]">The console runs next to a gateway</h1>
        <p className="mt-3 leading-compact text-gray-500">
          The provider console talks to a running SurgePass gateway: live traffic, drops, draws on Hedera and test runs. This public site has no gateway behind it, so you'll see the console in the live demo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={() => (location.hash = "")} className="inline-flex h-12 items-center rounded-full bg-gray-900 px-6 text-base font-semibold text-gray-0 hover:bg-gray-700">
            Back to home
          </button>
          <button onClick={() => (location.hash = "integrate")} className="inline-flex h-12 items-center rounded-full bg-gray-100 px-6 text-base font-semibold text-gray-900 hover:bg-gray-200">
            Integration guide
          </button>
        </div>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm font-semibold text-info-600 hover:underline">
          Code on GitHub ↗
        </a>
      </div>
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
        <button onClick={() => (location.hash = "")} className="rounded-xl px-2 py-2 text-left hover:bg-gray-50" title="SurgePass home">
          <Logo />
        </button>
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
          {page === "integrate" && <Integrate />}
          {page === "gate" && <LiveGate />}
          {page === "traffic" && <Traffic />}
          {page === "proofs" && <Proofs />}
        </div>
      </main>
    </div>
  );
}
