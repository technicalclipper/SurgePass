import { useEffect, useState, type ReactNode } from "react";
import nodeVerify from "../../../docs/integration/verify.mjs?raw";
import pyVerify from "../../../docs/integration/verify.py?raw";
import javaVerify from "../../../docs/integration/SurgePass.java?raw";
import goVerify from "../../../docs/integration/surgepass.go?raw";
import { admin } from "../lib/api";
import { CodeWindow, CopyButton, type Lang } from "../ui/code";
import { Segmented } from "../ui/console";

// How a provider connects its booking backend: route traffic through SurgePass, lock the origin,
// verify X-SurgePass-Assertion (about ten lines, shown in several languages), report seats booked.
// The verify files live in docs/integration/ and were run against this gateway before shipping.

interface Integration {
  origin: string;
  upstream: string;
  jwksUrl: string;
  issuer: string;
  audience: string;
  testAudience: string;
  header: string;
  algorithm: string;
  typ: string;
  ttlSec: number;
  confirmedSeatsField: string;
}

type LangId = "node" | "python" | "java" | "go";

const LANGS: { id: LangId; label: string; file: string; lang: Lang; verify: string; tested: boolean; handlerFile: string; handler: string }[] = [
  {
    id: "node",
    label: "Node.js",
    file: "surgepass.mjs",
    lang: "js",
    verify: nodeVerify,
    tested: true,
    handlerFile: "routes/booking.mjs · Express",
    handler: `app.post("/tatkal/book/:train/confirm", async (req, res) => {
  let pass;
  try {
    pass = await surgePass(req.headers);
  } catch {
    return res.status(403).json({ error: "invalid pass" });
  }
  const { passengers } = req.body;
  if (pass && passengers.length > pass.seats) return res.status(400).json({ error: \`pass allows \${pass.seats} seat(s)\` });

  const fare = pass?.pool === "premium" ? pass.price : FARE; // premium: the auction's clearing price
  const pnr = await bookSeats(passengers, fare);
  res.json({ pnr, seats_booked: passengers.length }); // SurgePass reads seats_booked
});
`,
  },
  {
    id: "python",
    label: "Python",
    file: "surgepass.py",
    lang: "py",
    verify: pyVerify,
    tested: true,
    handlerFile: "app.py · Flask",
    handler: `@app.post("/tatkal/book/<train>/confirm")
def confirm(train):
    try:
        p = surgepass(request.headers)
    except jwt.InvalidTokenError:
        return {"error": "invalid pass"}, 403
    passengers = request.json["passengers"]
    if p and len(passengers) > p["seats"]:
        return {"error": f"pass allows {p['seats']} seat(s)"}, 400

    fare = p["price"] if p and p["pool"] == "premium" else FARE  # premium: the clearing price
    pnr = book_seats(passengers, fare)
    return {"pnr": pnr, "seats_booked": len(passengers)}  # SurgePass reads seats_booked
`,
  },
  {
    id: "java",
    label: "Java",
    file: "SurgePass.java",
    lang: "java",
    verify: javaVerify,
    tested: true,
    handlerFile: "BookingController.java · Spring",
    handler: `@PostMapping("/tatkal/book/{train}/confirm")
ResponseEntity<?> confirm(@RequestHeader(value = "X-SurgePass-Assertion", required = false) String header,
                          @RequestBody Booking body) throws Exception {
  JWTClaimsSet pass;
  try {
    pass = SurgePass.verify(header);
  } catch (Exception e) {
    return ResponseEntity.status(403).body(Map.of("error", "invalid pass"));
  }
  int n = body.passengers().size();
  if (pass != null && n > pass.getLongClaim("seats")) return ResponseEntity.badRequest().body(Map.of("error", "too many seats"));

  long fare = pass != null && "premium".equals(pass.getStringClaim("pool")) ? pass.getLongClaim("price") : FARE;
  String pnr = bookings.book(body.passengers(), fare);
  return ResponseEntity.ok(Map.of("pnr", pnr, "seats_booked", n)); // SurgePass reads seats_booked
}
`,
  },
  {
    id: "go",
    label: "Go",
    file: "surgepass.go",
    lang: "go",
    verify: goVerify,
    tested: false,
    handlerFile: "booking.go · net/http",
    handler: `func confirm(w http.ResponseWriter, r *http.Request) {
	pass, err := surgepass.Verify(r)
	if err != nil {
		http.Error(w, "invalid pass", http.StatusForbidden)
		return
	}
	var body struct{ Passengers []Passenger \`json:"passengers"\` }
	_ = json.NewDecoder(r.Body).Decode(&body)
	if pass != nil {
		if seats, _ := pass.Get("seats"); len(body.Passengers) > int(seats.(float64)) {
			http.Error(w, "too many seats", http.StatusBadRequest)
			return
		}
	}
	pnr := bookSeats(body.Passengers)
	json.NewEncoder(w).Encode(map[string]any{"pnr": pnr, "seats_booked": len(body.Passengers)}) // SurgePass reads seats_booked
}
`,
  },
];

