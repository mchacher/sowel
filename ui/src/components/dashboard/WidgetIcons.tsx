/**
 * Shared SVG icons for dashboard widgets (4-zone layout).
 * All icons: 96x96 rendered, viewBox 0 0 56 56, className="text-primary", currentColor.
 *
 * Each icon uses useId() to generate unique gradient IDs, avoiding
 * cross-instance bleeding when multiple SVGs share the same page.
 */
import { useId } from "react";

// ============================================================
// Light bulb icon — on/off state with filament + rays
// ============================================================

export function LightBulbIcon({ on }: { on: boolean }) {
  const id = useId();
  const glassGrad = `bulb-glass-${id}`;
  const baseGrad = `bulb-base-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={on ? "text-active" : "text-primary"}>
      <defs>
        <linearGradient id={glassGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={on ? 0.4 : 0.08} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={on ? 0.2 : 0.04} />
        </linearGradient>
        <linearGradient id={baseGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {on && (
        <circle cx="28" cy="20" r="18" fill="currentColor" opacity="0.08" />
      )}

      <path
        d="M28 4C21.4 4 16 9.4 16 16c0 4.2 2.1 7.9 5.3 10.1L22 28.5v4a2 2 0 002 2h8a2 2 0 002-2v-4l.7-2.4C37.9 23.9 40 20.2 40 16c0-6.6-5.4-12-12-12z"
        fill={`url(#${glassGrad})`}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity={on ? 0.6 : 0.3}
      />

      <path
        d="M22 11c1.5-2.5 3.8-4.5 6-4.5.8 0 .6.4-.2.8-2 1.2-4 3.5-5 6.5-.3.8-.8.5-.8-2.8z"
        fill="currentColor"
        opacity={on ? 0.2 : 0.08}
      />

      {on && (
        <>
          <path d="M25 18c0-1.8 1.5-3.2 3-3.2s3 1.4 3 3.2" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.45" fill="none" strokeLinecap="round" />
          <path d="M25.5 20.5c0-1.2 1.2-2.2 2.5-2.2s2.5 1 2.5 2.2" stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.3" fill="none" strokeLinecap="round" />
        </>
      )}

      <rect x="22" y="34.5" width="12" height="2.5" rx="1" fill={`url(#${baseGrad})`} />
      <rect x="23" y="38" width="10" height="2" rx="0.8" fill={`url(#${baseGrad})`} opacity="0.8" />
      <rect x="24" y="41" width="8" height="2" rx="1" fill={`url(#${baseGrad})`} opacity="0.6" />

      {on && (
        <g stroke="currentColor" strokeLinecap="round" strokeOpacity="0.3">
          <line x1="28" y1="0" x2="28" y2="2.5" strokeWidth="1.2" />
          <line x1="7" y1="16" x2="9.5" y2="16" strokeWidth="1.2" />
          <line x1="46.5" y1="16" x2="49" y2="16" strokeWidth="1.2" />
          <line x1="12.5" y1="6" x2="14.5" y2="8" strokeWidth="1" strokeOpacity="0.2" />
          <line x1="43.5" y1="6" x2="41.5" y2="8" strokeWidth="1" strokeOpacity="0.2" />
        </g>
      )}
    </svg>
  );
}

// ============================================================
// Shutter icon — 5 levels (0%, 25%, 50%, 75%, 100%)
// ============================================================

