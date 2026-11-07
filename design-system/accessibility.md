# Accessibility

> Non-negotiable rules. Every spec includes an "accessibility" section, but this page is the central reference and audit checklist.

---

## 1. WCAG targets

The system targets **WCAG 2.2 AA** as a hard minimum, **AAA** wherever it costs nothing.

| Criterion                         | Target                                       | Measured                   |
| --------------------------------- | -------------------------------------------- | -------------------------- |
| 1.4.3 Contrast (Minimum)          | AA (4.5:1 for normal text, 3:1 for large/UI) | See § 3                    |
| 1.4.11 Non-text Contrast          | AA (3:1 for icons, borders)                  | See § 3                    |
| 2.1.1 Keyboard                    | All interactive must be reachable            | See § 5                    |
| 2.4.7 Focus Visible               | Visible at all times when tabbing            | See § 4                    |
| 2.5.5 Target Size                 | AA Enhanced: 44 × 44 CSS px minimum          | See § 6                    |
| 2.3.3 Animation from Interactions | `prefers-reduced-motion` honored             | See [motion.md](motion.md) |

---

## 2. Touch targets

| Component                                     | Size          | WCAG AA Enhanced (44×44) | Verdict                                           |
| --------------------------------------------- | ------------- | ------------------------ | ------------------------------------------------- |
| `.power-btn` (desktop)                        | 32 × 26       | ❌                       | Pad surrounding cell to 44×44 hit area            |
| `.mob__power` (mobile)                        | 32 × 32       | ❌                       | Same as above; padding-based expand               |
| `.shutter-btn` (desktop, in group)            | 30 × 30       | ❌                       | Tolerated in dense group context                  |
| `.mob__shutter-grp button` (mobile)           | 30 × 32       | ❌                       | Same as above                                     |
| `.recipe__action` (logs/dup/del)              | 22 × 20       | ❌                       | **Acceptable in dense list**; hidden on mobile    |
| `.cat-head__add` (+ button on Recettes/Modes) | 22 × 22       | ❌                       | Pad surrounding hit area                          |
| `.actions__seg button` (zone commands)        | min-height 36 | ❌                       | Bump to 44 in production OR use larger hit area   |
| `.mode-row__apply`                            | ~28 high      | ❌                       | Pad row hit area                                  |
| `.modal__close`                               | 32 × 32       | ❌                       | Acceptable in modal head; the X is in a calm zone |
| `.topbar__chip`                               | 32 high       | ❌                       | Borderline; production may keep at 32             |
| `.mob__tab`                                   | 56 × ~76      | ✅                       | Mobile tab bar items pass 44×44                   |
| `.sb__item`                                   | ~30 high      | ❌                       | **Desktop only, mouse-driven**: OK                |
| `.mob__action-seg button`                     | min-height 44 | ✅                       | Already meets target                              |

**Rule of thumb**: visible buttons under 44 × 44 must extend their **invisible click area** to 44 × 44 via padding or `::before` pseudo-element. The visual size stays small, the touchable area gets bigger.

```css
.power-btn {
  position: relative;
  /* visible 32×26 stays */
}
.power-btn::before {
  content: "";
  position: absolute;
  inset: -9px -6px; /* extends hit area to ~44×44 */
}
```

---

## 3. Color contrast measurements

