export type TimeRange = "6h" | "24h" | "7d" | "30d";

/** Categories where values are cumulative totals — displayed as bar charts with sum aggregation. */
export const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);

/** Convert a TimeRange to a relative "from" string for the API. */
export function rangeToFrom(range: TimeRange): string {
  switch (range) {
    case "6h":
      return "-6h";
    case "24h":
      return "-24h";
    case "7d":
      return "-168h"; // 7 * 24
    case "30d":
      return "-720h"; // 30 * 24
  }
}