export function ShutterWidgetIcon({ level }: { level: number | null }) {
  const id = useId();
  const slatGradId = `shutter-slat-${id}`;
  const glassId = `shutter-glass-${id}`;

  const slatCount = level === null ? 7
    : level === 0 ? 7
    : level === 25 ? 5
    : level === 50 ? 4
    : level === 75 ? 2
    : 1;

  const winX = 4;
  const winY = 10;
  const winW = 48;
  const winH = 42;
  const slatX = winX + 2;
  const slatW = winW - 4;
  const slatH = 4.5;
  const slatGap = 1;
  const slatStartY = winY + 2;
  const slatTotalH = slatCount * (slatH + slatGap);

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={slatGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.65" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.04" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      <rect x={winX} y={winY - 5} width={winW} height="6" rx="3" fill="currentColor" opacity="0.2" />

      <rect
        x={winX} y={winY} width={winW} height={winH}
        rx="2" stroke="currentColor" strokeWidth="1.2" fill={`url(#${glassId})`}
      />

      <line x1="28" y1={winY + 1} x2="28" y2={winY + winH - 1} stroke="currentColor" strokeWidth="0.6" opacity="0.1" />
      <line x1={winX + 1} y1={winY + winH / 2} x2={winX + winW - 1} y2={winY + winH / 2} stroke="currentColor" strokeWidth="0.6" opacity="0.1" />

      {Array.from({ length: slatCount }).map((_, i) => (
        <rect
          key={i}
          x={slatX}
          y={slatStartY + i * (slatH + slatGap)}
          width={slatW}
          height={slatH}
          rx="1"
          fill={`url(#${slatGradId})`}
        />
      ))}

      {slatCount > 0 && (
        <rect
          x={slatX}
          y={slatStartY + slatTotalH - slatH - slatGap}
          width={slatW}
          height={slatH + 1}
          rx="1.5"
          fill="currentColor"
          opacity="0.55"
        />
      )}
    </svg>
  );
}

// ============================================================
// Thermometer icon — for thermostat / heating widgets
// ============================================================