Computed (WCAG 2.x relative luminance, sRGB), not read off a checker. Translucent backgrounds such as `bg-success/10` are composed on the surface first. The colour-role pairs are not listed by hand any more: `ui/src/lib/color-roles.test.ts` computes them from `tokens.css` in both themes and fails under 4.5:1 for text and 3:1 for graphics. The role table, with its key ratios, is in [tokens.md §1.2](tokens.md#12-colour-roles).

### Text colors (Hybrid)

| Text on background                                    | Ratio   | WCAG                                  |
| ----------------------------------------------------- | ------- | ------------------------------------- |
| `--n-700` (`#27272A`) on `--n-0` (`#FFFFFF`)          | 14.89:1 | AAA                                   |
| `--n-700` on `--n-25` (`#FAFAFA`)                     | 14.27:1 | AAA                                   |
| `--n-700` on `--n-50` (`#F4F4F5`)                     | 13.55:1 | AAA                                   |
| `--n-600` (`#3F3F46`) on `--n-0`                      | 10.44:1 | AAA                                   |
| `--n-500` (`#52525B`) on `--n-0`                      | 7.73:1  | AAA                                   |
| `--n-400` (`#71717A`) on `--n-0`                      | 4.83:1  | AA                                    |
| `--n-400` on `--n-25`                                 | 4.63:1  | AA                                    |
| `--n-400` on `--n-50` (page background)               | 4.40:1  | ❌ **fail** — neutrals work, spec 196 |
| `--p-500` (`#1A4F6E`) on `--n-0`                      | 8.80:1  | AAA                                   |
| `--p-500` on `--p-50` (`#EEF5F8`)                     | 7.98:1  | AAA                                   |
| `--green-700` (`#0E6B3F`) on `--green-50` (`#E6F7EE`) | 5.92:1  | AA                                    |
| `active-ink` (`#8A6100`) on `--n-0`                   | 5.54:1  | AA                                    |
| `warning-ink` (`#A85500`) on `--n-0`                  | 5.30:1  | AA                                    |
| `success` (`#13794A`) on `--n-0`                      | 5.44:1  | AA                                    |
| `error` (`#B42318`) on `--n-0`                        | 6.57:1  | AA                                    |
| `error` on `--red-50` (`#FBE9E1`)                     | 5.59:1  | AA                                    |

### 3.1 Amber is never text, and never under white

`--a-500` (`#F2C035`) is 1.70:1 on white, and white on it is 1.70:1 too; `--a-600` (`#D4A41C`) is 2.30:1. Neither carries a word. The amber of something on is drawn as a fill, a glow or an icon in its tile; its word or value takes `active-ink` (`#8A6100`, 5.54:1), and content placed on an amber fill takes `on-active` (`#1C1A14`, 10.24:1). Before spec 196 this section measured these pairs at 2.4:1 and 8.4:1 and shipped them anyway; the real values were 2.30:1 and 1.70:1.

The values before spec 196, for the record: `--red-500` `#C7522E` was 4.49:1 on white (it was listed as 4.9, AA: it failed), `--green-500` `#1FA260` 3.28:1, amber as text 1.61–1.70:1.

### Non-text contrast

| Element                                         | Foreground | Background | Ratio  | Verdict                                              |
| ----------------------------------------------- | ---------- | ---------- | ------ | ---------------------------------------------------- |
| Icon strokes `--n-500` on `--n-0`               | `#52525B`  | `#FFFFFF`  | 7.73:1 | AAA                                                  |
| Border `--line` (rgba(24,24,27,.08)) on `--n-0` | computed   | `#FFFFFF`  | ~1.2:1 | ❌ — but borders are decorative, not required for AA |
| Border `--line-2` on `--n-0`                    | computed   | `#FFFFFF`  | ~1.4:1 | ❌ — same caveat                                     |
| Slider track `--n-100` on `--n-0`               | `#E9E9EB`  | `#FFFFFF`  | 1.21:1 | acceptable (decorative)                              |
| `warning` dot or icon on `--n-0`                | `#E8730C`  | `#FFFFFF`  | 3.05:1 | AA (graphic)                                         |
| Switch off: outline `--n-400` on `--n-0`        | `#71717A`  | `#FFFFFF`  | 4.83:1 | AA (graphic)                                         |
| Switch off: thumb `--n-400` on track `--n-100`  | `#71717A`  | `#E9E9EB`  | 3.99:1 | AA (graphic); dark 3.78:1                            |

WCAG 1.4.11 applies to **meaningful** non-text elements. Decorative borders are exempt. If a border carries meaning (e.g. the green `.mode-row--active` left border), it meets 3:1 minimum.

| Meaningful border                                        | Ratio  | Verdict |
| -------------------------------------------------------- | ------ | ------- |
| `.mode-row--active` left border `--green-500` on `--n-0` | 5.44:1 | AA      |

---

## 4. Focus indicators

Every interactive element must have a visible focus state. The system uses:

```css
.recipe__open:focus-visible {
  outline: 2px solid var(--p-500);
  outline-offset: 2px;
  border-radius: 2px;
}
```

Browsers' default focus rings are kept on form inputs (text, number, time) — they pass WCAG out of the box.

Custom-styled buttons (`.power-btn`, `.recipe__action`, `.sb__item`) must override or remove the default outline only if a **replacement focus indicator is wired**. Currently:

- `.sb__item` relies on browser default (production needs to verify).
- `.power-btn`, `.shutter-btn`, `.recipe__action`: same.

**Production action item**: add a global focus-visible rule for all interactive elements:

```css
button:focus-visible,
[role="button"]:focus-visible,
[role="switch"]:focus-visible {
  outline: 2px solid var(--p-500);
  outline-offset: 2px;
}
```

---

## 5. Keyboard reachability

| Component         | Tab target                     | Activate                            |
| ----------------- | ------------------------------ | ----------------------------------- |
| `.sb__item`       | yes (Link or button)           | Enter                               |
| `.eq__icon`       | no (decorative)                | —                                   |
| `.power-btn`      | yes                            | Enter / Space                       |
| `.recipe__open`   | yes (button)                   | Enter / Space                       |
| `.recipe__toggle` | yes (role=switch + tabindex=0) | **Space** (production must wire)    |
| `.recipe__action` | yes (each button)              | Enter / Space                       |
| Modal close       | yes + Escape                   | Enter / Space / Escape              |
| Modal backdrop    | not focusable                  | click closes (with unsaved confirm) |
| `.mob__tab`       | yes (Link)                     | Enter                               |

The modal must trap focus (focus stays inside while open).

---

## 6. ARIA conventions

| Pattern | ARIA |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------- |
| Panel head as section heading | `<h2 class="panel__title">` (or `role="heading" aria-level="2"`) |
| Toggle switch | `<button role="switch" aria-checked="true                                  | false">` |
| Modal dialog | `<div role="dialog" aria-modal="true" aria-labelledby="modal-title">` |
| Tabs in modal (none currently) | `role="tablist"` + `role="tab"` if added |
| Expand chevron in sidebar | `<button aria-expanded="true                                               | false" aria-controls="sub-id">` |
| Icon-only button | `aria-label="…"` describing the action |
| Loading state | `aria-busy="true"` on the affected region |
| Alert (urgent) | `role="alert"` for the alert pill, or `aria-live="polite"` for less urgent |
| Active nav item | `aria-current="page"` on `.sb__item--active` |

---

## 7. Screen reader announcements

The Activity panel updates in real-time via WebSocket. New activity items should announce themselves:

```html
<div class="activity" role="log" aria-live="polite" aria-relevant="additions">
  <div class="activity__item">…</div>
</div>
```

The alert pill in the strip is "polite" too (it's a status, not a critical interruption). For truly critical alarms (smoke, leak), use `role="alert"`.

---

## 8. Internationalization

Sowel ships in French. All labels are translatable. The design system does not bake language in. However:

- **Tabular nums** rely on Latin digits 0–9. If a future Sowel ships a non-Latin locale (Arabic, Hindi), the tnum feature won't help. Plan: a fallback `font-variant-numeric: oldstyle-nums` for those locales.
- **Letter-spacing on uppercase** (`.panel__title`, `.cat-head`) assumes Latin script. For non-Latin, the `text-transform: uppercase` and the spacing must be conditionally removed.

---

## 9. Audit checklist

Before shipping any new component to production:

- [ ] Color contrast measured for all text + meaningful borders
- [ ] Touch target audited (visible OR hit area must be 44×44 minimum on mobile)
- [ ] Focus-visible outline tested with keyboard tab
- [ ] All icon-only buttons have `aria-label`
- [ ] Reduced motion tested (System Settings → reduce motion, verify the page is still usable)
- [ ] Screen reader tested with VoiceOver (macOS) or NVDA (Windows): all data, states, and actions announced
- [ ] Component works with `prefers-color-scheme: dark` (i.e. dark theme renders correctly)
- [ ] Component works at 200% browser zoom without breaking layout

---

## 10. See also

- [motion.md](motion.md) — `prefers-reduced-motion` handling.
- Every `components/*.md` spec — each has an "Accessibility" section specific to the component.
