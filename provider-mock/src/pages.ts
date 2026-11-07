import type { Assertion } from "./assertion.ts";

// QuickBook: an ordinary booking site with its own brand. It knows nothing about SurgePass beyond
// the optional X-SurgePass-Assertion note on the booking page. Server-rendered, no client framework.

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const CSS = `
:root{--bg:#F6F4F0;--card:#FFFFFF;--ink:#15171C;--ink2:#4A4F5A;--muted:#8A8F99;--line:#E9E6E0;--accent:#FF5A1F;--accent-ink:#C2410C;--accent-soft:#FFF1EA;--ok:#0F9D58;--ok-soft:#E8F6EE;--bad:#D92D20;--bad-soft:#FDECEA;--r:20px}
*{box-sizing:border-box}html{-webkit-font-smoothing:antialiased}
body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
a{color:inherit;text-decoration:none}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
/* nav */
.nav{position:sticky;top:0;z-index:10;background:rgba(246,244,240,.86);backdrop-filter:saturate(180%) blur(14px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;gap:28px;height:64px}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:-.02em}
.logo i{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--ink);color:#fff;font-style:normal;font-size:15px}
.tabs{display:flex;gap:4px}.tabs a{padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;color:var(--ink2)}.tabs a:hover{background:#ECE8E1;color:var(--ink)}
.nav .help{margin-left:auto;font-size:13px;color:var(--muted)}
/* hero */
.hero{padding:56px 0 28px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-size:13px;font-weight:600}
.eyebrow b{width:7px;height:7px;border-radius:50%;background:var(--accent)}
.hero h1{margin:18px 0 10px;font-size:56px;line-height:1.02;letter-spacing:-.035em;font-weight:750;max-width:760px}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero p{margin:0;max-width:560px;font-size:18px;color:var(--ink2)}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
.chip{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-size:14px}
.chip span{color:var(--muted)}
/* sections */
.sec{padding:30px 0}
.sec-h{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px}
.sec-h h2{margin:0;font-size:28px;letter-spacing:-.025em}.sec-h span{color:var(--muted);font-size:14px}
/* train ticket */
.ticket{display:grid;grid-template-columns:1fr auto;background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-bottom:14px;overflow:hidden;transition:box-shadow .2s,transform .2s}
.ticket:hover{box-shadow:0 18px 40px -18px rgba(21,23,28,.22);transform:translateY(-1px)}
.t-main{padding:22px 26px}
.t-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.no{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:6px 8px;border-radius:8px;background:#F1EEE8;color:var(--ink2)}
.t-name{font-weight:700;font-size:18px;letter-spacing:-.01em}
.cls{margin-left:auto;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--ink2);border:1px solid var(--line);border-radius:8px;padding:5px 8px}
.route{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;margin-top:18px}
.stn b{display:block;font-size:20px;letter-spacing:-.02em}.stn span{font-size:13px;color:var(--muted)}.stn.r{text-align:right}
.line{position:relative;height:2px;background:repeating-linear-gradient(90deg,var(--line) 0 8px,transparent 8px 14px)}
.line:before,.line:after{content:"";position:absolute;top:-4px;width:10px;height:10px;border-radius:50%;border:2px solid var(--ink);background:var(--card)}
.line:before{left:-2px}.line:after{right:-2px;background:var(--ink)}
.line em{position:absolute;left:50%;top:-11px;transform:translateX(-50%);font-style:normal;font-size:12px;background:var(--card);padding:0 8px;color:var(--muted)}
.t-side{position:relative;display:flex;flex-direction:column;gap:10px;justify-content:center;padding:22px 24px;border-left:2px dashed var(--line);min-width:280px;background:#FCFBF9}
.t-side:before,.t-side:after{content:"";position:absolute;left:-11px;width:20px;height:20px;border-radius:50%;background:var(--bg);border:1px solid var(--line)}
.t-side:before{top:-11px}.t-side:after{bottom:-11px}
.q{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--card);transition:border-color .15s,background .15s}
.q:hover{border-color:var(--ink);background:#fff}
.q b{display:block;font-size:14px}.q small{font-size:12px;color:var(--muted)}
.q .p{font-weight:700;font-size:16px;text-align:right}.q .p small{display:block;font-weight:500}
.q.hot{background:var(--accent-soft);border-color:#FFD8C7}.q.hot .p{color:var(--accent-ink)}
/* posters */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.poster{display:flex;flex-direction:column;border-radius:var(--r);overflow:hidden;background:var(--card);border:1px solid var(--line);transition:transform .2s,box-shadow .2s}
.poster:hover{transform:translateY(-3px);box-shadow:0 22px 44px -20px rgba(21,23,28,.35)}
.art{position:relative;aspect-ratio:3/4;padding:18px;display:flex;flex-direction:column;justify-content:flex-end;color:#fff;overflow:hidden}
.art:before{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 80% 10%,rgba(255,255,255,.28),transparent 55%),linear-gradient(180deg,transparent 40%,rgba(0,0,0,.55))}
.art .tag{position:absolute;top:14px;left:14px;font-size:11px;font-weight:700;letter-spacing:.08em;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);padding:5px 9px;border-radius:999px}
.art h3{position:relative;margin:0;font-size:30px;line-height:.98;letter-spacing:-.03em;font-weight:800;text-transform:uppercase}
.art .rings{position:absolute;right:-40px;top:30px;width:200px;height:200px;border-radius:50%;border:1px solid rgba(255,255,255,.25);box-shadow:0 0 0 22px rgba(255,255,255,.06),0 0 0 44px rgba(255,255,255,.04)}
.meta{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.meta div{font-size:13px;color:var(--muted);line-height:1.35}.meta div b{display:block;color:var(--ink);font-size:14px}
.meta .btn{flex:none}
/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 18px;border:0;border-radius:999px;background:var(--ink);color:#fff;font:600 15px/1 inherit;cursor:pointer;transition:transform .1s,background .15s}
.btn:hover{background:#2A2D35}.btn:active{transform:scale(.98)}.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.sm{height:36px;padding:0 14px;font-size:13px}.btn.ghost{background:#EFEBE4;color:var(--ink)}.btn.ghost:hover{background:#E6E1D8}
.btn.go{height:54px;width:100%;font-size:16px;background:var(--accent)}.btn.go:hover{background:#F04A0F}
/* booking */
.back{display:inline-flex;align-items:center;gap:6px;margin:28px 0 18px;font-size:14px;font-weight:600;color:var(--ink2)}.back:hover{color:var(--ink)}
.book{display:grid;grid-template-columns:1fr 360px;gap:22px;align-items:start;padding-bottom:60px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px}
.panel h2{margin:0 0 4px;font-size:20px;letter-spacing:-.02em}.panel .sub{color:var(--muted);font-size:14px}
.head{display:flex;gap:20px;align-items:center}
.mini{flex:none;width:92px;aspect-ratio:3/4;border-radius:14px;position:relative;overflow:hidden}
.head h1{margin:0;font-size:30px;letter-spacing:-.03em;line-height:1.1}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.facts span{font-size:13px;padding:6px 10px;border-radius:10px;background:#F4F1EC;color:var(--ink2)}
.pass{display:flex;gap:12px;align-items:flex-start;margin:18px 0 0;padding:14px 16px;border-radius:16px;background:var(--ok-soft);color:#0B6E3E;font-size:14px}
.pass svg{flex:none;margin-top:1px}
.pax{display:grid;grid-template-columns:36px 1fr 110px;gap:10px;align-items:center;margin-top:12px}
.pax .n{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#F1EEE8;font-weight:700;font-size:13px}
input{width:100%;height:48px;padding:0 14px;border:1px solid var(--line);border-radius:14px;font:inherit;background:#FCFBF9;outline:none;transition:border-color .15s,background .15s}
input:focus{border-color:var(--ink);background:#fff}
.addrow{margin-top:14px}
.sum{position:sticky;top:88px}
.sum .row{display:flex;justify-content:space-between;font-size:14px;color:var(--ink2);margin:8px 0}
.sum .tot{display:flex;justify-content:space-between;align-items:baseline;margin:18px 0;padding-top:16px;border-top:1px dashed var(--line)}
.sum .tot b{font-size:30px;letter-spacing:-.03em}
.err{color:var(--bad);font-size:14px;min-height:20px;margin-top:12px}
.fine{margin-top:12px;font-size:12px;color:var(--muted);text-align:center}
/* boarding pass */
.bp{max-width:620px;margin:40px auto 70px;background:var(--card);border:1px solid var(--line);border-radius:28px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(21,23,28,.35)}
.bp-top{background:var(--ink);color:#fff;padding:26px 30px}
.bp-top .ok{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#7EE2A8}
.bp-top h1{margin:10px 0 2px;font-size:30px;letter-spacing:-.03em}.bp-top p{margin:0;color:rgba(255,255,255,.65)}
.bp-mid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:24px 30px}
.bp-mid small{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.bp-mid b{font-size:20px;letter-spacing:-.02em}
.bp-cut{position:relative;border-top:2px dashed var(--line);margin:0 18px}
.bp-cut:before,.bp-cut:after{content:"";position:absolute;top:-13px;width:24px;height:24px;border-radius:50%;background:var(--bg)}
.bp-cut:before{left:-31px}.bp-cut:after{right:-31px}
.bp-bot{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 30px}
.pnr small{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.pnr b{font:700 26px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}
.code{display:flex;gap:2px;height:46px;align-items:stretch}.code i{display:block;background:var(--ink);border-radius:1px}
.via{display:inline-flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;color:#0B6E3E;background:var(--ok-soft);padding:5px 10px;border-radius:999px}
/* busy page */
.busy{max-width:560px;margin:80px auto;text-align:center;padding:0 24px}
.busy .ic{display:grid;place-items:center;width:84px;height:84px;margin:0 auto 22px;border-radius:26px;background:var(--bad-soft);color:var(--bad)}
.busy h1{margin:0 0 10px;font-size:36px;letter-spacing:-.03em}.busy p{color:var(--ink2);font-size:17px;margin:0 0 26px}
.busy .code503{display:inline-block;margin-top:22px;font:600 12px ui-monospace,Menlo,monospace;color:var(--muted)}
.foot{border-top:1px solid var(--line);margin-top:30px}.foot .wrap{display:flex;justify-content:space-between;padding:26px 24px;font-size:13px;color:var(--muted)}
@media (max-width:860px){.ticket{grid-template-columns:1fr}.t-side{border-left:0;border-top:2px dashed var(--line);min-width:0}.t-side:before,.t-side:after{display:none}.book{grid-template-columns:1fr}.sum{position:static}.hero h1{font-size:40px}.tabs{display:none}.bp-mid{grid-template-columns:1fr 1fr}}
`;

