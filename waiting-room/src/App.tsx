import { useEffect, useState } from "react";
import { api, type PublicDrop } from "./lib/api";
import { clock, useNow } from "./lib/format";
import { Approve } from "./screens/Approve";
import { DropPage } from "./screens/DropPage";
import { PremiumPage } from "./screens/PremiumPage";
import { Verify } from "./screens/Verify";
import { Chip, Header, Mark, Row, Screen, Spinner } from "./ui/kit";

// Tiny router over /_sp/room/*.

export function navigate(path: string) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function App() {
  const path = usePath().replace(/^\/_sp\/room\/?/, "");
  const [a, b] = path.split("/").filter(Boolean);
  if (a === "approve" && b) return <Approve code={b} />;
  if (a === "verify" && b) return <Verify dropId={b} />;
  if (a) return <DropRoute id={a} />;
  return <DropList />;
}

function DropRoute({ id }: { id: string }) {
  const [drop, setDrop] = useState<PublicDrop | null | undefined>(undefined);
  useEffect(() => {
    api.drop(id).then(setDrop, () => setDrop(null));
  }, [id]);
  if (drop === undefined)
    return (
      <Screen>
        <div className="grid h-[80dvh] place-items-center">
          <Spinner />
        </div>
      </Screen>
    );
  if (drop === null)
    return (
      <Screen>
        <Header onBack={() => navigate("/_sp/room/")} right={<Mark />} />
        <div className="pt-24 text-center text-lg font-semibold">Drop not found</div>
      </Screen>
    );
  if (drop.pool === "partner") return <PartnerOnly drop={drop} />;
  return drop.pool === "premium" ? <PremiumPage key={drop.id} drop={drop} /> : <DropPage key={drop.id} drop={drop} />;
}

function DropList() {
  const [drops, setDrops] = useState<PublicDrop[] | null>(null);
  const now = useNow(1000);
  useEffect(() => {
    void api.drops().then(setDrops);
  }, []);
  return (
    <Screen>
      <Header right={<Mark />} />
      <h1 className="pt-2 text-4xl font-semibold leading-narrow tracking-[-0.01em]">High-demand drops</h1>
      <div className="mt-2 text-base text-gray-500">One verified person, one entry. Fair draws, checked on Hedera.</div>
      <div className="mt-8 flex flex-col gap-3">
        {!drops && <div className="h-[4.75rem] animate-pulse rounded-2xl bg-gray-50" />}
        {drops?.length === 0 && <div className="pt-12 text-center text-gray-500">No drops right now</div>}
        {drops?.map((d) => (
          <Row
            key={d.id}
            label={
              <span className="flex items-center gap-2">
                {d.label} {d.pool === "premium" && <Chip tone="dark">Premium</Chip>}
              </span>
            }
            sub={`${d.seats} seats · ${d.status === "open" ? `closes in ${clock(d.closesAt - now)}` : d.status === "scheduled" ? `opens in ${clock(d.opensAt - now)}` : d.status}`}
            value="→"
            onClick={() => navigate(`/_sp/room/${d.id}`)}
          />
        ))}
      </div>
    </Screen>
  );
}

function PartnerOnly({ drop }: { drop: PublicDrop }) {
  const [publicDrops, setPublicDrops] = useState<PublicDrop[]>([]);
  useEffect(() => {
    void api.drops().then(setPublicDrops);
  }, []);
  return (
    <Screen>
      <Header onBack={() => navigate("/_sp/room/")} right={<Mark />} />
      <div className="pt-6">
        <Chip tone="purple">Authorised partners</Chip>
        <h1 className="mt-4 text-3xl font-semibold leading-narrow tracking-[-0.01em]">{drop.label}</h1>
        <div className="mt-2 text-base text-gray-500">
          This quota is booked through authorised travel partners. Any seats they don't use go back to the public draw.
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-3">
        {publicDrops.map((d) => (
          <Row key={d.id} label={d.label} sub="Open to everyone · fair draw" value="Enter →" onClick={() => navigate(`/_sp/room/${d.id}`)} />
        ))}
      </div>
    </Screen>
  );
}
