import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { REPO_URL } from "../lib/api";

// Pitch deck at /deck. Slides are drawn on a fixed 1600×900 canvas and scaled to the window.
// ← / → / space to move, F for full screen; the slide number lives in the URL hash (/deck#3).

const W = 1600;
const H = 900;

const SLIDES: { id: string; dark?: boolean; render: () => ReactNode }[] = [
  { id: "title", render: () => <Title /> },
  { id: "problem", render: () => <Problem /> },
  { id: "why", render: () => <Why /> },
  { id: "architecture", render: () => <Architecture /> },
  { id: "world", render: () => <World /> },
  { id: "hedera", dark: true, render: () => <HederaCore /> },
  { id: "partners", render: () => <Partners /> },
  { id: "drop", render: () => <DropOnHedera /> },
  { id: "close", dark: true, render: () => <Close /> },
];

const readIndex = () => {
  const n = Number(location.hash.slice(1));
  return Number.isInteger(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0;
};

export function Deck() {
  const [i, setI] = useState(readIndex);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Follow the address bar too (typing /deck#5 jumps there).
  useEffect(() => {
    const on = () => setI(readIndex());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    history.replaceState(null, "", `#${i + 1}`);
    document.title = `SurgePass · ${i + 1}/${SLIDES.length}`;
  }, [i]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) setI((x) => Math.min(SLIDES.length - 1, x + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setI((x) => Math.max(0, x - 1));
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(SLIDES.length - 1);
      else if (e.key === "f" || e.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const s = SLIDES[i]!;
  return (
    <div className={`fixed inset-0 overflow-hidden transition-colors duration-500 ${s.dark ? "bg-gray-900" : "bg-gray-0"}`}>
      <div style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }} className="absolute left-1/2 top-1/2">
        <AnimatePresence mode="wait">
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className={`absolute inset-0 ${s.dark ? "text-gray-0" : "text-gray-900"}`}
          >
            {s.render()}
          </motion.div>
        </AnimatePresence>
        <Footer n={i + 1} dark={!!s.dark} />
      </div>
      {/* click zones and controls, outside the scaled canvas so they stay usable */}
      <button aria-label="Previous slide" onClick={() => setI((x) => Math.max(0, x - 1))} className="absolute inset-y-0 left-0 w-[12%] cursor-w-resize" />
      <button aria-label="Next slide" onClick={() => setI((x) => Math.min(SLIDES.length - 1, x + 1))} className="absolute inset-y-0 right-0 w-[12%] cursor-e-resize" />
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-500/15">
        <motion.div className={`h-full ${s.dark ? "bg-gray-0" : "bg-gray-900"}`} animate={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} transition={{ duration: 0.4 }} />
      </div>
    </div>
  );
}

function Footer({ n, dark }: { n: number; dark: boolean }) {
  return (
    <div className={`absolute inset-x-24 bottom-12 flex items-center justify-between text-[20px] font-medium ${dark ? "text-gray-0/40" : "text-gray-400"}`}>
      <span className="flex items-center gap-3">
        <span className={`grid size-8 place-items-center rounded-full text-[15px] font-semibold ${dark ? "bg-gray-0 text-gray-900" : "bg-gray-900 text-gray-0"}`}>S</span>
        SurgePass
      </span>
      <span className="tabular">
        {String(n).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
      </span>
    </div>
  );
}

// ── Building blocks ────────────────────────────────────────────────────────

function Frame({ eyebrow, title, children, dark = false, compact = false }: { eyebrow: string; title: ReactNode; children: ReactNode; dark?: boolean; compact?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col px-24 pb-32 pt-20">
      <div className={`text-[20px] font-semibold uppercase tracking-[0.16em] ${dark ? "text-gray-0/45" : "text-gray-400"}`}>{eyebrow}</div>
      <h2 className={`mt-4 max-w-[1400px] font-semibold leading-[1.05] tracking-[-0.03em] ${compact ? "text-[52px]" : "text-[64px]"}`}>{title}</h2>
      <div className={`min-h-0 flex-1 ${compact ? "mt-9" : "mt-12"}`}>{children}</div>
    </div>
  );
}

const Dot = ({ c }: { c: string }) => <span className={`inline-block size-4 shrink-0 rounded-full ${c}`} />;

// ── 1 · Title ──────────────────────────────────────────────────────────────

function Title() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-24 pb-16">
      <span className="inline-flex w-fit items-center gap-3 rounded-full bg-gray-100 px-6 py-2.5 text-[22px] font-medium text-gray-700">
        <Dot c="bg-success-600" /> ETHGlobal Mumbai 2026 · World ID · Hedera
      </span>
      <h1 className="mt-10 text-[200px] font-semibold leading-[0.9] tracking-[-0.055em]">SurgePass</h1>
      <p className="mt-10 max-w-[1250px] text-[52px] font-semibold leading-[1.1] tracking-[-0.02em]">
        A fair line in front of every booking rush.
        <span className="text-gray-400"> Real people get in. Bots don't.</span>
      </p>
    </div>
  );
}

// ── 2 · Problem ────────────────────────────────────────────────────────────

function Problem() {
  const items = [
    { n: "01", t: "Bots win the race", d: "Seats open at a set second. Scripts click in milliseconds; people can't compete.", c: "bg-error-600" },
    { n: "02", t: "Sites go down", d: "The whole rush hits the backend at once. Real customers get timeouts and failed payments.", c: "bg-warning-600" },
    { n: "03", t: "Quotas leak to touts", d: "Agent and partner accounts are plain keys. Reserved seats get hoarded and resold.", c: "bg-gray-900" },
  ];
  return (
    <Frame eyebrow="The problem" title={<>10:00:00. Booking opens. <span className="text-gray-400">The fastest code wins, not the person who needs the seat.</span></>}>
      <div className="grid h-full grid-cols-3 gap-8">
        {items.map((x) => (
          <div key={x.n} className="flex flex-col rounded-[36px] bg-gray-50 p-12">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[24px] text-gray-400">{x.n}</span>
              <Dot c={x.c} />
            </div>
            <div className="mt-auto text-[44px] font-semibold leading-[1.05] tracking-[-0.02em]">{x.t}</div>
            <p className="mt-5 text-[26px] leading-[1.3] text-gray-500">{x.d}</p>
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ── 3 · Why ────────────────────────────────────────────────────────────────

function Why() {
  const items = [
    { t: "It's essential access", d: "Trains home, clinic and visa slots. When bots win, people without bots lose something they need." },
    { t: "AI agents are arriving", d: "Soon every user brings an agent. Blocking automation stops working; you must know which automation has a real person behind it." },
    { t: "Fairness needs proof", d: "\"The draw was fair\" has to be something anyone can check, not a promise from the seller." },
    { t: "Providers pay for it too", d: "Outages, support load, lost sales and angry customers at their most visible moment." },
  ];
  return (
    <Frame eyebrow="Why it must be solved" title={<>Blocking bots isn't enough anymore. <span className="text-gray-400">You need to prove a real person is behind every seat.</span></>}>
      <div className="grid grid-cols-2 gap-x-16 gap-y-12">
        {items.map((x, i) => (
          <div key={x.t} className="flex gap-7">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-gray-900 text-[26px] font-semibold text-gray-0">{i + 1}</span>
            <div>
              <div className="text-[38px] font-semibold leading-[1.1] tracking-[-0.02em]">{x.t}</div>
              <p className="mt-3 text-[25px] leading-[1.35] text-gray-500">{x.d}</p>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ── 4 · Architecture ───────────────────────────────────────────────────────

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-2">
      {label && <span className="whitespace-nowrap text-[16px] font-medium text-gray-400">{label}</span>}
      <svg width="64" height="20" viewBox="0 0 64 20" className="text-gray-300">
        <path d="M0 10h58M50 3l9 7-9 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Architecture() {
  const actors = [
    { c: "bg-success-600", t: "People", d: "browser" },
    { c: "bg-purple", t: "Agents", d: "API · MCP" },
    { c: "bg-info-600", t: "Partners", d: "signed Hedera key" },
    { c: "bg-error-600", t: "Bots", d: "turned away" },
  ];
  const pipeline = ["Match route & peak", "Who is it? World ID session · agent token · partner key", "Waiting room → draw · bids · holds", "Signed pass check", "x402 for extra reads"];
  return (
    <Frame compact eyebrow="How we solve it · architecture" title={<>A reverse proxy in front of the booking site. <span className="text-gray-400">World ID proves people. Hedera keeps the record.</span></>}>
      <div className="flex h-full flex-col gap-5">
        <div className="grid grid-cols-[250px_auto_1fr_auto_290px] items-stretch">
          <div className="flex flex-col justify-center gap-3">
            {actors.map((a) => (
              <div key={a.t} className="flex items-center gap-4 rounded-2xl bg-gray-50 px-5 py-3">
                <Dot c={a.c} />
                <span>
                  <span className="block text-[22px] font-semibold leading-tight">{a.t}</span>
                  <span className="block text-[16px] text-gray-500">{a.d}</span>
                </span>
              </div>
            ))}
          </div>
          <Arrow label="booking URL" />
          <div className="rounded-[32px] bg-gray-900 px-8 py-6 text-gray-0">
            <div className="flex items-baseline justify-between">
              <span className="text-[30px] font-semibold tracking-[-0.01em]">SurgePass gateway</span>
              <span className="text-[17px] text-gray-0/50">Hono · Redis · Ed25519 passes</span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {pipeline.map((p, i) => (
                <div key={p} className="flex items-center gap-4 rounded-xl bg-gray-0/[0.07] px-4 py-2 text-[18px]">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gray-0 text-[14px] font-bold text-gray-900">{i + 1}</span>
                  {p}
                </div>
              ))}
            </div>
          </div>
          <Arrow label="+ signed header" />
          <div className="flex flex-col justify-center rounded-[32px] border-2 border-gray-200 p-7">
            <div className="text-[26px] font-semibold leading-tight">Provider's booking site</div>
            <p className="mt-3 text-[18px] leading-[1.35] text-gray-500">Own inventory, fares and checkout. Verifies X-SurgePass-Assertion in ~10 lines and caps the seats.</p>
          </div>
        </div>
        <div className="ml-[314px] mr-[354px] grid grid-cols-2 gap-6">
          <div className="rounded-[28px] bg-success-100 px-6 py-5">
            <div className="flex items-center gap-3 text-[24px] font-semibold text-success-700">
              <Dot c="bg-success-600" /> World ID
            </div>
            <p className="mt-2 text-[18px] leading-[1.35] text-gray-700">Proof of human per drop, verified with the World Developer Portal. One person, one entry. Approves agents.</p>
          </div>
          <div className="rounded-[28px] bg-info-100 px-6 py-5">
            <div className="flex items-center gap-3 text-[24px] font-semibold text-info-700">
              <Dot c="bg-info-600" /> Hedera
            </div>
            <p className="mt-2 text-[18px] leading-[1.35] text-gray-700">Every entry and result on HCS, PRNG seed, partner seats on HTS, refunds by schedule, x402 payments.</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── 5 · World ID ───────────────────────────────────────────────────────────

function World() {
  const steps = [
    ["Gateway signs a one-time request", "for the action enter:<drop>, with a nonce that can't be replayed"],
    ["The person scans with World App", "proof of human; nothing about who they are is shared"],
    ["Verified by the World Developer Portal", "v4 verify, pinned to production World App"],
    ["Nullifier → anonymous ID for this drop", "same person again = same ID → refused as a duplicate"],
  ];
  return (
    <Frame compact eyebrow="How we use World" title={<>World ID: one human, one entry. <span className="text-gray-400">No name, no phone number, no ID document.</span></>}>
      <div className="grid h-full grid-cols-[1.25fr_1fr] gap-10">
        <div className="flex flex-col gap-4">
          {steps.map(([t, d], i) => (
            <div key={t} className="flex items-center gap-6 rounded-[28px] bg-gray-50 px-8 py-5">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-gray-900 text-[22px] font-semibold text-gray-0">{i + 1}</span>
              <span>
                <span className="block text-[28px] font-semibold leading-tight tracking-[-0.01em]">{t}</span>
                <span className="mt-1 block text-[20px] text-gray-500">{d}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex-1 rounded-[32px] bg-purple-soft p-9">
            <div className="flex items-center gap-3 text-[26px] font-semibold text-purple">
              <Dot c="bg-purple" /> Agents use the same proof
            </div>
            <p className="mt-4 text-[22px] leading-[1.4] text-gray-700">
              An agent asks; its human approves once with World ID. The proof is bound to that agent, the seat count and the max bid. The agent then acts alone, and still counts as that one person.
            </p>
          </div>
          <div className="rounded-[32px] bg-gray-900 p-9 text-gray-0">
            <div className="text-[26px] font-semibold">Why World</div>
            <p className="mt-3 text-[21px] leading-[1.4] text-gray-0/70">The only way to say "one per person" at internet scale without collecting identities, and it works for the agents people will send.</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── 6 · Hedera at the core ─────────────────────────────────────────────────

function HederaCore() {
  const services = [
    { s: "Consensus Service", what: "A topic per drop: every entry, bid, hold, cutoff and result", fixes: "Who was first? What happened?" },
    { s: "PRNG", what: "Seed drawn after entries close, under a transaction ID fixed in advance", fixes: "Nobody picks the winners" },
    { s: "Token Service", what: "Partner seats as NFTs with KYC, freeze and wipe keys", fixes: "No hoarding, no resale" },
    { s: "Scheduled transactions", what: "Deposits refunded by scheduled transfers", fixes: "Refunds without trusting us" },
    { s: "x402 on Hedera", what: "Extra reads and agent deposits paid in HBAR", fixes: "Spam has a cost" },
    { s: "Mirror node", what: "Public read of the whole record", fixes: "Anyone recomputes the draw" },
  ];
  const card = (x: (typeof services)[number], side: "left" | "right") => (
    <div key={x.s} className={`relative flex flex-col justify-center rounded-[26px] bg-gray-0/[0.06] px-7 py-5 ring-1 ring-gray-0/10 ${side === "left" ? "text-right" : ""}`}>
      <div className="text-[25px] font-semibold tracking-[-0.01em]">{x.s}</div>
      <p className="mt-1 text-[18px] leading-[1.3] text-gray-0/60">{x.what}</p>
      <div className="mt-2 text-[18px] font-semibold text-[#3fb950]">{side === "left" ? `${x.fixes} ←` : `→ ${x.fixes}`}</div>
      <span className={`absolute top-1/2 h-[2px] w-10 bg-gray-0/20 ${side === "left" ? "-right-10" : "-left-10"}`} />
    </div>
  );
  return (
    <Frame dark compact eyebrow="Hedera at the core" title={<>Hedera is the referee. <span className="text-gray-0/45">Every decision that matters is written there, and anyone can check it.</span></>}>
      <div className="grid h-full grid-cols-[1fr_300px_1fr] items-stretch gap-x-10">
        <div className="grid grid-rows-3 gap-4">{services.slice(0, 3).map((x) => card(x, "left"))}</div>
        <div className="flex flex-col items-center justify-center text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="grid size-[260px] place-items-center rounded-full bg-gray-0 text-gray-900 shadow-[0_0_0_18px_rgba(255,255,255,0.06),0_0_0_36px_rgba(255,255,255,0.03)]"
          >
            <span className="flex flex-col items-center">
              <span className="text-[88px] font-semibold leading-none">ℏ</span>
              <span className="mt-2 text-[34px] font-semibold tracking-[-0.02em]">Hedera</span>
            </span>
          </motion.div>
          <p className="mt-10 text-[18px] leading-[1.35] text-gray-0/55">Fair order by consensus time · fast finality · low, fixed fees</p>
        </div>
        <div className="grid grid-rows-3 gap-4">{services.slice(3).map((x) => card(x, "right"))}</div>
      </div>
    </Frame>
  );
}

// ── 7 · Partners ───────────────────────────────────────────────────────────

function Partners() {
  const steps = [
    { t: "Provider registers its partners", d: "Existing, approved agencies only: name + Hedera account, added in the console", tag: "Allowlist" },
    { t: "KYC on the seat token", d: "Only these accounts can ever hold a partner seat", tag: "HTS KYC" },
    { t: "Signed requests, capped", d: "Every call signed with the partner's Hedera key; a seat cap per partner and a refundable deposit (x402)", tag: "Signature · x402" },
    { t: "Seats as tokens, then book", d: "Seat tokens land in the partner's account; they book on the provider's own site with a pass", tag: "HTS" },
  ];
  const blocked = [
    { t: "Unlisted company", d: "Refused at the first call: 403 not allowlisted" },
    { t: "Seat passed to a reseller", d: "Hedera itself refuses: ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN" },
    { t: "Partner hoards seats", d: "Unused seats wiped back, deposit kept, seats go to the public draw" },
    { t: "Partner misbehaves", d: "Provider freezes it on the token instantly" },
  ];
  return (
    <Frame compact eyebrow="Partner lane · no random resellers" title={<>Only authorised partners can book the partner quota. <span className="text-gray-400">Everyone else is refused, by us and by Hedera.</span></>}>
      <div className="grid h-full grid-cols-[1.15fr_1fr] gap-8">
        <div className="flex flex-col gap-3.5">
          {steps.map((s, i) => (
            <div key={s.t} className="flex items-center gap-5 rounded-[26px] bg-gray-50 px-7 py-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gray-900 text-[20px] font-semibold text-gray-0">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[25px] font-semibold leading-tight tracking-[-0.01em]">{s.t}</span>
                  <span className="shrink-0 rounded-full bg-info-100 px-3 py-1 text-[14px] font-semibold text-info-700">{s.tag}</span>
                </span>
                <span className="mt-1 block text-[18px] leading-[1.3] text-gray-500">{s.d}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-[32px] bg-error-100 p-7">
          <div className="flex items-center gap-3 text-[24px] font-semibold text-error-700">
            <Dot c="bg-error-600" /> Turned away
          </div>
          <div className="mt-4 flex flex-1 flex-col justify-between gap-3">
            {blocked.map((b) => (
              <div key={b.t} className="flex gap-4 rounded-2xl bg-gray-0 px-5 py-3.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-error-100 text-[14px] font-bold text-error-700">✕</span>
                <span>
                  <span className="block text-[21px] font-semibold leading-tight">{b.t}</span>
                  <span className="mt-1 block text-[16px] leading-[1.3] text-gray-500">{b.d}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── 8 · One drop on Hedera ─────────────────────────────────────────────────

function DropOnHedera() {
  const steps = [
    { t: "Drop created", d: "Its own HCS topic; partner quota gets an HTS seat token", tag: "HCS · HTS" },
    { t: "Entries arrive", d: "Entries, sealed bids and partner holds as messages; consensus time sets the order", tag: "HCS" },
    { t: "Window closes", d: "Cutoff and seat count written, with the seed's transaction ID committed in advance", tag: "HCS" },
    { t: "Seed", d: "Random seed from Hedera under that ID: nobody knows it while entries are open", tag: "PRNG" },
    { t: "Winners", d: "Fisher–Yates with sha256(seed ‖ counter); result published, passes issued", tag: "HCS" },
    { t: "After booking", d: "Used seats wiped, deposits refunded on schedule, unused seats back to the public", tag: "HTS · Schedule" },
  ];
  return (
    <Frame eyebrow="How Hedera solves it" title={<>One drop, end to end. <span className="text-gray-400">Every step leaves a public trace.</span></>}>
      <div className="flex h-full flex-col justify-between">
        <div className="relative grid grid-cols-6 gap-5">
          <div className="absolute left-[8%] right-[8%] top-7 h-[3px] bg-gray-200" />
          {steps.map((s, i) => (
            <motion.div key={s.t} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className="relative flex flex-col items-center text-center">
              <span className="z-10 grid size-14 place-items-center rounded-full bg-gray-900 text-[22px] font-semibold text-gray-0 ring-8 ring-gray-0">{i + 1}</span>
              <span className="mt-4 rounded-full bg-info-100 px-3 py-1 text-[15px] font-semibold text-info-700">{s.tag}</span>
              <span className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.01em]">{s.t}</span>
              <span className="mt-2 text-[18px] leading-[1.35] text-gray-500">{s.d}</span>
            </motion.div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-8 rounded-[32px] bg-gray-900 px-10 py-7 text-gray-0">
          <span className="text-[26px] font-semibold">Anyone can verify: the waiting room rebuilds the draw from the mirror node.</span>
          <span className="shrink-0 rounded-full bg-[#238636]/30 px-6 py-3 text-[24px] font-semibold text-[#3fb950]">✓ Matches Hedera</span>
        </div>
      </div>
    </Frame>
  );
}

// ── 9 · Close ──────────────────────────────────────────────────────────────

function Close() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-24 pb-16 text-gray-0">
      <h2 className="text-[140px] font-semibold leading-[0.92] tracking-[-0.05em]">SurgePass</h2>
      <p className="mt-8 max-w-[1200px] text-[46px] font-semibold leading-[1.1] tracking-[-0.02em]">
        Point your booking domain at SurgePass, add ten lines, <span className="text-gray-0/45">and your next rush is fair.</span>
      </p>
      <div className="mt-14 flex flex-wrap gap-4 text-[24px] font-medium">
        <span className="rounded-full bg-gray-0 px-7 py-3.5 text-gray-900">surgepass.vercel.app</span>
        <span className="rounded-full bg-gray-0/10 px-7 py-3.5">{REPO_URL.replace("https://", "")}</span>
        <span className="rounded-full bg-gray-0/10 px-7 py-3.5">Live demo on this laptop</span>
      </div>
    </div>
  );
}
