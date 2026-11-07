import { CircularState } from "@worldcoin/mini-apps-ui-kit-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { bidCommitment, clearPremium, runDraw, winnersHash } from "@surgepass/shared";
import { api } from "../lib/api";
import { navigate } from "../App";
import { Card, Header, Mark, PrimaryButton, Row, Screen, Spinner } from "../ui/kit";

// "Don't trust us, check it yourself." Reads the drop's HCS topic straight from Hedera's public
// mirror node (not from SurgePass), rebuilds the entry list up to the committed cutoff, and
// recomputes the result in this browser.

const MIRROR = "https://testnet.mirrornode.hedera.com";

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export function Verify({ dropId }: { dropId: string }) {
  const [bundle, setBundle] = useState<any>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<"hedera" | "gateway">("gateway");

  useEffect(() => {
    void api.verify(dropId).then(setBundle);
  }, [dropId]);

  async function run() {
    setRunning(true);
    setChecks([]);
    const out: Check[] = [];
    const push = async (c: Check) => {
      out.push(c);
      setChecks([...out]);
      await new Promise((r) => setTimeout(r, 380));
    };
    try {
      const topic: string | undefined = bundle.hcsTopicId;
      let messages: { seq: number; consensusAt: string; message: any }[] = [];
      if (topic && !topic.startsWith("local-")) {
        setSource("hedera");
        messages = await readMirror(topic);
        await push({ label: "Read the topic from Hedera's mirror node", ok: messages.length > 0, detail: `${messages.length} messages on ${topic}` });
      } else {
        await push({ label: "Read the entry log", ok: true, detail: "Local mode: log served by the gateway" });
      }

      const closed = messages.find((m) => m.message.t === "window_closed")?.message;
      const resultMsg = messages.find((m) => m.message.t === "result")?.message;
      const r = bundle.result;
      if (!r) {
        await push({ label: "Draw has run", ok: false, detail: "No result yet" });
        return;
      }
      const lastSeq = closed?.last_seq ?? r.lastSeq;
      await push({ label: "Cutoff was written before the seed", ok: !closed || closed.seed_tx_id === r.seedTxId, detail: `seed tx ${short(r.seedTxId)} committed in window_closed` });

      if (bundle.premium) {
        const commits = messages.length
          ? messages.filter((m) => m.message.t === "bid_commit" && m.seq <= lastSeq).map((m) => ({ anonId: m.message.anon_id, commit: m.message.commit_hash, seq: m.seq, seats: m.message.seats }))
          : bundle.premium.commits.map((c: any) => ({ ...c, seats: bundle.premium.revealed.find((x: any) => x.anonId === c.anonId)?.seats ?? 1 }));
        const reveals = messages.length
          ? messages.filter((m) => m.message.t === "bid_reveal").map((m) => ({ anonId: m.message.anon_id, amount: m.message.amount, secret: m.message.secret }))
          : [];
        let matched = 0;
        for (const rv of reveals) if (commits.find((c: any) => c.anonId === rv.anonId)?.commit === bidCommitment(rv.amount, rv.secret)) matched++;
        if (reveals.length) await push({ label: "Every reveal matches its sealed commitment", ok: matched === reveals.length, detail: `${matched} / ${reveals.length} reveals` });
        const bids = (reveals.length ? reveals : bundle.premium.revealed).map((b: any) => ({ anonId: b.anonId, amount: b.amount, seats: commits.find((c: any) => c.anonId === b.anonId)?.seats ?? b.seats ?? 1, seq: commits.find((c: any) => c.anonId === b.anonId)?.seq ?? 0 }));
        const drop = await api.drop(dropId);
        const cleared = clearPremium(bids, drop.seats, drop.premium!.floorInr, drop.premium!.ceilingInr, r.seed);
        await push({ label: "Clearing price = highest losing bid", ok: cleared.clearingPriceInr === r.clearingPriceInr, detail: `₹${cleared.clearingPriceInr}` });
        const h = winnersHash(cleared.winners);
        await push({ label: "The seat list matches the published result", ok: h === (resultMsg?.winners_hash ?? r.winnersHash), detail: `${h.slice(0, 16)}…` });
      } else {
        const entries = messages.length
          ? messages.filter((m) => m.message.t === "entry" && m.seq <= lastSeq).map((m) => ({ anonId: m.message.anon_id, seats: m.message.seats, seq: m.seq }))
          : bundle.entries;
        await push({ label: "Entries up to the cutoff", ok: entries.length === r.entryCount, detail: `${entries.length} entries, last #${lastSeq}` });
        await push({ label: "Seed matches the published result", ok: !resultMsg || resultMsg.seed === r.seed, detail: `${r.seed.slice(0, 18)}…` });
        const seats = closed?.seats ?? (await api.drop(dropId)).seats;
        const again = runDraw(entries, r.seed, seats);
        const h = winnersHash(again.winners);
        await push({ label: "Fisher–Yates recomputed in your browser", ok: h === (resultMsg?.winners_hash ?? r.winnersHash), detail: `${again.winners.length} ${again.winners.length === 1 ? "person" : "people"} in · ${h.slice(0, 16)}…` });
      }
    } catch (e: any) {
      await push({ label: "Could not complete verification", ok: false, detail: e.message });
    } finally {
      setRunning(false);
    }
  }

  const allOk = checks && checks.length > 0 && !running && checks.every((c) => c.ok);
  return (
    <Screen bottom={bundle?.result && <PrimaryButton loading={running} onClick={run}>{checks?.length ? "Run again" : "Recompute"}</PrimaryButton>}>
      <Header onBack={() => navigate(`/_sp/room/${dropId}`)} right={<Mark />} />
      <h1 className="pt-2 text-3xl font-semibold leading-narrow tracking-[-0.01em]">Check it yourself</h1>
      <div className="mt-2 text-base text-gray-500">Rebuild this draw from Hedera's public record and compare it with the published winners.</div>
      {!bundle ? (
        <div className="grid h-48 place-items-center">
          <Spinner />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {checks?.map((c, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="flex items-center gap-3">
                <div className="shrink-0"><CircularState value={c.ok ? "success" : "error"} size="sm" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{c.label}</div>
                  {c.detail && <div className="truncate font-mono text-xs text-gray-500">{c.detail}</div>}
                </div>
              </Card>
            </motion.div>
          ))}
          {allOk && (
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-2 rounded-[28px] bg-success-100 p-6 text-center">
              <div className="text-3xl font-semibold text-success-700">✓ Matches Hedera</div>
              <div className="mt-1 text-sm text-success-700">{source === "hedera" ? "Computed from the mirror node, not from SurgePass." : "Computed in your browser."}</div>
            </motion.div>
          )}
          {!checks?.length && (
            <>
              <Row label="Method" sub={bundle.premium ? "Uniform price: highest losing bid; ties by Hedera seed" : "Fisher–Yates over HCS order, sha256(seed ‖ counter)"} />
              {bundle.topicLink && <Row label="HCS topic" sub={bundle.hcsTopicId} value="HashScan ↗" accent="info" onClick={() => window.open(bundle.topicLink, "_blank")} />}
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

async function readMirror(topic: string) {
  const out: { seq: number; consensusAt: string; message: any }[] = [];
  let next: string | null = `/api/v1/topics/${topic}/messages?limit=100&order=asc`;
  while (next) {
    const j: any = await (await fetch(MIRROR + next)).json();
    for (const m of j.messages ?? []) {
      try {
        out.push({ seq: m.sequence_number, consensusAt: m.consensus_timestamp, message: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m.message), (ch) => ch.charCodeAt(0)))) });
      } catch {
        // not one of ours
      }
    }
    next = j.links?.next ?? null;
  }
  return out;
}

const short = (tx?: string) => (tx && tx.length > 28 ? `${tx.slice(0, 14)}…${tx.slice(-8)}` : tx ?? "");