export function ThermometerIcon({ warm, level }: { warm: boolean; level?: number }) {
  const id = useId();
  const tubeGrad = `thermo-tube-${id}`;
  const fillGrad = `thermo-fill-${id}`;
  const clipId = `thermo-clip-${id}`;

  // Geometry: narrow tube + bulb with explicit center
  const cx = 28;
  const tubeHW = 3.5;       // tube half-width
  const tubeTop = 6;
  const bulbCy = 42;         // explicit bulb center
  const bulbR = 9;

  // Junction Y: where tube sides meet the bulb circle
  const junctionY = (hw: number, r: number) => bulbCy - Math.sqrt(r * r - hw * hw);

  // Outer path
  const oL = cx - tubeHW;
  const oR = cx + tubeHW;
  const oJy = junctionY(tubeHW, bulbR);
  const outlinePath = [
    `M${oL} ${tubeTop + tubeHW}`,
    `A${tubeHW} ${tubeHW} 0 0 1 ${oR} ${tubeTop + tubeHW}`,
    `L${oR} ${oJy}`,
    `A${bulbR} ${bulbR} 0 1 1 ${oL} ${oJy}`,
    `Z`,
  ].join(" ");

  // Inner path (inset) — concentric with same bulb center
  const inset = 1.5;
  const iHW = tubeHW - inset;
  const iR2 = bulbR - inset;
  const iL = cx - iHW;
  const iR = cx + iHW;
  const iTop = tubeTop + inset;
  const iJy = junctionY(iHW, iR2);
  const innerPath = [
    `M${iL} ${iTop + iHW}`,
    `A${iHW} ${iHW} 0 0 1 ${iR} ${iTop + iHW}`,
    `L${iR} ${iJy}`,
    `A${iR2} ${iR2} 0 1 1 ${iL} ${iJy}`,
    `Z`,
  ].join(" ");

  // Mercury level
  const clampedLevel = level != null ? Math.max(0, Math.min(1, level)) : (warm ? 0.6 : 0.3);
  const fillTop = iJy - clampedLevel * (iJy - iTop - 2);

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={warm ? "text-error" : "text-primary"}>
      <defs>
        <linearGradient id={tubeGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={fillGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={warm ? 0.45 : 0.2} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={warm ? 0.7 : 0.4} />
        </linearGradient>
        {/* Clip mercury to the inset interior — gap between fill and outline */}
        <clipPath id={clipId}>
          <path d={innerPath} />
        </clipPath>
      </defs>

      {/* Glass outline */}
      <path d={outlinePath} fill={`url(#${tubeGrad})`} stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />

      {/* Mercury: a full-width rect clipped to the outline — fills tube + bulb cleanly */}
      <rect x="0" y={fillTop} width="56" height={56 - fillTop} fill={`url(#${fillGrad})`} clipPath={`url(#${clipId})`} />

      {/* Tick marks */}
      <g stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15">
        <line x1={oR + 2} y1="14" x2={oR + 5} y2="14" />
        <line x1={oR + 2} y1="20" x2={oR + 5} y2="20" />
        <line x1={oR + 2} y1="26" x2={oR + 5} y2="26" />
        <line x1={oR + 2} y1="32" x2={oR + 5} y2="32" />
      </g>
    </svg>
  );
}

// ============================================================
// Multi-sensor icon — boîtier capteur avec ondes (default sensor)
// ============================================================

export function MultiSensorIcon() {
  const id = useId();
  const bodyGrad = `msensor-body-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      {/* Sensor box body */}
      <rect x="14" y="14" width="28" height="28" rx="6" fill={`url(#${bodyGrad})`} stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />

      {/* Sensor eye / lens */}
      <circle cx="28" cy="28" r="6" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" />
      <circle cx="28" cy="28" r="2.5" fill="currentColor" opacity="0.25" />

      {/* Signal waves (top-right) */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${38 + i * 4} ${8 - i * 2} Q${42 + i * 4} ${14 - i} ${38 + i * 4} ${20 - i * 2}`}
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity={0.25 - i * 0.06}
          fill="none"
          strokeLinecap="round"
        />
      ))}

      {/* LED indicator dot */}
      <circle cx="20" cy="20" r="1.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

// ============================================================
// Humidity sensor icon — goutte d'eau
// ============================================================

export function HumiditySensorIcon() {
  const id = useId();
  const dropGrad = `humidity-drop-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={dropGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* Water drop */}
      <path
        d="M28 6 Q28 6 18 26 A12 12 0 0 0 38 26 Q28 6 28 6 Z"
        fill={`url(#${dropGrad})`}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.3"
      />

      {/* Fill level line */}
      <path d="M20 30 Q24 28 28 30 Q32 32 36 30" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" fill="none" />

      {/* Shine */}
      <path d="M23 20 Q24 16 26 14" stroke="currentColor" strokeWidth="1" strokeOpacity="0.15" fill="none" strokeLinecap="round" />

      {/* Percentage hint — small drops */}
      <circle cx="22" cy="44" r="2" fill="currentColor" opacity="0.12" />
      <circle cx="28" cy="46" r="1.5" fill="currentColor" opacity="0.1" />
      <circle cx="34" cy="44" r="2" fill="currentColor" opacity="0.12" />
    </svg>
  );
}

// ============================================================
// Luminosity sensor icon — soleil avec rayons
// ============================================================

export function LuminositySensorIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Sun body */}
      <circle cx="28" cy="28" r="10" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
      <circle cx="28" cy="28" r="5" fill="currentColor" opacity="0.2" />

      {/* Rays */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 28 + Math.cos(rad) * 14;
        const y1 = 28 + Math.sin(rad) * 14;
        const x2 = 28 + Math.cos(rad) * 19;
        const y2 = 28 + Math.sin(rad) * 19;
        return (
          <line
            key={angle}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="currentColor"
            strokeWidth={angle % 90 === 0 ? "1.5" : "1"}
            strokeOpacity={angle % 90 === 0 ? 0.3 : 0.18}
            strokeLinecap="round"
          />
        );
      })}

      {/* Lux indicator — small arcs */}
      <path d="M10 46 Q14 42 18 46" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" fill="none" />
      <path d="M38 46 Q42 42 46 46" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" fill="none" />
    </svg>
  );
}

// ============================================================
// Water leak sensor icon — goutte tombant dans flaque
// ============================================================

