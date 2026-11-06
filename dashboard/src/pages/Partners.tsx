import { useEffect, useState } from "react";
import { admin, hashscanTx, type Drop } from "../lib/api";
import { useLive } from "../lib/live";
import { Btn, Field, inputCls, inr, Kpi, Panel, Pill } from "../ui/console";

// Partner lane: who's allowlisted, what they've held, booked and forfeited, and the proof that
// Hedera itself refuses seats for anyone else.

interface Partner {
  account: string;
  name: string;
  publicKey: string;
  keyType: string;
  status: "active" | "frozen";
  createdAt: number;
  stats: Record<string, number>;
}

interface Hold {
  id: string;
  partner: string;
  partnerName?: string;
  seats: number;
  status: string;
  consensusAt?: string;
  seq?: number;
  serials: number[];
  deposit: { amountInr: number; txId: string };
  booked?: number;
  transferTx?: string;
}

export function PartnersPage() {
  const live = useLive();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [dropId, setDropId] = useState<string>("");
  const [holds, setHolds] = useState<{ holds: Hold[]; tokenId?: string; tokenLink?: string; seatsLeft: number } | null>(null);
  const [form, setForm] = useState({ name: "", account: "", publicKey: "" });
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState({ account: "0.0.local-tout", result: null as null | { refused: boolean; code: string; link?: string } });

  const load = async () => {
    setPartners((await admin<{ partners: Partner[] }>("/partners")).partners);
    const ds = (await admin<{ drops: Drop[] }>("/drops")).drops.filter((d) => d.pool === "partner");
    setDrops(ds);
    const id = dropId || ds[0]?.id || "";
    if (id) {
      setDropId(id);
      setHolds(await admin(`/partners/holds/${id}`));
    }
  };
  useEffect(() => {
    void load();
  }, [dropId]);
  const lastEvent = live.events.at(-1)?.ts;
  useEffect(() => {
    const t = setTimeout(() => void load(), 400);
    return () => clearTimeout(t);
  }, [lastEvent]);

  const total = (k: string) => partners.reduce((s, p) => s + (p.stats[k] ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Partners</h1>
        <p className="mt-1 text-sm text-gray-500">
          Authorised partners get their own quota. Only allowlisted Hedera accounts can hold seat tokens, holding needs a refundable deposit, and unused seats go back to the public.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi label="Allowlisted partners" value={partners.filter((p) => p.status === "active").length} sub={`${partners.filter((p) => p.status === "frozen").length} frozen`} />
        <Kpi label="Seats issued" value={total("seatsIssued")} />
        <Kpi label="Seats booked" value={total("seatsBooked")} tone="success" />
        <Kpi label="Seats reclaimed → public" value={total("seatsReclaimed")} tone="warning" />
        <Kpi label="Deposits refunded" value={inr(total("refundsInr"))} />
        <Kpi label="Deposits kept" value={inr(total("forfeitedInr"))} sub={`${inr(total("lookFeesInr"), 2)} lookup fees`} />
      </div>

      <Panel title="Allowlist">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="pb-3 font-medium">Partner</th>
              <th className="pb-3 font-medium">Hedera account</th>
              <th className="pb-3 font-medium">Holds</th>
              <th className="pb-3 font-medium">Issued · booked · reclaimed</th>
              <th className="pb-3 font-medium">Look-to-book</th>
              <th className="pb-3 font-medium">Deposits</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {partners.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">
                  No partners yet
                </td>
              </tr>
            )}
            {partners.map((p) => {
              const s = p.stats;
              const ltb = s.seatsBooked ? Math.round(((s.looks ?? 0) / s.seatsBooked) * 10) / 10 : s.looks ? "∞" : "—";
              return (
                <tr key={p.account} className="border-b border-gray-50">
                  <td className="py-3 font-semibold">{p.name}</td>
                  <td className="py-3 font-mono text-xs">
                    {p.account}
                    <div className="text-2xs text-gray-400">{p.keyType} key</div>
                  </td>
                  <td className="py-3 tabular">{s.holds ?? 0}</td>
                  <td className="py-3 tabular">
                    {s.seatsIssued ?? 0} · <span className="text-success-700">{s.seatsBooked ?? 0}</span> · <span className="text-warning-700">{s.seatsReclaimed ?? 0}</span>
                  </td>
                  <td className="py-3 tabular">{ltb}{typeof ltb === "number" ? " : 1" : ""}</td>
                  <td className="py-3 text-xs tabular">
                    {inr(s.depositsInr ?? 0)} paid · {inr(s.refundsInr ?? 0)} back · {inr(s.forfeitedInr ?? 0)} kept
                  </td>
                  <td className="py-3">
                    <Pill kind={p.status === "active" ? "open" : "crashed"}>{p.status}</Pill>
                  </td>
                  <td className="py-3 text-right">
                    <Btn
                      kind={p.status === "active" ? "danger" : "ghost"}
                      onClick={async () => {
                        await admin(`/partners/${p.account}/freeze`, { method: "POST", body: JSON.stringify({ frozen: p.status === "active" }) });
                        void load();
                      }}
                    >
                      {p.status === "active" ? "Freeze" : "Unfreeze"}
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <form
          className="mt-5 grid grid-cols-[1fr_1fr_2fr_auto] items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await admin("/partners", { method: "POST", body: JSON.stringify({ ...form, publicKey: form.publicKey || undefined }) });
              setForm({ name: "", account: "", publicKey: "" });
              void load();
            } catch (x: any) {
              setErr(x.message);
            }
          }}
        >
          <Field label="Partner name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="TripNest" />
          </Field>
          <Field label="Hedera account">
            <input className={`${inputCls} font-mono text-xs`} value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="0.0.12345" />
          </Field>
          <Field label="Public key" hint="Leave empty on testnet: it's read from the mirror node">
            <input className={`${inputCls} font-mono text-xs`} value={form.publicKey} onChange={(e) => setForm({ ...form, publicKey: e.target.value })} placeholder="optional" />
          </Field>
          <Btn type="submit">Allowlist</Btn>
        </form>
        {err && <div className="mt-2 text-sm text-error-600">{err}</div>}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Holds · in Hedera consensus order"
          right={
            drops.length > 1 ? (
              <select className={inputCls} value={dropId} onChange={(e) => setDropId(e.target.value)}>
                {drops.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : holds?.tokenLink ? (
              <a href={holds.tokenLink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-info-600">
                Seat token {holds.tokenId} ↗
              </a>
            ) : (
              <span className="font-mono text-2xs text-gray-400">{holds?.tokenId}</span>
            )
          }
        >
          <div className="mb-3 text-sm text-gray-500">{holds ? `${holds.seatsLeft} partner seat(s) left` : "No partner drop"}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Partner</th>
                <th className="pb-2 font-medium">Consensus time</th>
                <th className="pb-2 font-medium">Seats</th>
                <th className="pb-2 font-medium">Seat tokens</th>
                <th className="pb-2 font-medium">Deposit</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {holds?.holds.map((h, i) => (
                <tr key={h.id} className="border-b border-gray-50">
                  <td className="py-2 text-xs text-gray-400">{i + 1}</td>
                  <td className="py-2 font-semibold">{h.partnerName}</td>
                  <td className="py-2 font-mono text-2xs text-gray-500">{h.consensusAt}</td>
                  <td className="py-2 tabular">
                    {h.booked !== undefined ? `${h.booked}/` : ""}
                    {h.seats}
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {h.serials.length ? `#${h.serials.join(" #")}` : "—"}
                    {hashscanTx(h.transferTx) && (
                      <a className="ml-2 font-sans font-semibold text-info-600" href={hashscanTx(h.transferTx)} target="_blank" rel="noreferrer">
                        tx ↗
                      </a>
                    )}
                  </td>
                  <td className="py-2 text-xs tabular">{inr(h.deposit.amountInr)}</td>
                  <td className="py-2">
                    <Pill kind={h.status === "booked" ? "open" : h.status === "expired" || h.status === "refused" ? "crashed" : h.status === "issued" ? "revealing" : "scheduled"}>{h.status.replace("_", " ")}</Pill>
                  </td>
                </tr>
              ))}
              {!holds?.holds.length && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-gray-400">
                    No holds yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="Prove it: send a seat to a stranger">
          <p className="text-sm text-gray-500">Try to hand one seat token to an account that isn't allowlisted. The refusal comes from Hedera, not from SurgePass.</p>
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Account">
              <input className={`${inputCls} font-mono text-xs`} value={probe.account} onChange={(e) => setProbe({ ...probe, account: e.target.value })} />
            </Field>
            <Btn
              kind="secondary"
              disabled={!dropId}
              onClick={async () => {
                const r = await admin<any>("/partners/probe", { method: "POST", body: JSON.stringify({ drop: dropId, account: probe.account }) }).catch((e) => ({ refused: true, code: e.message }));
                setProbe({ ...probe, result: r });
              }}
            >
              Send one seat
            </Btn>
            {probe.result && (
              <div className={`rounded-xl px-4 py-3 text-sm ${probe.result.refused ? "bg-success-100 text-success-700" : "bg-warning-100 text-warning-700"}`}>
                {probe.result.refused ? (
                  <>
                    <div className="font-semibold">Refused by Hedera</div>
                    <code className="font-mono text-xs">{probe.result.code}</code>
                  </>
                ) : (
                  <>Sent (that account is allowlisted)</>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