const ICON = {
  shield: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>`,
  busy: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>`,
};

/** A poster colour from a curated set, by the show's place in the catalogue, so neighbours never clash. */
const POSTERS = [
  ["#E4572E", "#5C1A0B"],
  ["#0E8C72", "#062F28"],
  ["#F2A93B", "#6B3D00"],
  ["#3D5AFE", "#0C1546"],
  ["#D81B60", "#45081F"],
  ["#2B2D42", "#0B0C14"],
  ["#7CB518", "#24400A"],
  ["#8D6A9F", "#2A1B33"],
];
function poster(i: number) {
  const [a, b] = POSTERS[((i % POSTERS.length) + POSTERS.length) % POSTERS.length]!;
  return `background:linear-gradient(155deg,${a},${b})`;
}

const nav = () => `<nav class="nav"><div class="wrap">
<a class="logo" href="/"><i>Q</i>QuickBook</a>
<div class="tabs"><a href="/#trains">Trains</a><a href="/#movies">Movies</a></div>
<span class="help">Trains · Movies</span>
</div></nav>`;

const foot = () => `<footer class="foot"><div class="wrap"><span>© QuickBook</span><span>Demo booking site for SurgePass</span></div></footer>`;

export function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · QuickBook</title><style>${CSS}</style></head>
<body>${nav()}<main class="wrap">${body}</main>${foot()}</body></html>`;
}

/** The page an overloaded backend serves (what the crash demo shows). */
export function busyPage() {
  return page(
    "Service unavailable",
    `<div class="busy"><div class="ic">${ICON.busy}</div><h1>We're experiencing heavy traffic</h1><p>Too many requests are hitting QuickBook right now. Your booking wasn't made. Please try again in a few minutes.</p><a class="btn ghost" href="/">Back to home</a><div class="code503">503 · Service unavailable</div></div>`,
  );
}

export function homePage(catalog: any, seatsLeft: (key: string) => number = () => 0) {
  const trains = catalog.trains
    .map((t: any) => {
      const base = `/tatkal/book/${t.trainNo}/${t.date}/${t.class}`;
      const day = new Date(`${t.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      const quota = (q: string, label: string, sub: string, hot = false) =>
        `<a class="q${hot ? " hot" : ""}" href="${base}?quota=${q}"><span><b>${label}</b><small>${seatsLeft(`${t.trainNo}:${q}`)} seats left · ${sub}</small></span><span class="p">${q === "PT" ? `from ${inr(t.fareInr * 2)}` : inr(t.fareInr)}<small>per seat</small></span></a>`;
      return `<article class="ticket">
  <div class="t-main">
    <div class="t-top"><span class="no">${esc(t.trainNo)}</span><span class="t-name">${esc(t.name)}</span><span class="cls">${esc(t.class)}</span></div>
    <div class="route">
      <div class="stn"><b>${esc(t.departs)}</b><span>${esc(t.from)}</span></div>
      <div class="line"><em>${esc(day)}</em></div>
      <div class="stn r"><b>${esc(t.to.replace(/ (Jn|Central)$/, ""))}</b><span>${esc(t.to)}</span></div>
    </div>
  </div>
  <div class="t-side">${quota("TQ", "Tatkal", "opens 10:00", true)}${quota("PT", "Premium Tatkal", "dynamic fare")}</div>
</article>`;
    })
    .join("");
  const movies = catalog.movies
    .map(
      (m: any, i: number) => `<a class="poster" href="/book/${m.movieId}/${m.showId}">
  <div class="art" style="${poster(i)}"><span class="rings"></span><span class="tag">${esc(m.time)}</span><h3>${esc(m.title)}</h3></div>
  <div class="meta"><div><b>${esc(m.theatre.split(" · ")[0])}</b>${esc(m.theatre.split(" · ")[1] ?? "")} · ${inr(m.priceInr)} · ${seatsLeft(`${m.movieId}:${m.showId}`)} left</div><span class="btn sm">Book</span></div>
</a>`,
    )
    .join("");
  return page(
    "Trains, movies and events",
    `<section class="hero">
  <span class="eyebrow"><b></b>Tatkal opens daily at 10:00 AM</span>
  <h1>Your seat, <em>booked</em> before the coffee's ready.</h1>
  <p>Trains across India and the city's biggest first-day shows. Pick, pay, and you're done.</p>
  <div class="chips"><div class="chip"><b>${catalog.trains.length}</b><span>trains booking now</span></div><div class="chip"><b>${catalog.movies.length}</b><span>first-day shows</span></div><div class="chip"><b>Instant</b><span>e-tickets</span></div></div>
</section>
<section class="sec" id="trains"><div class="sec-h"><h2>Trains</h2><span>Tatkal and Premium Tatkal quota</span></div>${trains}</section>
<section class="sec" id="movies"><div class="sec-h"><h2>Now showing</h2><span>First-day shows</span></div><div class="grid">${movies}</div></section>`,
  );
}

