// k6 bot flood: the same traffic hits the site behind SurgePass and the one without it.
//   k6 run -e RATE=2000 -e DURATION=60s loadgen/bots.js
import http from "k6/http";

const RATE = Number(__ENV.RATE || 2000);
const GATED = __ENV.GATED || "http://localhost:8080";
const DIRECT = __ENV.DIRECT || "http://localhost:4001";
const BOOK = "/tatkal/book/12007/2026-11-06/CC?quota=TQ";
const AVAIL = "/availability/12007/2026-11-06/CC?quota=TQ";

export const options = {
  discardResponseBodies: true,
  scenarios: {
    gated: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: __ENV.DURATION || "60s", preAllocatedVUs: 400, maxVUs: 2000, exec: "gated" },
    direct: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: __ENV.DURATION || "60s", preAllocatedVUs: 400, maxVUs: 2000, exec: "direct" },
  },
};

function hit(base) {
  const r = Math.random();
  if (r < 0.5) http.get(base + BOOK, { redirects: 0 });
  else if (r < 0.9) http.get(base + AVAIL);
  else http.post(base + BOOK.replace("?", "/confirm?"), JSON.stringify({ passengers: [{ name: "bot" }] }), { headers: { "content-type": "application/json" } });
}

export function gated() {
  hit(GATED);
}
export function direct() {
  hit(DIRECT);
}
