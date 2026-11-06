import { useState, type ReactNode } from "react";

// A dark terminal-style code window: title bar, optional tabs, copy button, light syntax colouring.

export type Lang = "js" | "py" | "java" | "go" | "sh" | "json" | "http";

const KEYWORDS: Record<Lang, string[]> = {
  js: ["import", "from", "export", "const", "let", "async", "await", "function", "return", "if", "throw", "new", "try", "catch", "null", "true", "false"],
  py: ["import", "from", "def", "return", "if", "not", "raise", "try", "except", "None", "True", "False", "else", "and", "or"],
  java: ["import", "public", "private", "static", "final", "class", "return", "if", "throw", "new", "try", "catch", "null", "var", "throws", "int"],
  go: ["package", "import", "func", "return", "if", "var", "const", "nil", "err", "struct", "range", "for"],
  sh: ["curl", "npm", "pip", "go", "export"],
  json: ["true", "false", "null"],
  http: [],
};

/** Tiny highlighter: comments, strings, keywords, numbers. Enough for short snippets. */
function colour(code: string, lang: Lang): ReactNode[] {
  const comment = lang === "py" || lang === "sh" ? "#[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const docstring = lang === "py" ? '"""[\\s\\S]*?"""|' : "";
  const kw = KEYWORDS[lang].length ? `\\b(?:${KEYWORDS[lang].join("|")})\\b` : "(?!)";
  const re = new RegExp(`(${comment})|(${docstring}"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(${kw})|(\\b\\d[\\d_.]*\\b)|(@\\w+)`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(re)) {
    if (m.index! > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? "text-[#7d8590] italic" : m[2] ? "text-[#a5d6ff]" : m[3] ? "text-[#ff7b72]" : m[4] ? "text-[#79c0ff]" : "text-[#d2a8ff]";
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-gray-0/10 px-2.5 text-xs font-semibold text-gray-0/80 transition hover:bg-gray-0/20 hover:text-gray-0"
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}

export function CodeWindow({
  title,
  tabs,
  active,
  onTab,
  code,
  lang,
  badge,
  maxHeight = 520,
}: {
  title: string;
  tabs?: { id: string; label: string }[];
  active?: string;
  onTab?: (id: string) => void;
  code: string;
  lang: Lang;
  badge?: ReactNode;
  maxHeight?: number;
}) {
  const lines = code.replace(/\n$/, "").split("\n");
  const coloured = colour(code.replace(/\n$/, ""), lang);
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0d1117] shadow-lifted ring-1 ring-gray-900/10">
      <div className="flex items-center gap-3 border-b border-gray-0/10 bg-[#161b22] px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate font-mono text-xs text-gray-0/60">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          {badge}
          <CopyButton text={code} />
        </span>
      </div>
      {tabs && (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-0/10 bg-[#161b22] px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab?.(t.id)}
              className={`relative shrink-0 px-3.5 py-2.5 text-xs font-semibold transition ${active === t.id ? "text-gray-0" : "text-gray-0/45 hover:text-gray-0/80"}`}
            >
              {t.label}
              {active === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#2f81f7]" />}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <pre className="flex min-w-max py-4 font-mono text-[12.5px] leading-[1.7]">
          <code aria-hidden className="select-none border-r border-gray-0/5 pl-4 pr-3 text-right text-gray-0/25">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </code>
          <code className="whitespace-pre pl-4 pr-6 text-[#e6edf3]">{coloured}</code>
        </pre>
      </div>
    </div>
  );
}