const CLAIMS: { name: string; example: string; use: string }[] = [
  { name: "seats", example: "2", use: "Most seats this booking may take. Refuse more." },
  { name: "pool", example: '"normal" | "premium" | "partner"', use: "Which lane the person came through." },
  { name: "price", example: "1840", use: "Premium only: the clearing price per seat. Charge this." },
  { name: "partner", example: '"0.0.11336728"', use: "Partner lane only: the partner's Hedera account." },
  { name: "drop", example: '"train-12007-cc-tatkal"', use: "The drop this pass belongs to." },
  { name: "pass_id", example: '"p_8f2k…"', use: "Unique per pass. Store it with the booking if you want." },
  { name: "requested / exp", example: "2 · +300 s", use: "Seats asked for · the header expires 5 minutes after the request." },
];

const card = "rounded-3xl bg-gray-0 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

export function Integrate() {
  const [info, setInfo] = useState<Integration | null>(null);
  const [lang, setLang] = useState<LangId>("node");
  const [view, setView] = useState<"verify" | "handler">("verify");

  useEffect(() => {
    void admin<Integration>("/integration").then(setInfo, () => {});
  }, []);

  const l = LANGS.find((x) => x.id === lang)!;
  // Show the code with this deployment's real values, ready to paste.
  const fill = (code: string) => (info ? code.replaceAll("https://gate.example.com/.well-known/jwks.json", info.jwksUrl).replaceAll("tickets.example.com", info.audience) : code);
  const code = fill(view === "verify" ? l.verify : l.handler);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Integrate</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Connect your booking backend. SurgePass sits in front of your site; on your side it's one check of a signed header on your booking routes, about ten lines. No blockchain code, no SDK.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <Step n={1} title="Route your domain through SurgePass">
          Point your booking domain at the gateway. It forwards to your origin
          {info && (
            <>
              {" "}
              <Mono>{info.upstream}</Mono>
            </>
          )}
          . Outside a drop's peak, every request passes straight through.
        </Step>
        <Step n={2} title="Only accept traffic from SurgePass">
          Lock your origin to the gateway (private network or IP allowlist), so nobody can go round the queue by calling your servers directly.
        </Step>
        <Step n={3} title="Verify the signed header">
          On booking and confirm routes, check <Mono>X-SurgePass-Assertion</Mono> and cap the seats it allows. Code below.
        </Step>
        <Step n={4} title="Say how many seats were booked">
          Return <Mono>{info?.confirmedSeatsField ?? "seats_booked"}</Mono> in your confirm response. SurgePass marks the pass used and gives unused seats to the next in line.
        </Step>
      </div>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Verify the header</h2>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "verify", label: "The check" },
                { value: "handler", label: "In your booking route" },
              ]}
            />
          </div>
          <CodeWindow
            title={view === "verify" ? l.file : l.handlerFile}
            tabs={LANGS.map((x) => ({ id: x.id, label: x.label }))}
            active={lang}
            onTab={(id) => setLang(id as LangId)}
            code={code}
            lang={l.lang}
            badge={
              view === "verify" ? (
                l.tested ? (
                  <span className="rounded-md bg-[#238636]/25 px-2 py-1 text-2xs font-semibold text-[#3fb950]" title="Run against this gateway: valid, missing, forged, expired and test-audience tokens">
                    ✓ Tested on this gateway
                  </span>
                ) : (
                  <span className="rounded-md bg-gray-0/10 px-2 py-1 text-2xs font-semibold text-gray-0/60" title="Go isn't installed on this machine, so this snippet hasn't been run here">
                    Not run here
                  </span>
                )
              ) : null
            }
          />
          <p className="text-xs text-gray-500">
            {view === "verify"
              ? "Valid header → the pass details. No header → null (the request wasn't gated). Forged, expired or for another site → it throws: answer 403."
              : "Refuse more seats than the pass allows, charge the premium price when there is one, and return seats_booked."}
          </p>
        </div>

        <aside className="flex flex-col gap-4">
          <section className={`${card} p-5`}>
            <h3 className="font-semibold">Your values</h3>
            <dl className="mt-3 flex flex-col divide-y divide-gray-100 text-sm">
              <Value k="Header" v={info?.header} />
              <Value k="Keys (JWKS)" v={info?.jwksUrl} copy />
              <Value k="Issuer" v={info?.issuer} copy />
              <Value k="Audience" v={info?.audience} copy hint="Your own host" />
              <Value k="Algorithm" v={info?.algorithm} />
              <Value k="Token type" v={info?.typ} />
              <Value k="Lifetime" v={info ? `${info.ttlSec / 60} minutes` : undefined} />
            </dl>
          </section>
          <section className={`${card} p-5`}>
            <h3 className="font-semibold">What's inside</h3>
            <div className="mt-3 flex flex-col gap-3">
              {CLAIMS.map((c) => (
                <div key={c.name}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-gray-900">{c.name}</span>
                    <span className="truncate font-mono text-2xs text-gray-400">{c.example}</span>
                  </div>
                  <div className="text-xs text-gray-500">{c.use}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <TestToken info={info} />
    </div>
  );
}

function TestToken({ info }: { info: Integration | null }) {
  const [pool, setPool] = useState<"normal" | "premium" | "partner">("normal");
  const [res, setRes] = useState<{ token: string; claims: Record<string, unknown> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function make() {
    setErr(null);
    try {
      setRes(await admin("/integration/test-assertion", { method: "POST", body: JSON.stringify({ pool }) }));
    } catch (e: any) {
      setErr(e.message);
    }
  }
  // Straight to your backend: the gateway strips any assertion a client sends, so tests skip it.
  const curl = res && info ? `curl -X POST ${info.upstream}/tatkal/book/12007/2026-11-06/CC/confirm \\\n  -H "X-SurgePass-Assertion: ${res.token}" \\\n  -H "content-type: application/json" \\\n  -d '{"passengers":[{"name":"Asha"},{"name":"Ravi"}]}'` : "";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Test your code</h2>
          <p className="max-w-2xl text-xs text-gray-500">
            Get a real signed header to try your check with. Test headers are made for the audience <Mono>{info?.testAudience ?? "test.surgepass"}</Mono>, so your real check refuses them and they can never book anything. Set your audience to it while testing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={pool}
            onChange={setPool}
            options={[
              { value: "normal", label: "Normal" },
              { value: "premium", label: "Premium" },
              { value: "partner", label: "Partner" },
            ]}
          />
          <button onClick={() => void make()} className="inline-flex h-10 items-center rounded-full bg-gray-900 px-5 text-sm font-semibold text-gray-0 hover:bg-gray-700 active:scale-[0.98]">
            Generate test header
          </button>
        </div>
      </div>
      {err && <div className="rounded-2xl bg-error-100 px-4 py-3 text-sm text-error-700">{err}</div>}
      {res ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <CodeWindow title="request to your backend · valid for 5 minutes" code={curl} lang="sh" maxHeight={320} />
          <CodeWindow title="what your check returns" code={JSON.stringify(res.claims, null, 2)} lang="json" maxHeight={320} />
        </div>
      ) : (
        <div className={`${card} grid place-items-center px-6 py-10 text-center text-sm text-gray-400`}>Pick a lane and generate a header. You'll get a ready-to-run request and the details your check should return.</div>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className={`${card} flex flex-col gap-2 p-5`}>
      <span className="grid size-7 place-items-center rounded-full bg-gray-900 text-xs font-bold text-gray-0">{n}</span>
      <div className="mt-1 font-semibold">{title}</div>
      <div className="text-sm leading-relaxed text-gray-500">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-gray-900">{children}</code>;
}

function Value({ k, v, copy = false, hint }: { k: string; v?: string; copy?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-gray-500">
        {k}
        {hint && <span className="block text-2xs text-gray-400">{hint}</span>}
      </dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs font-medium text-gray-900" title={v}>
          {v ?? "…"}
        </span>
        {copy && v && (
          <span className="shrink-0 [&_button]:bg-gray-100 [&_button]:text-gray-700 [&_button:hover]:bg-gray-200 [&_button:hover]:text-gray-900">
            <CopyButton text={v} />
          </span>
        )}
      </dd>
    </div>
  );
}
