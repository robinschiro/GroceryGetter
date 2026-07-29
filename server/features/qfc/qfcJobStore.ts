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

export function createQfcJobStore({ ttlMs = 15 * 60 * 1000 } = {}) {
  const jobs = new Map<string, QfcSubmitJob>();

  function prune() {
    const cutoff = Date.now() - ttlMs;
    for (const [jobId, job] of jobs.entries()) {
      if (job.createdAt < cutoff) {
        jobs.delete(jobId);
      }
    }
  }

  function getScoped(jobId: string, dataScope: DataScope) {
    const job = jobs.get(jobId);
    return job?.dataScope === dataScope ? job : undefined;
  }

  function set(job: QfcSubmitJob) {
    jobs.set(job.id, job);
  }

  return { getScoped, prune, set };
}
