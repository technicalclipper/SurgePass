// World App tokens (see DESIGN.md), read from the UI kit's CSS variables.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name, steps) => Object.fromEntries(steps.map((s) => [s, v(`${name}-${s}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../node_modules/@worldcoin/mini-apps-ui-kit-react/dist/**/*.js"],
  theme: {
    fontFamily: { sans: "var(--font-sans)", mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      gray: scale("gray", [0, 50, 100, 200, 300, 350, 400, 500, 700, 900]),
      success: scale("success", [100, 200, 300, 400, 500, 600, 700]),
      error: scale("error", [100, 200, 300, 400, 500, 600, 700]),
      warning: scale("warning", [100, 200, 300, 400, 500, 600, 700]),
      info: scale("info", [100, 200, 300, 400, 500, 600, 700]),
      purple: { DEFAULT: v("purple-primary"), soft: v("purple-secondary") },
      worldblue: { DEFAULT: v("world-blue-primary"), soft: v("world-blue-secondary") },
    },
    fontSize: {
      "2xs": "0.6875rem",
      xs: "0.8125rem",
      sm: "0.9375rem",
      base: "1.0625rem",
      lg: "1.1875rem",
      xl: "1.3125rem",
      "2xl": "1.625rem",
      "3xl": "1.875rem",
      "4xl": "2.125rem",
      "5xl": "2.5rem",
      "6xl": "2.75rem",
      "7xl": "3.5rem",
    },
    extend: {
      lineHeight: { narrow: "1.2", compact: "1.3" },
      boxShadow: { card: "0 0.625rem 1.875rem 0 #191C201A", lifted: "0 1rem 2.5rem -0.5rem #585C5F29" },
      borderRadius: { sheet: "1.75rem" },
    },
  },
  plugins: [],
};
