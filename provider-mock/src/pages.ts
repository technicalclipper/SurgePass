import type { Assertion } from "./assertion.ts";

// Plain server-rendered pages for an ordinary booking site.

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f2f4f8;color:#1d2433}
header{background:#1f4fbf;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:10px}
header b{font-size:18px;letter-spacing:.2px}header span{opacity:.8;font-size:13px}
main{max-width:760px;margin:24px auto;padding:0 16px}
.card{background:#fff;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}.muted{color:#5d6679;font-size:13px}
a.row{display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #eef0f4;color:inherit;text-decoration:none}
a.row:first-of-type{border-top:0}a.row:hover b{color:#1f4fbf}
input{width:100%;padding:10px;border:1px solid #cfd5df;border-radius:6px;font:inherit}
.pax{display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:8px}
button{background:#1f4fbf;color:#fff;border:0;border-radius:6px;padding:11px 18px;font:600 15px/1 inherit;cursor:pointer}
button.ghost{background:#eef2fb;color:#1f4fbf}button:disabled{opacity:.5;cursor:not-allowed}
.note{background:#eef6ee;border:1px solid #cfe7cf;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:14px}
.err{color:#b42318;font-size:13px;margin-top:10px;min-height:18px}
.total{display:flex;justify-content:space-between;font-weight:600;margin:14px 0}
`;

export function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · QuickBook</title><style>${CSS}</style></head>
<body><header><b>QuickBook</b><span>Trains · Movies · Events</span></header><main>${body}</main></body></html>`;
}

export function homePage(catalog: any) {
  const trains = catalog.trains
    .map(
      (t: any) =>
        `<a class="row" href="/tatkal/book/${t.trainNo}/${t.date}/${t.class}?quota=TQ"><span><b>${esc(t.trainNo)} · ${esc(t.name)}</b><br><span class="muted">${esc(t.from)} → ${esc(t.to)} · ${esc(t.date)} · ${esc(t.class)}</span></span><span>₹${t.fareInr}</span></a>`,
    )
    .join("");
  const movies = catalog.movies
    .map(
      (m: any) =>
        `<a class="row" href="/book/${m.movieId}/${m.showId}"><span><b>${esc(m.title)}</b><br><span class="muted">${esc(m.theatre)} · ${esc(m.time)}</span></span><span>₹${m.priceInr}</span></a>`,
    )
    .join("");
  return page("Home", `<div class="card"><h2>Tatkal trains</h2>${trains}</div><div class="card"><h2>Movies</h2>${movies}</div>`);
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
}) {
  const note = o.assertion
    ? `<div class="note">Admitted with a SurgePass pass${o.assertion.partner ? ` · authorised partner <b>${esc(o.assertion.partner)}</b>` : ""} · up to <b>${o.assertion.seats}</b> seat(s)${o.assertion.pool === "premium" ? ` · premium price <b>₹${o.assertion.price}</b> per seat` : ""}</div>`
    : "";
  return page(
    o.title,
    `<div class="card"><h1>${esc(o.title)}</h1><div class="muted">${esc(o.subtitle)}</div><div class="muted" style="margin-top:6px">${o.seatsLeft} seats left · ₹${o.fare} per seat</div></div>
<div class="card">${note}<h2>${o.kind === "train" ? "Passengers" : "Seats"}</h2>
<div id="pax"></div>
<button class="ghost" id="add" type="button">+ Add ${o.kind === "train" ? "passenger" : "seat"}</button>
<div class="total"><span>Total</span><span id="total">₹0</span></div>
<button id="pay" type="button">Pay and confirm</button>
<div class="err" id="err"></div></div>
<script>
const MAX=${o.maxSeats},FARE=${o.fare},URL_=${JSON.stringify(o.confirmUrl)};
const pax=document.getElementById('pax'),add=document.getElementById('add'),err=document.getElementById('err');
function row(){const d=document.createElement('div');d.className='pax';d.innerHTML='<input placeholder="Full name"><input placeholder="Age" inputmode="numeric">';pax.appendChild(d);sync()}
function sync(){const n=pax.children.length;add.disabled=n>=MAX;add.textContent=n>=MAX?'Limit: '+MAX+' seat(s)':'+ Add ${o.kind === "train" ? "passenger" : "seat"}';document.getElementById('total').textContent='₹'+(n*FARE).toLocaleString('en-IN')}
add.onclick=row;row();
document.getElementById('pay').onclick=async()=>{
  const passengers=[...pax.children].map(r=>({name:r.children[0].value,age:r.children[1].value})).filter(p=>p.name.trim());
  err.textContent='';
  const res=await fetch(URL_,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({passengers})});
  const j=await res.json().catch(()=>({error:'Something went wrong'}));
  if(j.ok) location.href=j.redirect; else err.textContent=j.error||('Error '+res.status);
};
</script>`,
  );
}

export function successPage(b: { pnr: string; item: string; seats: number; amount: number }) {
  return page(
    "Booked",
    `<div class="card"><h1>Booking confirmed</h1><p class="muted">PNR <b>${esc(b.pnr)}</b></p><p>${esc(b.item)} · ${b.seats} seat(s) · ₹${b.amount.toLocaleString("en-IN")}</p><a href="/">Back to home</a></div>`,
  );
}
