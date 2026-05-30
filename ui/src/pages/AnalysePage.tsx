import { AnalyseView } from "../components/history/AnalyseView";
import { AnalyseMobileNav } from "../components/history/AnalyseMobileNav";

export function AnalysePage() {
  return (
    <div className="max-w-[1200px] px-4 py-6">
      <AnalyseMobileNav />
      <AnalyseView />
    </div>
  );
}
