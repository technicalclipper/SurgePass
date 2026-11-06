import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Every service reads the single .env at the repo root.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const envFile = resolve(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name} (see .env.example)`);
}

export function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number(v) : fallback;
}

/** True when a value is set and is not a placeholder from .env.example. */
export function isConfigured(...names: string[]): boolean {
  return names.every((n) => {
    const v = process.env[n];
    return !!v && v !== "0.0." && v !== "app_" && v !== "change-me";
  });
}
