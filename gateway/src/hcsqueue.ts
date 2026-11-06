import type { HcsMessage } from "@surgepass/shared";
import { submit, type Submitted } from "./hedera.ts";

// HCS writes are off the request path: callers get a promise, the queue submits with bounded
// concurrency per topic, and the draw waits for a topic to drain before closing the window.

const CONCURRENCY = 6;

interface Job {
  msg: HcsMessage;
  withTimestamp: boolean;
  resolve: (s: Submitted) => void;
  reject: (e: unknown) => void;
}

const queues = new Map<string, { jobs: Job[]; running: number; idle: (() => void)[] }>();

function q(topic: string) {
  let x = queues.get(topic);
  if (!x) queues.set(topic, (x = { jobs: [], running: 0, idle: [] }));
  return x;
}

function pump(topic: string) {
  const x = q(topic);
  while (x.running < CONCURRENCY && x.jobs.length) {
    const job = x.jobs.shift()!;
    x.running++;
    submitWithRetry(topic, job.msg, job.withTimestamp)
      .then(job.resolve, job.reject)
      .finally(() => {
        x.running--;
        if (!x.running && !x.jobs.length) for (const fn of x.idle.splice(0)) fn();
        pump(topic);
      });
  }
}

async function submitWithRetry(topic: string, msg: HcsMessage, withTimestamp: boolean): Promise<Submitted> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await submit(topic, msg, withTimestamp);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw last;
}

export function enqueue(topic: string, msg: HcsMessage, withTimestamp = false): Promise<Submitted> {
  return new Promise((resolve, reject) => {
    q(topic).jobs.push({ msg, withTimestamp, resolve, reject });
    pump(topic);
  });
}

/** Resolves once every queued message for the topic has been submitted. */
export function drain(topic: string): Promise<void> {
  const x = q(topic);
  if (!x.running && !x.jobs.length) return Promise.resolve();
  return new Promise((r) => x.idle.push(r));
}

export const pendingCount = (topic: string) => {
  const x = queues.get(topic);
  return x ? x.running + x.jobs.length : 0;
};