export function WaterLeakSensorIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Falling drop */}
      <path
        d="M28 4 Q28 4 24 14 A5 5 0 0 0 32 14 Q28 4 28 4 Z"
        fill="currentColor"
        opacity="0.3"
      />

      {/* Splash drop */}
      <path
        d="M28 18 Q28 18 24 28 A5 5 0 0 0 32 28 Q28 18 28 18 Z"
        fill="currentColor"
        opacity="0.2"
      />

      {/* Puddle / water surface */}
      <ellipse cx="28" cy="40" rx="18" ry="4" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" />

      {/* Ripples */}
      <ellipse cx="28" cy="40" rx="8" ry="2" fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" />
      <ellipse cx="28" cy="40" rx="14" ry="3" fill="none" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.1" />

      {/* Warning splash lines */}
      <path d="M22 34 L20 30" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" strokeLinecap="round" />
      <path d="M34 34 L36 30" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// Smoke sensor icon — détecteur rond avec fumée
// ============================================================

export function SmokeSensorIcon() {
  const id = useId();
  const bodyGrad = `smoke-body-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Round detector body */}
      <circle cx="28" cy="32" r="16" fill={`url(#${bodyGrad})`} stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />

      {/* Inner ring */}
      <circle cx="28" cy="32" r="10" fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.12" />

      {/* Slots/vents */}
      {[-20, -10, 0, 10, 20].map((offset) => (
        <line key={offset} x1={22 + offset * 0.1} y1={32 + offset * 0.3} x2={34 + offset * 0.1} y2={32 + offset * 0.3} stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.1" />
      ))}

      {/* LED */}
      <circle cx="28" cy="38" r="1.5" fill="currentColor" opacity="0.25" />

      {/* Smoke wisps */}
      <path d="M20 16 Q22 12 20 8" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" fill="none" strokeLinecap="round" />
      <path d="M28 14 Q30 10 28 6" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" fill="none" strokeLinecap="round" />
      <path d="M36 16 Q38 12 36 8" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// CO2 sensor icon — nuage avec CO₂
// ============================================================

export function Co2SensorIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Cloud shape */}
      <path
        d="M14 32 A10 10 0 0 1 20 16 A12 12 0 0 1 40 16 A10 10 0 0 1 42 32 Z"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.25"
      />

      {/* CO₂ text */}
      <text x="28" y="28" textAnchor="middle" fill="currentColor" opacity="0.4" fontSize="9" fontWeight="600" fontFamily="sans-serif">
        CO₂
      </text>

      {/* Measurement waves below */}
      <path d="M14 40 Q18 37 22 40 Q26 43 30 40 Q34 37 38 40 Q42 43 46 40" stroke="currentColor" strokeWidth="1" strokeOpacity="0.15" fill="none" strokeLinecap="round" />
      <path d="M16 45 Q20 42 24 45 Q28 48 32 45 Q36 42 40 45" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// Pressure sensor icon — baromètre cadran avec aiguille
// ============================================================

export function PressureSensorIcon() {
  const id = useId();
  const arcGrad = `pressure-arc-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={arcGrad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* Dial face */}
      <circle cx="28" cy="28" r="22" fill="currentColor" fillOpacity="0.04" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" />

      {/* Pressure arc (background) */}
      <path
        d="M10 38 A22 22 0 0 1 46 38"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.1"
        fill="none"
        strokeLinecap="round"
      />

      {/* Pressure arc (value — ~70%) */}
      <path
        d="M10 38 A22 22 0 0 1 40 14"
        stroke={`url(#${arcGrad})`}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />

      {/* Tick marks */}
      {[150, 180, 210, 240, 270, 300, 330, 360, 390].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 28 + Math.cos(rad) * 18;
        const y1 = 28 + Math.sin(rad) * 18;
        const x2 = 28 + Math.cos(rad) * 20;
        const y2 = 28 + Math.sin(rad) * 20;
        return (
          <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" />
        );
      })}

      {/* Needle (pointing ~70% = about 330°) */}
      <line x1="28" y1="28" x2="38" y2="16" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" strokeLinecap="round" />

      {/* Center pivot */}
      <circle cx="28" cy="28" r="2.5" fill="currentColor" opacity="0.25" />
      <circle cx="28" cy="28" r="1.2" fill="currentColor" opacity="0.4" />

      {/* hPa label */}
      <text x="28" y="42" textAnchor="middle" fill="currentColor" opacity="0.2" fontSize="6" fontFamily="sans-serif">
        hPa
      </text>
    </svg>
  );
}

