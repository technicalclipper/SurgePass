import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import nodeVerify from "../../../docs/integration/verify.mjs?raw";
import { CodeWindow } from "../ui/code";

// The console's front page: what SurgePass is, who it's for, and how it works. Public (no sign-in).
// Colour only carries meaning, as everywhere else: green = a person, red = a bot, purple = an agent,
// blue = Hedera / partners.

const go = (hash: string) => (location.hash = hash);

export function Landing() {
  return (
    <div className="min-h-screen bg-gray-0 text-gray-900">
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Lanes />
      <UseCases />
      <Proof />
      <Integration />
      <Closing />
      <Footer />
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`grid size-8 place-items-center rounded-full text-sm font-semibold ${inverted ? "bg-gray-0 text-gray-900" : "bg-gray-900 text-gray-0"}`}>S</span>
      <span className="text-lg font-semibold tracking-[-0.01em]">SurgePass</span>
    </span>
  );
}

function Button({ children, onClick, kind = "primary" }: { children: ReactNode; onClick: () => void; kind?: "primary" | "secondary" | "light" }) {
  const k = {
    primary: "bg-gray-900 text-gray-0 hover:bg-gray-700",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    light: "bg-gray-0 text-gray-900 hover:bg-gray-100",
  }[kind];
  return (
    <button onClick={onClick} className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-semibold transition active:scale-[0.98] ${k}`}>
      {children}
    </button>
  );
}

function Section({ id, eyebrow, title, sub, children, className = "" }: { id?: string; eyebrow: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-24 px-6 py-24 ${className}`}>
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-400">{eyebrow}</div>
        <h2 className="mt-3 text-4xl font-semibold leading-narrow tracking-[-0.02em] sm:text-5xl">{title}</h2>
        {sub && <p className="mt-4 text-lg leading-compact text-gray-500">{sub}</p>}
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`sticky top-0 z-40 transition ${scrolled ? "border-b border-gray-100 bg-gray-0/85 backdrop-blur-md" : "bg-gray-0"}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <Logo />
        </button>
        <nav className="hidden items-center gap-1 md:flex">
          {[
            ["how", "How it works"],
            ["lanes", "Lanes"],
            ["uses", "Use cases"],
            ["proof", "Proof"],
            ["integrate", "Integrate"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => scrollTo(id!)} className="rounded-full px-3.5 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-900">
              {label}
            </button>
          ))}
        </nav>
        <button onClick={() => go("overview")} className="inline-flex h-10 items-center rounded-full bg-gray-900 px-5 text-sm font-semibold text-gray-0 transition hover:bg-gray-700">
          Open console
        </button>
      </div>
    </header>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700">
            <span className="size-2 rounded-full bg-success-600" />
            A fair line in front of your booking site
          </span>
          <h1 className="mt-7 text-5xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[76px]">
            When everyone rushes,
            <br />
            <span className="text-gray-400">real people get in.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-compact text-gray-500 sm:text-xl">
            SurgePass sits in front of your site at the busiest minute. People prove they're human with World ID and enter a draw anyone can check on Hedera. Their agents act with permission. Partners book within rules. Bots get nowhere, and your servers stay calm.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => go("overview")}>Open console →</Button>
            <Button kind="secondary" onClick={() => go("demo")}>
              Watch the crash demo
            </Button>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }} className="mt-16">
          <GateVisual />
        </motion.div>
      </div>
    </section>
  );
}

type Kind = "bot" | "human" | "agent" | "partner";
const KIND: Record<Kind, { dot: string; label: string }> = {
  bot: { dot: "bg-error-600", label: "Bots" },
  human: { dot: "bg-success-600", label: "People · World ID" },
  agent: { dot: "bg-purple", label: "Agents · approved" },
  partner: { dot: "bg-info-600", label: "Partners · Hedera" },
};

/** Simulated traffic: bots stop at the gate, everyone verified passes through to a calm backend. */
function GateVisual() {
  const [dots, setDots] = useState<{ id: number; kind: Kind; y: number }[]>([]);
  const [count, setCount] = useState({ in: 0, out: 0 });
  const next = useRef(1);
  useEffect(() => {
    const t = setInterval(() => {
      const r = Math.random();
      const kind: Kind = r < 0.62 ? "bot" : r < 0.84 ? "human" : r < 0.94 ? "agent" : "partner";
      const id = next.current++;
      setDots((d) => [...d.slice(-60), { id, kind, y: 10 + Math.random() * 80 }]);
      setTimeout(() => setCount((c) => (kind === "bot" ? { ...c, out: c.out + 1 } : { ...c, in: c.in + 1 })), 1400);
    }, 140);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="relative overflow-hidden rounded-[2rem] bg-gray-50 p-6 ring-1 ring-gray-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">
          <span>Everyone, at 10:00:00</span>
          <span className="hidden sm:block">SurgePass</span>
          <span>Your booking site</span>
        </div>
        <div className="relative h-64 sm:h-72">
          {/* the gate */}
          <div className="absolute inset-y-0 left-[44%] z-10 flex w-[22%] -translate-x-1/2 flex-col sm:left-[46%] sm:w-[14%] sm:min-w-[92px] items-center justify-center rounded-3xl bg-gray-900 text-gray-0 shadow-lifted">
            <span className="grid size-10 place-items-center rounded-full bg-gray-0 text-base font-bold text-gray-900">S</span>
            <span className="mt-2 text-xs font-semibold">Gate</span>
          </div>
          {/* the site */}
          <div className="absolute inset-y-6 right-0 z-10 flex w-[34%] flex-col justify-between rounded-3xl bg-gray-0 p-3 shadow-card sm:w-[22%] sm:min-w-[120px] sm:p-4">
            <div>
              <div className="text-sm font-semibold">Booking</div>
              <div className="mt-3 text-2xs font-medium text-gray-500">Booked by real people</div>
              <div className="text-2xl font-semibold tabular tracking-[-0.02em] sm:text-3xl">{count.in.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="flex items-center justify-between text-2xs font-medium text-gray-500">
                <span>Load</span>
                <span className="text-success-700">steady</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                <motion.div className="h-full rounded-full bg-success-600" animate={{ width: ["34%", "41%", "37%", "39%", "34%"] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
              </div>
            </div>
          </div>
          {/* traffic */}
          <AnimatePresence>
            {dots.map((d) => (
              <motion.span
                key={d.id}
                className={`absolute size-2.5 rounded-full ${KIND[d.kind].dot}`}
                style={{ top: `${d.y}%` }}
                initial={{ left: "0%", opacity: 0, scale: 0.6 }}
                animate={
                  d.kind === "bot"
                    ? { left: ["0%", "36%", "37%"], opacity: [0, 1, 0], scale: [0.6, 1, 0.3] }
                    : { left: ["0%", "40%", "54%", "76%"], top: [`${d.y}%`, `${d.y}%`, "50%", "50%"], opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 0.6] }
                }
                transition={{ duration: d.kind === "bot" ? 1.4 : 2.2, ease: "linear", times: d.kind === "bot" ? [0, 0.85, 1] : [0, 0.45, 0.65, 1] }}
                onAnimationComplete={() => setDots((all) => all.filter((x) => x.id !== d.id))}
              />
            ))}
          </AnimatePresence>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <span key={k} className="flex items-center gap-2 text-sm text-gray-500">
                <span className={`size-2.5 rounded-full ${KIND[k].dot}`} />
                {KIND[k].label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold tabular sm:text-sm">
            <span className="rounded-full bg-success-100 px-3 py-1 text-success-700">✓ {count.in.toLocaleString("en-IN")} let through</span>
            <span className="rounded-full bg-error-100 px-3 py-1 text-error-700">✕ {count.out.toLocaleString("en-IN")} turned away</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-gray-400">Illustration with simulated traffic. The console shows the real thing.</p>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

function Problem() {
  const items = [
    { k: "01", t: "Bots win the race", d: "When seats open at a set minute, scripts click faster than any person. The fastest code wins, not the people who need the ticket." },
    { k: "02", t: "The site falls over", d: "The rush hits every backend at once. Pages time out, payments fail, and real customers get errors instead of seats." },
    { k: "03", t: "Quotas leak to touts", d: "Agent and partner accounts are plain keys that can be shared or sold. Reserved seats end up resold, with no way to check." },
  ];
  return (
    <Section eyebrow="The 10 AM problem" title="The busiest minute is the least fair one." sub="Train Tatkal, first-day shows, concert drops: everyone arrives at the same second, and the system rewards whoever brings the most bots.">
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((x) => (
          <div key={x.k} className="rounded-3xl bg-gray-50 p-7">
            <div className="font-mono text-sm text-gray-400">{x.k}</div>
            <div className="mt-6 text-xl font-semibold tracking-[-0.01em]">{x.t}</div>
            <p className="mt-2 leading-compact text-gray-500">{x.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function HowItWorks() {
  const steps = [
    { t: "The gate switches on", d: "Only for the routes and minutes you choose, or when your backend slows down. Everything else passes straight through.", tag: "Reverse proxy" },
    { t: "One tap, one human", d: "People wait in a calm waiting room and verify with World ID. One person gets one entry, and nobody learns who they are.", tag: "World ID" },
    { t: "A draw anyone can check", d: "Entries are recorded on Hedera. The random seed comes from Hedera after entries close, so nobody can pick winners.", tag: "Hedera" },
    { t: "Book on your own site", d: "Winners get a short-lived signed pass for the seats they won and book through your normal pages.", tag: "Signed pass" },
  ];
  return (
    <Section id="how" eyebrow="How it works" title="Four steps from rush to booked." sub="Customers verify once with World App. Nothing changes in how you sell tickets.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.t} className="relative flex flex-col rounded-3xl border border-gray-100 p-7">
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-full bg-gray-900 text-sm font-semibold text-gray-0">{i + 1}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">{s.tag}</span>
            </div>
            <div className="mt-8 text-xl font-semibold tracking-[-0.01em]">{s.t}</div>
            <p className="mt-2 leading-compact text-gray-500">{s.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Lanes() {
  const lanes = [
    {
      name: "People",
      tag: "Fair draw",
      tone: "bg-success-100 text-success-700",
      dot: "bg-success-600",
      points: ["World ID: one entry per human", "Ask for up to your seat limit; winners book what they need", "Unused seats go to the next person in line"],
    },
    {
      name: "Premium",
      tag: "Sealed bids",
      tone: "bg-gray-100 text-gray-700",
      dot: "bg-gray-900",
      points: ["Bids stay sealed until bidding closes", "Everyone who wins pays the same price: the highest losing bid", "Agent bids carry a refundable deposit, paid via x402"],
    },
    {
      name: "Partners",
      tag: "Seat tokens",
      tone: "bg-info-100 text-info-700",
      dot: "bg-info-600",
      points: ["Only allowlisted Hedera accounts, with a cap each", "Seats are tokens only approved partners can hold", "Unused seats come back to the public draw"],
    },
    {
      name: "Agents",
      tag: "With permission",
      tone: "bg-purple-soft text-purple",
      dot: "bg-purple",
      points: ["Act only after their human approves with World ID", "Pay for extra checks themselves via x402, within a budget", "Count as their human: still one entry"],
    },
  ];
  return (
    <Section id="lanes" eyebrow="The lanes" title="Different ways in, one rule: a real person behind every seat." sub="Each drop picks its lane. Run a Tatkal draw, a premium auction and a partner quota side by side for the same train.">
      <div className="grid gap-4 md:grid-cols-2">
        {lanes.map((l) => (
          <div key={l.name} className="rounded-3xl bg-gray-50 p-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`size-3 rounded-full ${l.dot}`} />
                <span className="text-2xl font-semibold tracking-[-0.01em]">{l.name}</span>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${l.tone}`}>{l.tag}</span>
            </div>
            <ul className="mt-6 flex flex-col gap-3">
              {l.points.map((p) => (
                <li key={p} className="flex gap-3 leading-compact text-gray-700">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gray-0 text-[10px] font-bold text-gray-900">✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UseCases() {
  const cases = [
    { icon: "🚆", t: "Rail Tatkal", d: "Next-day quota opens at a fixed time. A draw over the opening window replaces the click race; partner agencies get their quota as seat tokens." },
    { icon: "🎬", t: "First-day shows", d: "Fans of a big release all hit the same showtime. One entry per person, and seats go to people rather than resale bots." },
    { icon: "🎤", t: "Concerts and stadiums", d: "Huge demand for a few thousand seats. Premium seats can run as a sealed-bid auction with one clearing price." },
    { icon: "👟", t: "Limited drops", d: "Sneakers, merch, collectibles. Keep the drop moment without handing it to whoever runs the most scripts." },
    { icon: "🗓️", t: "Appointment slots", d: "Visa, passport or clinic slots released in batches. One slot per person, and nobody can hoard and resell them." },
    { icon: "🤝", t: "Event partners", d: "Travel agencies and resellers get a quota they can't hoard or pass on, with every hand-out recorded on Hedera." },
  ];
  return (
    <Section id="uses" eyebrow="Use cases" title="Anywhere demand spikes at a set time." sub="If a launch minute brings your site down or your seats end up on resale, SurgePass fits in front of it.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c) => (
          <div key={c.t} className="group rounded-3xl border border-gray-100 p-7 transition hover:border-gray-200 hover:shadow-card">
            <div className="grid size-12 place-items-center rounded-2xl bg-gray-50 text-2xl" aria-hidden>
              {c.icon}
            </div>
            <div className="mt-6 text-xl font-semibold tracking-[-0.01em]">{c.t}</div>
            <p className="mt-2 leading-compact text-gray-500">{c.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Proof() {
  const lines: [string, string][] = [
    ["entries", "read from the drop's HCS topic, in consensus order"],
    ["cutoff", "window_closed message, written before the seed exists"],
    ["seed", "Hedera PRNG, from a transaction ID committed in advance"],
    ["shuffle", "Fisher–Yates, sha256(seed ‖ counter) at every step"],
    ["allocate", "in that order, min(requested, seats left)"],
  ];
  return (
    <section id="proof" className="scroll-mt-24 bg-gray-900 text-gray-0">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-0/50">Proof</div>
          <h2 className="mt-3 text-4xl font-semibold leading-narrow tracking-[-0.02em] sm:text-5xl">Don't trust us. Recompute it.</h2>
          <p className="mt-4 text-lg leading-compact text-gray-0/60">
            Every entry, the cutoff, the random seed and the result go to the drop's own Hedera topic. Anyone can rebuild the draw from public data and get the same winners. Once entries close, nobody, the provider included, can change who wins.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button kind="light" onClick={() => go("proofs")}>
              See the proofs
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl bg-[#0d1117] ring-1 ring-gray-0/10">
          <div className="flex items-center gap-1.5 border-b border-gray-0/10 bg-[#161b22] px-4 py-3">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
            <span className="ml-3 font-mono text-xs text-gray-0/50">verify the draw</span>
          </div>
          <div className="flex flex-col gap-3 p-6 font-mono text-[13px] leading-relaxed">
            <div className="text-gray-0/45"># recompute a draw from public Hedera data</div>
            {lines.map(([k, t], i) => (
              <motion.div key={k} initial={{ opacity: 0, x: -6 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }} className="grid grid-cols-[6.5rem_1fr] gap-3">
                <span className="text-[#79c0ff]">▸ {k}</span>
                <span className="text-gray-0/85">{t}</span>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: lines.length * 0.12 + 0.1 }} className="font-semibold text-[#3fb950]">
              ✓ winners match the published result
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Integration() {
  const code = nodeVerify.split("\n").slice(1).join("\n").trim() + "\n";
  return (
    <Section id="integrate" eyebrow="Integration" title="About ten lines on your side." sub="Point your booking domain at SurgePass. On your booking routes, check one signed header and cap the seats it allows. No blockchain code, no SDK.">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <CodeWindow title="surgepass.mjs · Node.js · also Python, Java, Go" code={code} lang="js" maxHeight={420} />
        <ul className="flex flex-col gap-5">
          {[
            ["Your site, your checkout", "Fares, inventory and customer details stay on your servers. SurgePass only decides who reaches the booking page."],
            ["One signed header", "Each allowed booking arrives with a signed statement of how many seats it may take, and the price for premium seats."],
            ["Off-peak, invisible", "Outside the drops you configure, every request passes straight through."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-4">
              <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-gray-900 text-xs font-bold text-gray-0">✓</span>
              <span>
                <span className="block text-lg font-semibold">{t}</span>
                <span className="mt-1 block leading-compact text-gray-500">{d}</span>
              </span>
            </li>
          ))}
          <li className="pt-2">
            <Button kind="secondary" onClick={() => go("integrate")}>
              Integration guide →
            </Button>
          </li>
        </ul>
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto max-w-6xl rounded-[2rem] bg-gray-50 px-8 py-16 text-center sm:py-20">
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold leading-narrow tracking-[-0.02em] sm:text-5xl">Put a fair line in front of your next rush.</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-500">Set up a drop, pick its lane, and watch who gets through.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={() => go("overview")}>Open console →</Button>
          <Button kind="light" onClick={() => go("compare")}>
            Run the tests
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500">
        <Logo />
        <span>Built for ETHGlobal Mumbai 2026 · World ID · Hedera</span>
      </div>
    </footer>
  );
}
