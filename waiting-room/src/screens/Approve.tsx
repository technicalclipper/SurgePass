import { CircularIcon, CircularState } from "@worldcoin/mini-apps-ui-kit-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { api, type Approval } from "../lib/api";
import { clock, inr, useNow } from "../lib/format";
import { Card, GhostButton, Header, Mark, PrimaryButton, Screen, Spinner } from "../ui/kit";
import { WorldVerify } from "../ui/WorldVerify";

// Approval page an agent sends its human to: "Your agent wants to enter …" → one World ID tap.
// Feels like a UPI collect request.

export function Approve({ code }: { code: string }) {
  const [a, setA] = useState<Approval | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const now = useNow(1000);

  const load = () => api.approval(code).then(setA, (e) => setErr(e.status === 404 ? "This approval link isn't valid." : e.message));
  useEffect(() => {
    void load();
  }, [code]);

  if (err)
    return (
      <Screen>
        <Header right={<Mark />} />
        <Done state="error" title="Link not found" sub={err} />
      </Screen>
    );
  if (!a)
    return (
      <Screen>
        <div className="grid h-[80dvh] place-items-center">
          <Spinner />
        </div>
      </Screen>
    );

  const expired = a.status === "expired" || (a.status === "pending" && now > a.expiresAt);
  if (a.status === "approved")
    return (
      <Screen>
        <Header right={<Mark />} />
        <Done state="success" title="Approved" sub={a.kind === "link" ? `Your agent is connected for 30 days with a ${inr(a.budgetInr ?? 0)} budget.` : "Your agent will handle the rest. You'll be notified of the result."} />
      </Screen>
    );
  if (a.status === "declined")
    return (
      <Screen>
        <Header right={<Mark />} />
        <Done state="error" title="Declined" sub="Your agent can't enter on your behalf." />
      </Screen>
    );
  if (expired)
    return (
      <Screen>
        <Header right={<Mark />} />
        <Done state="error" title="Request expired" sub="Ask your agent to send a new request." />
      </Screen>
    );

  const next = a.items.find((i) => !i.approved);
  const isLink = a.kind === "link";

  return (
    <Screen
      bottom={
        <div className="flex flex-col gap-1">
          <PrimaryButton onClick={() => setCurrent(isLink ? null : next?.drop)}>Approve with World ID</PrimaryButton>
          <GhostButton
            onClick={async () => {
              await api.approvalDecline(code);
              await load();
            }}
          >
            Decline
          </GhostButton>
        </div>
      }
    >
      <Header right={<Mark />} />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center pt-6 text-center">
        <CircularIcon size="xl" className="bg-purple-soft text-purple">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="5" y="8" width="14" height="11" rx="3" />
            <path d="M12 4v4M9 13h.01M15 13h.01M10 16h4" />
          </svg>
        </CircularIcon>
        <h1 className="mt-6 text-3xl font-semibold leading-narrow tracking-[-0.01em]">{isLink ? "Connect your agent" : "Your agent wants to enter"}</h1>
        <div className="mt-2 font-mono text-xs text-gray-500">{a.agent}</div>
      </motion.div>

      <div className="mt-8 flex flex-col gap-3">
        {isLink ? (
          <>
            <Card>
              <div className="text-base font-semibold">Spending budget</div>
              <div className="mt-1 text-4xl font-semibold tabular">{inr(a.budgetInr ?? 0)}</div>
              <div className="mt-1 text-sm text-gray-500">For availability checks during busy periods, paid on Hedera. Valid for 30 days.</div>
            </Card>
            <Card>
              <div className="text-sm text-gray-500">Your agent will still ask you once for each drop.</div>
            </Card>
          </>
        ) : (
          a.items.map((it) => (
            <Card key={it.drop} className={it.approved ? "bg-success-100" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{it.label}</div>
                  {it.subtitle && <div className="text-sm text-gray-500">{it.subtitle}</div>}
                  <div className="mt-2 text-sm text-gray-700">
                    {it.seats} seat{it.seats > 1 ? "s" : ""} · {it.pool === "premium" ? `premium, up to ${inr(it.maxBid ?? 0)} per seat` : "fair draw"}
                  </div>
                </div>
                {it.approved && <CircularState value="success" size="sm" />}
              </div>
            </Card>
          ))
        )}
        {!isLink && a.linked && (
          <Card>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Budget left</span>
              <span className="font-semibold tabular">{inr(Math.max(0, (a.budgetInr ?? 0) - a.spentInr), 2)}</span>
            </div>
          </Card>
        )}
        <div className="mt-2 text-center text-xs text-gray-400">
          Code {a.code} · {a.expiresAt - now > 3_600_000 ? `open until ${new Date(a.expiresAt).toLocaleString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST` : `expires in ${clock(a.expiresAt - now)}`}
        </div>
      </div>

      <WorldVerify
        open={current !== undefined}
        onOpenChange={(o) => !o && setCurrent(undefined)}
        getContext={() => api.approvalContext(code, current ?? undefined)}
        verify={async (result) => {
          await api.approvalVerify(code, current ?? undefined, result);
        }}
        onDone={async () => {
          setCurrent(undefined);
          await load();
        }}
      />
    </Screen>
  );
}

function Done({ state, title, sub }: { state: "success" | "error"; title: string; sub: string }) {
  return (
    <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center pt-24 text-center">
      <CircularState value={state} size="xl" />
      <div className="mt-6 text-4xl font-semibold tracking-[-0.01em]">{title}</div>
      <div className="mt-2 max-w-xs text-base text-gray-500">{sub}</div>
    </motion.div>
  );
}