// ============================================================
// Gate icon — barrier/door for gate widgets
// ============================================================

export function GateWidgetIcon({ open }: { open: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Left pillar */}
      <rect x="4" y="10" width="6" height="36" rx="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="currentColor" fillOpacity="0.06" />
      <circle cx="7" cy="10" r="3.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />
      {/* Right pillar */}
      <rect x="46" y="10" width="6" height="36" rx="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="currentColor" fillOpacity="0.06" />
      <circle cx="49" cy="10" r="3.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />

      {open ? (
        <>
          {/* Left door (open — perspective) */}
          <path d="M10 16 L16 20 L16 40 L10 44" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.06" />
          <line x1="13" y1="18" x2="13" y2="42" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round" />
          {/* Right door (open — perspective) */}
          <path d="M46 16 L40 20 L40 40 L46 44" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.06" />
          <line x1="43" y1="18" x2="43" y2="42" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Left door */}
          <path d="M10 16 L27 16 L27 44 L10 44" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.04" />
          <line x1="15" y1="16" x2="15" y2="44" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" strokeLinecap="round" />
          <line x1="21" y1="16" x2="21" y2="44" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" strokeLinecap="round" />
          <line x1="10" y1="30" x2="27" y2="30" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          {/* Right door */}
          <path d="M29 16 L46 16 L46 44 L29 44" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.04" />
          <line x1="35" y1="16" x2="35" y2="44" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" strokeLinecap="round" />
          <line x1="41" y1="16" x2="41" y2="44" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" strokeLinecap="round" />
          <line x1="29" y1="30" x2="46" y2="30" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
        </>
      )}

      {/* Ground */}
      <line x1="2" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.1" />
    </svg>
  );
}

// ============================================================
// Heater icon — radiator for heater/fil pilote widgets
// ============================================================

export function HeaterWidgetIcon({ comfort }: { comfort: boolean }) {
  const id = useId();
  const finGrad = `heater-fin-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={comfort ? "text-error" : "text-primary"}>
      <defs>
        <linearGradient id={finGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={comfort ? 0.4 : 0.15} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={comfort ? 0.25 : 0.08} />
        </linearGradient>
      </defs>

      <rect x="6" y="12" width="44" height="3" rx="1.5" fill="currentColor" opacity="0.25" />

      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect
          key={i}
          x={9 + i * 6}
          y="16"
          width="4"
          height="24"
          rx="1"
          fill={`url(#${finGrad})`}
        />
      ))}

      <rect x="6" y="41" width="44" height="3" rx="1.5" fill="currentColor" opacity="0.25" />

      <rect x="10" y="44" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.2" />
      <rect x="43" y="44" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.2" />

      {comfort && (
        <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.25">
          <path d="M16 8 Q18 5 16 2" fill="none" />
          <path d="M28 8 Q30 5 28 2" fill="none" />
          <path d="M40 8 Q42 5 40 2" fill="none" />
        </g>
      )}
    </svg>
  );
}

// ============================================================
// Sliding gate icon — portail coulissant (rail + panel)
// ============================================================

export function SlidingGateIcon({ open }: { open: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Left pillar */}
      <rect x="3" y="10" width="5" height="34" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="currentColor" fillOpacity="0.08" />
      {/* Right pillar */}
      <rect x="48" y="10" width="5" height="34" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="currentColor" fillOpacity="0.08" />
      {/* Rail */}
      <line x1="8" y1="44" x2="48" y2="44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.2" />

      {open ? (
        <>
          {/* Panel slid left */}
          <rect x="8" y="14" width="16" height="29" rx="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.06" />
          <line x1="13" y1="16" x2="13" y2="41" stroke="currentColor" strokeWidth="1" strokeOpacity="0.15" strokeLinecap="round" />
          <line x1="18" y1="16" x2="18" y2="41" stroke="currentColor" strokeWidth="1" strokeOpacity="0.15" strokeLinecap="round" />
          {/* Arrow hint */}
          <path d="M32 28 L27 28 M29 25 L27 28 L29 31" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          {/* Full panel closed */}
          <rect x="8" y="14" width="40" height="29" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.04" />
          {/* Vertical bars */}
          <line x1="14" y1="16" x2="14" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="20" y1="16" x2="20" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="26" y1="16" x2="26" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="32" y1="16" x2="32" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="38" y1="16" x2="38" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="44" y1="16" x2="44" y2="41" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.18" strokeLinecap="round" />
          {/* Horizontal bar */}
          <line x1="8" y1="28" x2="48" y2="28" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15" strokeLinecap="round" />
        </>
      )}

      {/* Ground */}
      <line x1="2" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.1" />
    </svg>
  );
}

