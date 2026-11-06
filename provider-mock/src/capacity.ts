// A deliberately weak backend: a small worker pool, a short queue, and simulated DB time.
// Under a flood the queue overflows, latency climbs, and after sustained overload it "falls over"
// and returns 503 for a cool-down period, the way a real booking backend does.

export interface CapacityOptions {
  workers: number;
  queueLimit: number;
  dbMs: [number, number];
  crashAfterOverloadMs: number;
  crashCooldownMs: number;
}

interface Sample {
  at: number;
  ms: number;
  ok: boolean;
}

export class Capacity {
  private active = 0;
  private queue: (() => void)[] = [];
  private samples: Sample[] = [];
  private overloadedSince: number | null = null;
  private lastOverloadAt = 0;
  private crashedUntil = 0;
  private total = 0;

  constructor(private o: CapacityOptions) {}

  get crashed() {
    return Date.now() < this.crashedUntil;
  }

  /** Runs `work` inside the pool. Returns null when the backend rejects the request (503). */
  async run<T>(work: () => Promise<T> | T): Promise<T | null> {
    const start = Date.now();
    this.total++;
    if (this.crashed || (this.active >= this.o.workers && this.queue.length >= this.o.queueLimit)) {
      this.noteOverload(start);
      this.record(start, false);
      return null;
    }
    if (this.active >= this.o.workers) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      await sleep(rand(this.o.dbMs[0], this.o.dbMs[1]) * (1 + this.queue.length / this.o.workers));
      const out = await work();
      this.record(start, true);
      if (Date.now() - this.lastOverloadAt > 1000) this.overloadedSince = null;
      return out;
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private noteOverload(now: number) {
    this.lastOverloadAt = now;
    this.overloadedSince ??= now;
    if (!this.crashed && now - this.overloadedSince > this.o.crashAfterOverloadMs) {
      this.crashedUntil = now + this.o.crashCooldownMs;
      this.overloadedSince = null;
    }
  }

  private record(start: number, ok: boolean) {
    const now = Date.now();
    this.samples.push({ at: now, ms: now - start, ok });
    if (this.samples.length > 20_000) this.samples.splice(0, 10_000);
  }

  metrics() {
    const now = Date.now();
    const recent = this.samples.filter((s) => now - s.at < 5_000);
    const sorted = recent.map((s) => s.ms).sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
    const errors = recent.filter((s) => !s.ok).length;
    return {
      rps: Math.round(recent.length / 5),
      p95Ms: p95,
      errorRate: recent.length ? errors / recent.length : 0,
      inflight: this.active,
      queued: this.queue.length,
      crashed: this.crashed,
      load: Math.min(1, (this.active + this.queue.length) / (this.o.workers + this.o.queueLimit)),
      total: this.total,
    };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
