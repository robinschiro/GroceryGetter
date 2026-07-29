import type { QfcSubmitProgress } from "../../shared/contracts/index.js";

export function QfcSubmitProgressBar({ progress }: { progress: QfcSubmitProgress }) {
  const fallbackByPhase = {
    checking: 8,
    matching: 20,
    adding: 92,
    complete: 100
  };
  const itemPercent = progress.totalItems
    ? Math.round((progress.processedItems / progress.totalItems) * 80) + 10
    : fallbackByPhase[progress.phase];
  const percent = progress.phase === "complete"
    ? 100
    : Math.min(96, Math.max(fallbackByPhase[progress.phase], itemPercent));

  return (
    <div className="qfc-progress" role="status" aria-live="polite">
      <div className="qfc-progress-meta">
        <strong>{progress.message}</strong>
        <span>{percent}%</span>
      </div>
      <div className="qfc-progress-track" aria-hidden="true">
        <div className="qfc-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