// ============================================================
// Garage door icon — porte de garage sectionnelle
// ============================================================

export function GarageDoorIcon({ open }: { open: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      {/* Roof */}
      <path d="M6 16 L28 6 L50 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Walls */}
      <path d="M8 16 L8 48 L48 48 L48 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.03" />

      {open ? (
        <>
          {/* Door rolled up */}
          <rect x="13" y="19" width="30" height="7" rx="2" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="13" y1="22.5" x2="43" y2="22.5" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.18" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Door closed */}
          <rect x="13" y="20" width="30" height="26" rx="2" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Sections */}
          <line x1="13" y1="26.5" x2="43" y2="26.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="13" y1="33" x2="43" y2="33" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round" />
          <line x1="13" y1="39.5" x2="43" y2="39.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round" />
          {/* Handle */}
          <line x1="26" y1="42" x2="30" y2="42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.3" />
        </>
      )}

      {/* Ground */}
      <line x1="4" y1="48" x2="52" y2="48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.12" />
    </svg>
  );
}

// ============================================================
// Plug icon — prise connectée / smart plug
// ============================================================

export function PlugWidgetIcon({ on }: { on: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={on ? "text-active" : "text-primary"}>
      {/* Plug body */}
      <rect x="16" y="20" width="24" height="22" rx="4" fill="currentColor" fillOpacity={on ? 0.12 : 0.06} stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />
      {/* Prongs */}
      <rect x="22" y="10" width="3" height="12" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="31" y="10" width="3" height="12" rx="1.5" fill="currentColor" opacity="0.3" />
      {/* Power indicator */}
      {on && <circle cx="28" cy="31" r="4" fill="currentColor" opacity="0.2" />}
      <circle cx="28" cy="31" r="2" fill="currentColor" opacity={on ? 0.5 : 0.15} />
      {/* Cable */}
      <path d="M28 42 L28 50" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// Motion sensor icon — capteur de mouvement
// ============================================================

export function MotionSensorIcon({ active }: { active: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={active ? "text-warning" : "text-primary"}>
      {/* Person silhouette */}
      <circle cx="22" cy="14" r="4" fill="currentColor" opacity="0.25" />
      <path d="M22 18 L22 30 M16 23 L28 23 M22 30 L16 40 M22 30 L28 40" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" strokeLinecap="round" strokeLinejoin="round" />
      {/* Detection waves */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${34 + i * 5} ${16 + i * 2} Q${38 + i * 5} 28 ${34 + i * 5} ${40 - i * 2}`}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeOpacity={active ? 0.35 - i * 0.08 : 0.12 - i * 0.03}
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

// ============================================================
// Contact sensor icon — capteur d'ouverture porte/fenêtre
// ============================================================

export function EnergyMeterIcon() {
  const id = useId();
  const bodyGrad = `energy-body-${id}`;
  const screenGrad = `energy-screen-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-accent">
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={screenGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* Meter body */}
      <rect x="10" y="8" width="36" height="40" rx="4" fill={`url(#${bodyGrad})`} stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />

      {/* Display screen */}
      <rect x="14" y="13" width="28" height="14" rx="2" fill={`url(#${screenGrad})`} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" />

      {/* kWh digits hint */}
      <text x="28" y="24" textAnchor="middle" fill="currentColor" opacity="0.45" fontSize="8" fontWeight="700" fontFamily="monospace">
        kWh
      </text>

      {/* Lightning bolt */}
      <path
        d="M25 32 L29 32 L27 37 L31 37 L24 46 L26 40 L23 40 Z"
        fill="currentColor"
        opacity="0.35"
      />
    </svg>
  );
}

// ============================================================
// Pool filter pump (Design F) — tank + manometer + junction box
// ============================================================

export function PoolPumpIcon({ on }: { on: boolean }) {
  // Pipes flow water (blue) when ON, are hollow (white) when OFF.
  // Junction box shows "ON" centered when ON, 4 screws when OFF.
  // Manometer needle pressurized when ON, at rest when OFF.
  const waterStroke = on ? "#3B82F6" : "white";
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={on ? "text-active" : "text-primary"}>
      {/* PIPES — outer stroke + inner water/hollow */}
      <path d="M14 11 L42 11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 11 L42 11" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 16 L14 11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 16 L14 11" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M42 11 L42 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M42 11 L42 20" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M42 36 L42 49" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M42 36 L42 49" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 49 L42 49" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M3 49 L42 49" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 45 L14 49" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 45 L14 49" stroke={waterStroke} strokeWidth="1.5" strokeLinecap="round" />

      {/* MANOMETER */}
      <circle cx="28" cy="10" r="5" stroke="currentColor" strokeWidth="1.6" fill="white" />
      {on ? (
        <line x1="28" y1="10" x2="30.5" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      ) : (
        <line x1="28" y1="10" x2="25" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
      <circle cx="28" cy="10" r="0.9" fill="currentColor" />

      {/* TANK (3-stages, left side) */}
      <path
        d="M8 16 Q8 14 10 14 L18 14 Q20 14 20 16 L20 18 L8 18 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="white"
        strokeLinejoin="round"
      />
      <path
        d="M8 18 Q5 21 5 25 L5 28 L23 28 L23 25 Q23 21 20 18 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="white"
        strokeLinejoin="round"
      />
      <rect x="4" y="28" width="20" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="white" />
      <path
        d="M5 31 L5 41 Q5 45 10 45 L18 45 Q23 45 23 41 L23 31 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="white"
        strokeLinejoin="round"
      />
      <path d="M9 21 L9 25" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" opacity="0.5" />

      {/* JUNCTION BOX */}
      <rect x="34" y="20" width="16" height="16" rx="1" stroke="currentColor" strokeWidth="1.6" fill="white" />
      {on ? (
        <text
          x="42"
          y="28"
          fontFamily="-apple-system, sans-serif"
          fontWeight="800"
          fontSize="7"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
        >
          ON
        </text>
      ) : (
        <>
          <circle cx="37" cy="23" r="0.9" fill="currentColor" />
          <circle cx="47" cy="23" r="0.9" fill="currentColor" />
          <circle cx="37" cy="33" r="0.9" fill="currentColor" />
          <circle cx="47" cy="33" r="0.9" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

// ============================================================
// Pool cover (Design G) — landscape pool + roller + vertical slats
// ============================================================

export function PoolCoverIcon({ position }: { position: number | null }) {
  // position 0..100, null = unknown.
  // Bucketing mirrors the shutter widget: 0/25/50/75/100.
  const bucket =
    position === null
      ? 50
      : position <= 12
        ? 0
        : position <= 37
          ? 25
          : position <= 62
            ? 50
            : position <= 87
              ? 75
              : 100;
  // Higher position = more cover rolled out = MORE slats visible.
  // We assume position = % open. So 100% open → no slats; 0% → all slats.
  // Here we keep the design semantics: slatCount drops with openness.
  const slatCount =
    bucket === 0 ? 9 : bucket === 25 ? 7 : bucket === 50 ? 5 : bucket === 75 ? 3 : 1;

  const id = useId();
  const waterGrad = `pool-water-${id}`;
  const slatGrad = `pool-slat-${id}`;

  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className="text-primary">
      <defs>
        <linearGradient id={waterGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.04" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={slatGrad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.65" />
        </linearGradient>
      </defs>

      {/* Roller housing on the left */}
      <rect x="3" y="14" width="6" height="28" rx="3" fill="currentColor" opacity="0.2" />

      {/* Pool basin */}
      <rect
        x="9"
        y="14"
        width="44"
        height="28"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.2"
        fill={`url(#${waterGrad})`}
      />
      <line x1="9" y1="28" x2="53" y2="28" stroke="currentColor" strokeWidth="0.6" opacity="0.1" />

      {/* Water waves on the uncovered area (right of last slat) */}
      {Array.from({ length: 3 }).map((_, i) => {
        const y = 21 + i * 7;
        const startX = 11 + slatCount * 4;
        if (startX > 50) return null;
        return (
          <path
            key={i}
            d={`M${startX} ${y} Q${startX + 2} ${y - 1} ${startX + 4} ${y} T${startX + 8} ${y} T${startX + 12} ${y} T${startX + 16} ${y}`}
            stroke="currentColor"
            strokeWidth="0.8"
            strokeOpacity="0.35"
            fill="none"
            strokeLinecap="round"
          />
        );
      })}

      {/* Cover slats (vertical, rolling out from the roller) */}
      {Array.from({ length: slatCount }).map((_, i) => (
        <rect
          key={i}
          x={11 + i * 4}
          y="16"
          width="3.5"
          height="24"
          rx="0.8"
          fill={`url(#${slatGrad})`}
        />
      ))}
    </svg>
  );
}

// ============================================================
// Water valve (widget) — gate valve with handle position + flow
// ============================================================

export function WaterValveWidgetIcon({ open }: { open: boolean }) {
  // Pipe horizontal across the bottom; valve body in the center; handle
  // horizontal when OPEN, vertical when CLOSED. Water flow visible only
  // when OPEN.
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={open ? "text-active" : "text-primary"}>
      {/* Pipe (horizontal) */}
      <rect
        x="4"
        y="32"
        width="48"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="white"
      />
      {/* Flanges */}
      <line x1="9" y1="32" x2="9" y2="42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="47" y1="32" x2="47" y2="42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />

      {/* Water flow inside the pipe (only when open) */}
      {open && (
        <>
          <path d="M12 37 Q16 35 20 37 T28 37 T36 37 T44 37" stroke="#3B82F6" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M12 39.5 Q16 37.5 20 39.5 T28 39.5 T36 39.5 T44 39.5" stroke="#3B82F6" strokeWidth="1.0" fill="none" strokeLinecap="round" strokeOpacity="0.5" />
        </>
      )}

      {/* Valve body (vertical extension) */}
      <rect x="22" y="20" width="12" height="14" rx="1" stroke="currentColor" strokeWidth="1.6" fill="white" />

      {/* Stem */}
      <line x1="28" y1="10" x2="28" y2="22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />

      {/* Handle: horizontal (open) / vertical (closed) */}
      {open ? (
        <rect x="14" y="8" width="28" height="4" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.18" />
      ) : (
        <rect x="26" y="2" width="4" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.18" />
      )}
    </svg>
  );
}

// ============================================================
// Contact sensor icon — capteur d'ouverture porte/fenêtre
// ============================================================

export function ContactSensorIcon({ open }: { open: boolean }) {
  return (
    <svg width="120" height="120" viewBox="0 0 56 56" fill="none" className={open ? "text-warning" : "text-primary"}>
      {/* Door frame */}
      <rect x="8" y="6" width="18" height="44" rx="2" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" />
      {/* Door */}
      <rect x={open ? "32" : "26"} y="6" width="18" height="44" rx="2" fill="currentColor" fillOpacity={open ? 0.08 : 0.1} stroke="currentColor" strokeWidth="1" strokeOpacity="0.25" />
      {/* Handle */}
      <circle cx={open ? 35 : 29} cy="28" r="1.5" fill="currentColor" opacity="0.3" />
      {/* Sensor dots */}
      <circle cx="24" cy="18" r="2" fill="currentColor" opacity={open ? 0.15 : 0.3} />
      <circle cx={open ? 32 : 28} cy="18" r="2" fill="currentColor" opacity={open ? 0.15 : 0.3} />
      {/* Gap indicator when open */}
      {open && (
        <line x1="28" y1="10" x2="28" y2="46" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.1" strokeDasharray="2 2" />
      )}
    </svg>
  );
}