export function bookingPage(o: {
  kind: "train" | "movie";
  title: string;
  subtitle: string;
  fare: number;
  maxSeats: number;
  assertion: Assertion | null;
  confirmUrl: string;
  seatsLeft: number;
  /** The show's place in the catalogue, for its poster colour. */
  art?: number;
}) {
  const pass = o.assertion
    ? `<div class="pass">${ICON.shield}<div><b>Admitted through SurgePass</b>${o.assertion.partner ? ` · authorised partner <b>${esc(o.assertion.partner)}</b>` : ""}<br>You can book up to <b>${o.assertion.seats}</b> seat${o.assertion.seats === 1 ? "" : "s"}${o.assertion.pool === "premium" ? ` at the premium price of <b>${inr(o.assertion.price ?? 0)}</b> per seat` : ""}.</div></div>`
    : "";
  const what = o.kind === "train" ? "passenger" : "seat";
  const head =
    o.kind === "movie"
      ? `<div class="head"><div class="mini" style="${poster(o.art ?? 0)}"></div><div><h1>${esc(o.title)}</h1><div class="sub">${esc(o.subtitle)}</div><div class="facts"><span>${o.seatsLeft} seats left</span><span>${inr(o.fare)} per seat</span><span>Up to ${o.maxSeats} per booking</span></div></div></div>`
      : `<h1 style="margin:0;font-size:30px;letter-spacing:-.03em;line-height:1.1">${esc(o.title)}</h1><div class="sub" style="margin-top:4px">${esc(o.subtitle)}</div><div class="facts"><span>${o.seatsLeft} seats left</span><span>${inr(o.fare)} per seat</span><span>Up to ${o.maxSeats} per booking</span></div>`;
  return page(
    o.title,
    `<a class="back" href="/">${ICON.back} All ${o.kind === "train" ? "trains" : "shows"}</a>
<div class="book">
  <div>
    <section class="panel">${head}${pass}</section>
    <section class="panel" style="margin-top:16px">
      <h2>${o.kind === "train" ? "Passengers" : "Your seats"}</h2>
      <div class="sub">${o.kind === "train" ? "Names as on a government photo ID." : "One name per seat."}</div>
      <div id="pax"></div>
      <div class="addrow"><button class="btn ghost sm" id="add" type="button">+ Add ${what}</button></div>
    </section>
  </div>
  <aside class="panel sum">
    <h2>Fare summary</h2>
    <div class="row"><span>${o.kind === "train" ? "Ticket fare" : "Ticket price"}</span><span>${inr(o.fare)} × <span id="n">1</span></span></div>
    <div class="row"><span>Convenience fee</span><span>₹0</span></div>
    <div class="tot"><span>Total</span><b id="total">${inr(o.fare)}</b></div>
    <button class="btn go" id="pay" type="button">Pay and confirm</button>
    <div class="err" id="err"></div>
    <div class="fine">Seats are confirmed instantly after payment.</div>
  </aside>
</div>
<script>
const MAX=${o.maxSeats},FARE=${o.fare},URL_=${JSON.stringify(o.confirmUrl)},WHAT=${JSON.stringify(what)};
const pax=document.getElementById('pax'),add=document.getElementById('add'),err=document.getElementById('err'),pay=document.getElementById('pay');
function row(){const d=document.createElement('div');d.className='pax';d.innerHTML='<span class="n"></span><input placeholder="Full name" autocomplete="name"><input placeholder="Age" inputmode="numeric">';pax.appendChild(d);sync();d.children[1].focus()}
function sync(){const n=pax.children.length;[...pax.children].forEach((r,i)=>r.children[0].textContent=i+1);add.disabled=n>=MAX;add.textContent=n>=MAX?'Limit: '+MAX+' '+WHAT+(MAX===1?'':'s'):'+ Add '+WHAT;document.getElementById('n').textContent=n;document.getElementById('total').textContent='₹'+(n*FARE).toLocaleString('en-IN')}
add.onclick=row;row();
pay.onclick=async()=>{
  const passengers=[...pax.children].map(r=>({name:r.children[1].value,age:r.children[2].value})).filter(p=>p.name.trim());
  err.textContent='';pay.disabled=true;pay.textContent='Confirming…';
  try{
    const res=await fetch(URL_,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({passengers})});
    const j=await res.json().catch(()=>({error:res.status===503?'We are experiencing heavy traffic. Please try again.':'Something went wrong'}));
    if(j.ok){location.href=j.redirect;return}
    err.textContent=j.error||('Error '+res.status);
  }catch(e){err.textContent='Could not reach QuickBook. Please try again.'}
  pay.disabled=false;pay.textContent='Pay and confirm';
};
</script>`,
  );
}

