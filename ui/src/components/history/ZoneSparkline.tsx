import { useRef, useState, useEffect, useMemo } from "react";
import { getZoneSparklineData } from "../../api";

/** Session-level cache: key → values[]. */
const zoneSparklineCache = new Map<string, number[]>();

interface ZoneSparklineProps {
  zoneId: string;
  category: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Zone-level sparkline — shows average trend for a category across all equipments in the zone.
 * Same rendering approach as Sparkline but uses the zone sparkline endpoint.
 */
export function ZoneSparkline({
  zoneId,
  category,
  width = 60,
  height = 24,
  className = "",
}: ZoneSparklineProps) {
  const cacheKey = `zone:${zoneId}:${category}`;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [values, setValues] = useState<number[] | null>(
    () => zoneSparklineCache.get(cacheKey) ?? null,
  );
  const [loading, setLoading] = useState(() => !zoneSparklineCache.has(cacheKey));

  // Lazy visibility detection
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch data once visible (skip if already cached via initial state)
  useEffect(() => {
    if (!visible || zoneSparklineCache.has(cacheKey)) return;

    let cancelled = false;
    getZoneSparklineData(zoneId, category)
      .then((res) => {
        if (cancelled) return;
        zoneSparklineCache.set(cacheKey, res.values);
        setValues(res.values);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [visible, zoneId, category, cacheKey]);

  // Build SVG path from values
  const pathData = useMemo(() => {
    if (!values || values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 2;
    const usableHeight = height - padding * 2;

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = padding + usableHeight - ((v - min) / range) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const linePath = `M${points.join(" L")}`;
    const fillPath = `${linePath} L${width},${height} L0,${height} Z`;

    return { linePath, fillPath };
  }, [values, width, height]);

  // Skeleton shimmer while loading
  if (loading || !visible) {
    return (
      <div
        ref={ref}
        className={`flex-shrink-0 rounded-[3px] animate-pulse bg-border-light ${className}`}
        style={{ width, height }}
      />
    );
  }

  // No data — render nothing
  if (!pathData) return null;

  return (
    <div ref={ref} className={`flex-shrink-0 ${className}`} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
      >
        <defs>
          <linearGradient id={`zsp-${zoneId}-${category}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path
          d={pathData.fillPath}
          fill={`url(#zsp-${zoneId}-${category})`}
        />
        <path
          d={pathData.linePath}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
