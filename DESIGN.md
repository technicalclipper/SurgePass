# SurgePass Design System

SurgePass looks and feels like **World App**: monochrome, calm, native-mobile, with colour used only to carry meaning. Every screen is built on World's own React UI kit so it matches exactly.

> **Principles:** one clear task per screen · the primary action is always visible · instant feedback on every tap · colour means something.

---

## 1. Foundation

### UI kit
```bash
npm install @worldcoin/mini-apps-ui-kit-react
```
```ts
// main.tsx / app/layout.tsx
import "@worldcoin/mini-apps-ui-kit-react/styles.css";
```
The stylesheet brings the font, the CSS variables and the kit components' styles. For our own Tailwind classes, define the same tokens (sections 2–4) in our Tailwind config, reading the kit's CSS variables:
```js
// tailwind.config.js (excerpt)
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    fontFamily: { sans: "var(--font-sans)" },
    extend: {
      colors: {
        gray: { 0: v("gray-0"), 50: v("gray-50"), 100: v("gray-100"), 200: v("gray-200"),
                300: v("gray-300"), 350: v("gray-350"), 400: v("gray-400"), 500: v("gray-500"),
                700: v("gray-700"), 900: v("gray-900") },
        success: { 100: v("success-100"), 600: v("success-600") },
        error:   { 100: v("error-100"),   600: v("error-600") },
        warning: { 100: v("warning-100"), 600: v("warning-600") },
        info:    { 100: v("info-100"),    600: v("info-600") },
      },
      boxShadow: { card: "0 0.625rem 1.875rem 0 #191C201A" },
    },
  },
};
```
> The kit's `@worldcoin/mini-apps-ui-kit-react/tailwind` export points to a file that isn't shipped in v1.6.0, so don't import it.

Use the kit's components first. Build custom components only where the kit has nothing, and build them from the tokens below.