export function successPage(b: { pnr: string; item: string; seats: number; amount: number; pool?: string; at?: number }) {
  const bars = Array.from(b.pnr + "QUICKBOOK")
    .map((ch, i) => `<i style="width:${((ch.charCodeAt(0) + i) % 3) + 1}px"></i>`)
    .join("");
  const via = b.pool && b.pool !== "direct" ? `<span class="via">${ICON.shield} Booked through SurgePass${b.pool.startsWith("partner") ? " · authorised partner" : b.pool === "premium" ? " · premium" : ""}</span>` : "";
  const when = b.at ? new Date(b.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return page(
    "Booking confirmed",
    `<div class="bp">
  <div class="bp-top"><span class="ok">${ICON.check} Booking confirmed</span><h1>${esc(b.item)}</h1><p>E-ticket sent · ${esc(when)}</p></div>
  <div class="bp-mid"><div><small>Seats</small><b>${b.seats}</b></div><div><small>Amount paid</small><b>${inr(b.amount)}</b></div><div><small>Status</small><b style="color:var(--ok)">Confirmed</b></div></div>
  <div class="bp-cut"></div>
  <div class="bp-bot"><div class="pnr"><small>PNR</small><b>${esc(b.pnr)}</b>${via ? `<div>${via}</div>` : ""}</div><div class="code" aria-hidden="true">${bars}</div></div>
</div>
<div style="text-align:center;margin-bottom:60px"><a class="btn ghost" href="/">Book something else</a></div>`,
  );
}
