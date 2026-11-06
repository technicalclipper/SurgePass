import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "@surgepass/shared/env";

const ENV = resolve(REPO_ROOT, ".env");

/** Sets keys in the root .env (creating it from .env.example), keeping every other line as-is. */
export function setEnv(values: Record<string, string>) {
  if (!existsSync(ENV)) copyFileSync(resolve(REPO_ROOT, ".env.example"), ENV);
  let text = readFileSync(ENV, "utf8");
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    process.env[k] = v;
  }
  writeFileSync(ENV, text);
}