### Font
- **TWK Lausanne** (loaded by the kit's stylesheet), weights 400 / 500 / 600.
- Fallback stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- Always `antialiased`.

---

## 2. Colour

Neutral greys do all the structural work. Semantic colours appear only when they mean something.

### Neutrals
| Token | Hex | Use |
|---|---|---|
| `gray-0` | `#FFFFFF` | Page background, sheets |
| `gray-50` | `#F9FAFB` | List rows, cards |
| `gray-100` | `#F3F4F5` | Tertiary buttons, pills, inputs |
| `gray-200` | `#EBECEF` | Borders, dividers |
| `gray-300` | `#D6D9DD` | Disabled text, input borders |
| `gray-350` | `#B1B8C2` | Placeholder text |
| `gray-400` | `#9BA3AE` | Icons, tertiary text |
| `gray-500` | `#717680` | Secondary text |
| `gray-700` | `#3C424B` | Strong secondary text |
| `gray-900` | `#181818` | Primary text, primary buttons, chart lines |

### Semantic
| Meaning | Token | Hex | Tint (background) |
|---|---|---|---|
| **Won · settled · flat backend · human** | `success-600` | `#00C230` | `success-100` `#E6F9EC` |
| **Rejected · crashed · bot** | `error-600` | `#F2280D` | `error-100` `#FEE9E7` |
| **Waitlist · surge rising · pending** | `warning-600` | `#FFAE00` | `warning-100` `#FFF6E6` |
| **Links · HashScan · HCS** | `info-600` | `#005CFF` | `info-100` `#E6F0FF` |
| **Agent** | `purple-primary` | `#8600FF` | `purple-secondary` `#F2E6FF` |
| Rare highlight | `world-blue-primary` | `#3FDBED` | `world-blue-secondary` `#ECFBFD` |

**Rules**
- Backgrounds stay `gray-0` on every screen.
- Never use a semantic colour for decoration.
- Coloured text sits on its own tint (e.g. `success-600` on `success-100`) or on white.
- All text meets WCAG AA contrast.

---

## 3. Typography

Use the kit's `<Typography variant level>`.

| Variant | Level | Size | Weight | Use |
|---|---|---|---|---|
| `display` | 1 | 56 px | 600, −2% | Hero moments ("You won") |
| `heading` | 1 / 2 / 3 / 4 | 34 / 30 / 26 / 22 px | 600, −1% | Screen titles |
| `subtitle` | 1 / 2 / 3 / 4 | 19 / 17 / 15 / 13 px | 500 | Section titles, row titles |
| `body` | 1 / 2 / 3 / 4 | 19 / 17 / 15 / 13 px | 400 | Copy (base = 17 px) |
| `label` | 1 / 2 | 17 / 15 px | 600 | Buttons, chips |
| `number` | 1 / 2 / 3 / 4 / 5 | 44 / 40 / 30 / 21 / 17 px | 600 | Countdown, seats, surge price, counters |

- Line heights: `narrow` 1.2 for headings and labels, `compact` 1.3 for body.
- **Numbers are the hero.** Countdown, seats left, entry count, surge price and req/s always use the `number` variant with tabular figures (`font-variant-numeric: tabular-nums`) so they don't jitter while updating.

---

## 4. Spacing, shape, elevation

### Spacing (World mini-app guidelines)
| Where | Value |
|---|---|
| Page padding | 24 px |
| Header → content | 16 px |
| Between items in a section | 16 px |
| Between sections | 32 px |
| Secondary page: header → content | 24 px |
| Secondary title → description | 12 px |
| Primary button → bottom safe area | 24 px |
| Button → open keyboard | 24 px |
| Tab bar / sheets above OS bottom bar | 12 px |
| Last scroll item above a bottom bar | 32 px |

### Radius
| Element | Radius |
|---|---|
| Buttons, pills, chips, avatars | full |
| List rows, cards | 16 px (`rounded-2xl`) |
| Bottom sheets | 28 px top corners |
| Inputs | 16 px |

### Elevation
- `shadow-card`: `0 10px 30px 0 #191C201A` (cards that float, e.g. the result card)
- `shadow-regular-large`: `0 16px 40px -8px #585C5F29` (sheets, popovers)
- Most surfaces are flat grey on white. Use shadow sparingly.

---

## 5. Components

| Need | Kit component | Notes |
|---|---|---|
| Primary action | `Button variant="primary" size="lg"` | Black pill, 56 px, full width at the bottom of mobile screens. Light haptic on tap. |
| Secondary action | `Button variant="secondary"` | Thin `gray-200` outline |
| Quiet action | `Button variant="tertiary"` | `gray-100` fill |
| Row of info / navigation | `ListItem` | 76 px, `gray-50`, 16 px radius |
| Actions and details | `Drawer` / `DrawerDialog` | Bottom sheet, 28 px top radius, 40% `gray-900` backdrop |
| Confirmations | `AlertDialog` | Only for irreversible actions |
| Seat count, filters, match/ignore | `Pill`, `Chip`, `ToggleGroup` | 36 px pills |
| Navigation | `Tabs` (bottom), `TopBar` | No sidebars, footers or hamburgers on mobile |
| Result states | `CircularState` | Success / error / warning / waiting circles |
| Live status | `LiveFeedback`, `Progress` | Inline progress on buttons |
| Notices | `Toast` | Centred under the header |
| Loading | `Skeleton` | Shimmer, never a spinner for content |
| Numeric input | `NumberPad`, `Input` | Max bid, seats |
| Human marker | `VerificationBadge` | Next to the anonymous handle, small and unobtrusive |
| Layout | `SafeAreaView`, `BottomBar` | Respect notches and home indicator |

Icons come from the kit (`outline`, `regular`, `solid` variants). Default to `regular`; use `solid` for selected states.

---

## 6. Motion and feedback

- **Every tap** gets a light haptic (built into kit buttons) and a visible state change within 100 ms.
- **Transitions:** 200 ms ease-out for colour and opacity; sheets slide up with a spring.
- **Numbers count up/down** smoothly instead of jumping (countdown, seats left, req/s, surge price).
- **Loading:** skeleton shimmer in place of content. Targets: first load ≤ 2–3 s, every later action < 1 s.
- **Success moments** (entered, won, paid) use `CircularState` success plus a soft scale-in (0.95 → 1).
- Respect `prefers-reduced-motion`: replace movement with fades.

---

## 7. Mobile web rules

```css
html, body { overscroll-behavior: none; background: #FFFFFF; }
.screen   { min-height: 100dvh; }
```
- Use `100dvh`, not `100vh`.
- No iOS scroll bounce; keep the primary button anchored.
- Center empty, loading and transient states.
- Show handles, never raw IDs or wallet addresses, in the UI. Hedera transaction IDs appear only behind a "View on HashScan" link.

---

## 8. World ID usage

- Use IDKit's own widget for verification. It keeps World ID's logo, copy, QR size (≥ 160 px) and states (waiting, success, cancelled, connection lost, error).
- Our button label: **"Verify with World ID"**.
- On a phone, verification opens World App directly. QR only on desktop.
- The human marker uses the kit's `VerificationBadge` with the word **"human"**, placed right next to the handle.
- SurgePass has its own name and mark. It never uses World's logo as its brand and never suggests World endorses it.

---

## 9. Copy voice

- Short, plain, friendly. Sentence case everywhere.
- Lead with the outcome: **"You're in."** · **"You won 3 of 4 seats."** · **"Waitlist #12."**
- Numbers over adjectives: "60 seats · 1,284 entered" rather than "high demand".
- Buttons are verbs: **Enter draw**, **Book now**, **Approve**, **Recompute**.

---

## 10. Screens

### 10.1 Waiting room (mobile first)

**Before verifying**
```
┌────────────────────────────┐
│ ‹                SurgePass  │  TopBar
│                            │
│ Train 12007 · CC            │  heading 2
│ 6 Nov · Mumbai → Delhi      │  body 2, gray-500
│                            │
│           04:12            │  number 1, counting down
│   60 seats · 1,284 entered  │  subtitle 3, gray-500
│                            │
│ Seats                       │  subtitle 3
│ ( 1 ) ( 2 ) (●3 ) ( 4 )     │  Pill group, max = provider's limit
│                            │
│ ┌────────────────────────┐ │
│ │ ◐  Fair draw            │ │  ListItem: how it works →
│ │    Equal odds, on Hedera│ │
│ └────────────────────────┘ │
│                            │
│ ╭────────────────────────╮ │
│ │   Verify with World ID  │ │  primary, fixed at bottom
│ ╰────────────────────────╯ │
└────────────────────────────┘
```

**Verify flow:** tap → IDKit sheet → World App → back → `CircularState` success → **"You're in."** with the HCS entry as a quiet row ("Entry #42 · View on HashScan").

**Waiting:** the countdown stays the hero; below it a live count of entries and a quiet "Your entry is recorded" row. If premium is a separate drop for the same item, it appears as its own row ("Premium · from ₹1,000 · up to ₹2,000").

**The draw (window closes)**
1. Countdown reaches 00:00 → "Drawing…" with a skeleton list.
2. Seed arrives → a short shuffle animation: entry rows slide into their new order.
3. Result card (`shadow-card`) scales in:
   - **Won:** `CircularState` success · display text **"You won"** · "3 of 4 seats" · **Book now** (primary) · pass timer "Valid for 9:48".
   - **Partial:** same, with "3 of 4 seats" and a one-line note "Only 3 seats were left in your turn."
   - **Waitlist:** `CircularState` warning · **"Waitlist #12"** · "We'll notify you if seats free up." · live position updates.
4. **Verify this draw** row → sheet with seed, entry count, method (Fisher–Yates), HCS links and **Recompute**.

**Book now** → the provider's normal booking page.

### 10.2 Agent approval
```
┌────────────────────────────┐
│                            │
│        ( agent icon )       │  CircularIcon, purple tint
│                            │
│  Your agent wants to enter  │  heading 3
│                            │
│ ┌────────────────────────┐ │
│ │ Train 12007 · 6 Nov · CC│ │  ListItem
│ │ 2 seats · Normal draw   │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ Budget  ₹49.90 left     │ │  ListItem
│ └────────────────────────┘ │
│ Code  K7XP-29QD             │  body 3, gray-500
│                            │
│ ╭────────────────────────╮ │
│ │  Approve with World ID  │ │  primary
│ ╰────────────────────────╯ │
│        Decline              │  tertiary text button
└────────────────────────────┘
```
Approved → `CircularState` success "Approved. Your agent will handle the rest." Declined or expired → `CircularState` error with a plain reason.

### 10.3 Provider dashboard (desktop, same tokens)

- White canvas, 24–32 px gutters, max content width ~1200 px.
- Top tabs: **Drops · Normal · Premium · Analytics · Settings**.
- Cards are `gray-50`, 16 px radius, no borders.

**URL gating (Normal and Premium are separate tabs with the same builder)**
```
Paste a URL
┌──────────────────────────────────────────────────────────────┐
│ https://booking.example.com/tatkal/book/12007/2026-11-06/CC?quota=TQ&lang=en │
└──────────────────────────────────────────────────────────────┘

Path     (tatkal) (book) (●12007 → trainNo) (●2026-11-06 → date) (●CC → class)
Query    (●quota = TQ  match) (lang  ignore)
Pattern  /tatkal/book/:trainNo/:date/:class ?quota=TQ

Test a URL  ┌──────────────────────────────┐  ● Matches "Train 12007 · CC"
            └──────────────────────────────┘
```
- Selected segments are black pills (`gray-900` / white text); unselected are `gray-100`.
- Query params toggle between **match** and **ignore** chips.
- "Test a URL" shows a green row for a match, a grey row for "passes through".

**Drop settings card:** Seats (N) · Max seats per entry · Window · Peak schedule / load trigger · Confirmed-seats field · (Premium: floor, ceiling, deposit).

**Analytics:** big `number` tiles (entries, bots blocked, paid reads, surge revenue, seats released) above thin `gray-900` line charts. Green/red/amber only where they mean something. Every drop has **View on HashScan** links.

### 10.4 Demo screen (projector)

Light and calm: the contrast between the two sides tells the story.

```
┌───────────────────────────────┬───────────────────────────────┐
│ Without SurgePass              │ With SurgePass                 │
│ ● Crashed   (error-600 pill)   │ ● Healthy   (success-600 pill) │
│ p95  4,812 ms   errors 63%     │ p95  41 ms   errors 0%         │  number 3
│ ╱╲╱╲╱‾‾╲  red line             │ ───────────  black flat line   │
├───────────────────────────────┴───────────────────────────────┤
│ Gateway   33,104 req/s · CPU 18% · blocked 98.7% · 402s 12,331 │  number 4 tiles
│ Surge ₹0.50 → ₹1.20 (warning)    Countdown 00:42               │
│ 👤 412 humans   🤖 38 agents   🚫 9,550 bots                     │
├───────────────────────────────┬───────────────────────────────┤
│ Live log                       │ HCS feed                       │
│ ● BOT  POST /book/a  302       │ #41 entry      View ↗          │
│ ● AGENT paid ₹0.10   200  ↗    │ #42 entry      View ↗          │
│ ● HUMAN entered  #42  ↗        │ #43 window_closed  View ↗      │
└───────────────────────────────┴───────────────────────────────┘
```
- Log rows: small coloured dot (red bot, purple agent, green human, amber surge) + monospace path + status; links in `info-600`.
- Counters animate smoothly; nothing flashes.
- The draw takes over the full screen at 00:00: the shuffle animation, winners lighting up in green, partial seats shown as "3 / 4", then **Recompute** confirming a match.

---

## 11. Checklist

- [ ] Built on `@worldcoin/mini-apps-ui-kit-react` components and Tailwind preset
- [ ] White background on every screen; greys for structure, colour only for meaning
- [ ] One clear task per screen; primary black pill always visible
- [ ] 24 / 16 / 32 px spacing rhythm
- [ ] Numbers use the `number` variant with tabular figures and animate smoothly
- [ ] Skeletons for loading; first load ≤ 3 s, actions < 1 s
- [ ] `100dvh`, no scroll bounce, safe areas respected
- [ ] IDKit widget used as-is for World ID; "human" badge used correctly
- [ ] No raw IDs or addresses on screen; HashScan behind links
- [ ] WCAG AA contrast; keyboard and screen-reader friendly; reduced motion respected
