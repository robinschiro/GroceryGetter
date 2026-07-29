import type { CartSubmissionProgress, CartSubmissionResult } from "../../infrastructure/kroger/krogerService.js";
import type { DataScope } from "../../types.js";

export type QfcSubmitJob = {
  id: string;
  kind: "preview" | "add";
  menuId: string;
  dataScope: DataScope;
  status: "running" | "complete" | "failed";
  progress: CartSubmissionProgress;
  result?: CartSubmissionResult;
  error?: string;
  createdAt: number;
};

export class QfcJobStore {
  private readonly jobs = new Map<string, QfcSubmitJob>();

  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  prune() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.createdAt < cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }

  getScoped(jobId: string, dataScope: DataScope) {
    const job = this.jobs.get(jobId);
    return job?.dataScope === dataScope ? job : undefined;
  }

  set(job: QfcSubmitJob) {
    this.jobs.set(job.id, job);
  }
}
