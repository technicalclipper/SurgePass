import { config } from "./config.ts";
import { enqueue } from "./hcsqueue.ts";
import { redis } from "./redis.ts";
import { broadcast } from "./live.ts";

// Spending audit for human-backed agents: every settled payment from a linked agent account is
// added to its running total and written to the SurgePass audit topic on HCS.

export async function onAgentSpend(account: string, amountInr: number, txId: string) {
  if (!account || !(await redis.exists(`agentlink:${account}`))) return;
  const total = await redis.incrbyfloat(`agentspend:${account}`, amountInr);
  broadcast({ type: "agent_spend", account, amountInr, totalInr: Number(total), txId });
  if (config.hedera.auditTopicId) {
    void enqueue(config.hedera.auditTopicId, { t: "agent_spend", agent_account: account, amount_inr: amountInr, tx_id: txId }).catch(() => {});
  }
}

export async function agentSpent(account: string): Promise<number> {
  return Number((await redis.get(`agentspend:${account}`)) ?? 0);
}
