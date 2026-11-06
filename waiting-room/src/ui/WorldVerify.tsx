import { IDKitRequestWidget, proofOfHuman } from "@worldcoin/idkit";
import { CircularState } from "@worldcoin/mini-apps-ui-kit-react";
import { useEffect, useState } from "react";
import type { WorldContext } from "../lib/api";
import { PrimaryButton, Sheet } from "./kit";

// One-tap World ID. Uses IDKit's own widget (World ID logo, copy and QR untouched).
// When the gateway has no World app configured (local development) it shows a simulator sheet
// that is clearly labelled as such.

export function WorldVerify({
  open,
  onOpenChange,
  getContext,
  verify,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  getContext: () => Promise<WorldContext>;
  verify: (result: unknown) => Promise<void>;
  onDone: () => void;
}) {
  const [ctx, setCtx] = useState<WorldContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCtx(null);
      setError(null);
      return;
    }
    getContext().then(setCtx, (e) => setError(e.message));
  }, [open]);

  if (!open) return null;
  if (error)
    return (
      <Sheet open onClose={() => onOpenChange(false)}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CircularState value="error" size="lg" />
          <div className="text-lg font-semibold">Couldn't start verification</div>
          <div className="text-sm text-gray-500">{error}</div>
          <PrimaryButton onClick={() => onOpenChange(false)}>Close</PrimaryButton>
        </div>
      </Sheet>
    );
  if (!ctx) return null;
  if (ctx.dev) return <DevSimulator ctx={ctx} verify={verify} onDone={onDone} onClose={() => onOpenChange(false)} />;

  return (
    <IDKitRequestWidget
      open={open}
      onOpenChange={onOpenChange}
      app_id={ctx.app_id as `app_${string}`}
      action={ctx.action}
      rp_context={ctx.rp_context}
      allow_legacy_proofs={ctx.allow_legacy_proofs}
      preset={proofOfHuman({ signal: ctx.signal })}
      environment={ctx.environment as "production" | "staging"}
      handleVerify={async (result) => {
        await verify(result);
      }}
      onSuccess={() => onDone()}
    />
  );
}

function DevSimulator({ ctx, verify, onDone, onClose }: { ctx: WorldContext; verify: (r: unknown) => Promise<void>; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("sp_dev_human") ?? `human-${Math.random().toString(36).slice(2, 6)}`;
    } catch {
      return "human-1";
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-warning-700">Local development</div>
          <div className="mt-1 text-xl font-semibold">World ID simulator</div>
          <div className="mt-1 text-sm text-gray-500">No World app is configured on this gateway, so a stand-in identity is used. Each name is one simulated human.</div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-14 rounded-2xl border border-gray-200 bg-gray-0 px-4 text-base outline-none focus:border-gray-300"
        />
        {err && <div className="text-sm text-error-600">{err}</div>}
        <PrimaryButton
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              localStorage.setItem("sp_dev_human", name);
              await verify({ nonce: ctx.rp_context.nonce, action: ctx.action, environment: "dev", protocol_version: "4.0", responses: [{ identifier: "proof_of_human", nullifier: name }] });
              onDone();
            } catch (e: any) {
              setErr(e.body?.reason ?? e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Verify as {name}
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
