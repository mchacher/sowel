import { AnalyseView } from "../components/history/AnalyseView";
import { AnalyseMobileNav } from "../components/history/AnalyseMobileNav";

export function AnalysePage() {
  return (
    <div className="max-w-[1200px] p-4 sm:p-6">
      <AnalyseMobileNav />
      <AnalyseView />
    </div>
  );
}
