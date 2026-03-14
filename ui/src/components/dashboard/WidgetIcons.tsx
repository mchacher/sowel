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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={on ? "text-active" : "text-primary"}>
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={warm ? "text-error" : "text-primary"}>
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-primary">
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
  const id = useId();
  const postGrad = `gate-post-${id}`;

  return (
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={open ? "text-warning" : "text-primary"}>
      <defs>
        <linearGradient id={postGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      <rect x="6" y="10" width="5" height="38" rx="1.5" fill={`url(#${postGrad})`} />
      <rect x="5" y="8" width="7" height="4" rx="1" fill="currentColor" opacity="0.3" />

      <rect x="45" y="10" width="5" height="38" rx="1.5" fill={`url(#${postGrad})`} />
      <rect x="44" y="8" width="7" height="4" rx="1" fill="currentColor" opacity="0.3" />

      {open ? (
        <>
          <path d="M11 14 L11 44 L17 40 L17 18 Z" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          <path d="M45 14 L45 44 L39 40 L39 18 Z" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          <line x1="11" y1="26" x2="17" y2="28" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.15" />
          <line x1="45" y1="26" x2="39" y2="28" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.15" />
        </>
      ) : (
        <>
          <rect x="11" y="14" width="17" height="30" rx="1" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          <rect x="28" y="14" width="17" height="30" rx="1" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          <line x1="11" y1="26" x2="28" y2="26" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.15" />
          <line x1="28" y1="26" x2="45" y2="26" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.15" />
          <circle cx="26" cy="30" r="1.2" fill="currentColor" opacity="0.3" />
          <circle cx="30" cy="30" r="1.2" fill="currentColor" opacity="0.3" />
        </>
      )}

      <line x1="2" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="1" strokeOpacity="0.1" />
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={comfort ? "text-error" : "text-primary"}>
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
  const id = useId();
  const panelGrad = `sgate-panel-${id}`;

  return (
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={open ? "text-warning" : "text-primary"}>
      <defs>
        <linearGradient id={panelGrad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* Left post */}
      <rect x="4" y="10" width="4" height="36" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="3" y="8" width="6" height="3" rx="1" fill="currentColor" opacity="0.25" />

      {/* Right post */}
      <rect x="48" y="10" width="4" height="36" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="47" y="8" width="6" height="3" rx="1" fill="currentColor" opacity="0.25" />

      {/* Rail (bottom track) */}
      <line x1="8" y1="46" x2="48" y2="46" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.2" />

      {open ? (
        <>
          {/* Panel slid to the left */}
          <rect x="8" y="14" width="14" height="31" rx="1" fill={`url(#${panelGrad})`} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.15" />
          {/* Vertical bars on panel */}
          {[0, 1, 2].map((i) => (
            <line key={i} x1={11 + i * 4} y1="16" x2={11 + i * 4} y2="43" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.12" />
          ))}
          {/* Arrow hint */}
          <path d="M30 29 L25 29 M27 26 L25 29 L27 32" stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          {/* Full panel closed */}
          <rect x="8" y="14" width="40" height="31" rx="1" fill={`url(#${panelGrad})`} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          {/* Vertical bars */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <line key={i} x1={12 + i * 5} y1="16" x2={12 + i * 5} y2="43" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.12" />
          ))}
          {/* Handle */}
          <circle cx="44" cy="30" r="1.2" fill="currentColor" opacity="0.3" />
        </>
      )}

      <line x1="2" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="1" strokeOpacity="0.1" />
    </svg>
  );
}

// ============================================================
// Garage door icon — porte de garage sectionnelle
// ============================================================

export function GarageDoorIcon({ open }: { open: boolean }) {
  const id = useId();
  const wallGrad = `gdoor-wall-${id}`;
  const panelGrad = `gdoor-panel-${id}`;

  return (
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={open ? "text-warning" : "text-primary"}>
      <defs>
        <linearGradient id={wallGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id={panelGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* Garage frame */}
      <path d="M4 10 L28 4 L52 10 L52 48 L4 48 Z" fill={`url(#${wallGrad})`} stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" />

      {open ? (
        <>
          {/* Door rolled up at top */}
          <rect x="10" y="12" width="36" height="8" rx="1" fill={`url(#${panelGrad})`} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          {/* Horizontal section lines (rolled) */}
          <line x1="10" y1="14" x2="46" y2="14" stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.12" />
          <line x1="10" y1="17" x2="46" y2="17" stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.12" />
          {/* Empty opening */}
          <rect x="10" y="20" width="36" height="26" rx="0" fill="currentColor" opacity="0.03" />
        </>
      ) : (
        <>
          {/* Full door with horizontal sections */}
          <rect x="10" y="12" width="36" height="34" rx="1" fill={`url(#${panelGrad})`} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.2" />
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="10" y1={18 + i * 6} x2="46" y2={18 + i * 6} stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.12" />
          ))}
          {/* Handle */}
          <rect x="26" y="38" width="4" height="2" rx="0.5" fill="currentColor" opacity="0.25" />
        </>
      )}

      <line x1="2" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="1" strokeOpacity="0.1" />
    </svg>
  );
}

// ============================================================
// Plug icon — prise connectée / smart plug
// ============================================================

export function PlugWidgetIcon({ on }: { on: boolean }) {
  return (
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={on ? "text-active" : "text-primary"}>
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={active ? "text-warning" : "text-primary"}>
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
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className="text-accent">
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
// Contact sensor icon — capteur d'ouverture porte/fenêtre
// ============================================================

export function ContactSensorIcon({ open }: { open: boolean }) {
  return (
    <svg width="96" height="96" viewBox="0 0 56 56" fill="none" className={open ? "text-warning" : "text-primary"}>
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
