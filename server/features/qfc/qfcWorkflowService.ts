import { randomUUID } from "node:crypto";
import type { QfcService } from "../../infrastructure/kroger/krogerService.js";
import type { DataScope } from "../../types.js";
import type { Menu, ShoppingListItem } from "../../../shared/contracts/index.js";
import { QfcJobStore, type QfcSubmitJob } from "./qfcJobStore.js";
import type { createQfcRepository } from "./qfcRepository.js";

type CompletePreviewJob = QfcSubmitJob & {
  kind: "preview";
  status: "complete";
  result: NonNullable<QfcSubmitJob["result"]>;
};

export type QfcPlannerReader = {
  getMenu(menuId: number, dataScope: DataScope): Menu | null;
  getShoppingListItems(menuId: number, dataScope: DataScope): ShoppingListItem[];
};

export class QfcWorkflowError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function createQfcWorkflowService({
  plannerRepository,
  qfcRepository,
  qfcService,
  jobStore = new QfcJobStore()
}: {
  plannerRepository: QfcPlannerReader;
  qfcRepository: ReturnType<typeof createQfcRepository>;
  qfcService: QfcService;
  jobStore?: QfcJobStore;
}) {
  function requirePreviewJob(jobId: string, dataScope: DataScope) {
    jobStore.prune();
    const job = jobStore.getScoped(jobId, dataScope);
    if (!job || job.kind !== "preview" || job.status !== "complete" || !job.result) {
      throw new QfcWorkflowError(
        409,
        "The store item review is unavailable or incomplete. Preview the store items again."
      );
    }
    return job as CompletePreviewJob;
  }

  function startPreview(menuId: number, dataScope: DataScope) {
    if (!plannerRepository.getMenu(menuId, dataScope)) {
      throw new QfcWorkflowError(404, "Menu not found.");
    }
    const rows = plannerRepository.getShoppingListItems(menuId, dataScope)
      .filter((item) => Boolean(item.approved));

    jobStore.prune();
    const job: QfcSubmitJob = {
      id: randomUUID(),
      kind: "preview",
      menuId: String(menuId),
      dataScope,
      status: "running",
      progress: {
        phase: "checking",
        processedItems: 0,
        totalItems: rows.length,
        message: "Starting store item matching..."
      },
      createdAt: Date.now()
    };
    jobStore.set(job);

    void qfcService.previewQfcCart(dataScope, rows, (progress) => {
      job.progress = progress;
    })
      .then((result) => {
        job.status = "complete";
        job.result = result;
        job.progress = {
          phase: "complete",
          processedItems: rows.length,
          totalItems: rows.length,
          message: result.message
        };
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Store item matching failed.";
        job.progress = {
          phase: "complete",
          processedItems: rows.length,
          totalItems: rows.length,
          message: job.error
        };
      });

    return job;
  }

  function selectStoreItem(
    jobId: string,
    dataScope: DataScope,
    shoppingItemId: number,
    productId: string,
    upc: string,
    rememberPreference: boolean
  ) {
    const previewJob = requirePreviewJob(jobId, dataScope);
    const match = previewJob.result.matched?.find((candidate) => candidate.item.id === shoppingItemId);
    if (!match) {
      throw new QfcWorkflowError(404, "The ingredient was not found in this store item review.");
    }
    const storeItem = match.candidates.find((candidate) =>
      candidate.productId === productId && candidate.upc === upc
    );
    if (!storeItem) {
      throw new QfcWorkflowError(400, "Choose a store item from the current review results.");
    }

    const ingredientName = match.item.item.trim() || match.item.text.trim();
    match.storeItem = storeItem;
    match.selectionSource = rememberPreference ? "remembered" : "review";
    const preference = rememberPreference
      ? qfcService.saveStoreItemPreference(
          previewJob.dataScope,
          "kroger",
          ingredientName,
          storeItem
        )
      : null;
    return { match, preference };
  }

  function updateQuantity(
    jobId: string,
    dataScope: DataScope,
    shoppingItemId: number,
    cartQuantity: number
  ) {
    const previewJob = requirePreviewJob(jobId, dataScope);
    const match = previewJob.result.matched?.find((candidate) => candidate.item.id === shoppingItemId);
    if (!match) {
      throw new QfcWorkflowError(404, "The ingredient was not found in this store item review.");
    }
    if (!Number.isSafeInteger(cartQuantity) || cartQuantity < 1) {
      throw new QfcWorkflowError(400, "Cart quantity must be a positive whole number.");
    }
    match.cartQuantity = cartQuantity;
    return { match };
  }

  async function searchReviewItems(
    jobId: string,
    dataScope: DataScope,
    shoppingItemId: number,
    term: string
  ) {
    const previewJob = requirePreviewJob(jobId, dataScope);
    const matches = previewJob.result.matched ?? [];
    const skipped = previewJob.result.skipped ?? [];
    let match = matches.find((candidate) => candidate.item.id === shoppingItemId);
    let skip = skipped.find((candidate) => candidate.item.id === shoppingItemId);
    let restoredItem = null;
    if (!match && !skip) {
      restoredItem = plannerRepository.getShoppingListItems(
        Number(previewJob.menuId),
        previewJob.dataScope
      ).find((candidate) => candidate.id === shoppingItemId && candidate.approved);
      if (!restoredItem) {
        throw new QfcWorkflowError(404, "The ingredient was not found in this store item review.");
      }
      skip = { item: restoredItem, reason: "No store item has been selected." };
    }
    if (!term.trim()) {
      throw new QfcWorkflowError(400, "Enter a search term to find store items.");
    }

    const results = await qfcService.searchStoreItems(term.trim(), {
      limit: 20,
      dataScope: previewJob.dataScope
    });
    const candidateKeys = new Set<string>();
    const candidates = results.filter((candidate) => {
      const key = `${candidate.productId}\u0000${candidate.upc}`;
      if (candidateKeys.has(key)) return false;
      candidateKeys.add(key);
      return true;
    });

    if (restoredItem) {
      previewJob.result.items = [...previewJob.result.items, restoredItem]
        .sort((left, right) => left.id - right.id);
    }
    if (candidates.length) {
      if (match) {
        match.candidates = candidates;
        match.storeItem = candidates[0];
        match.selectionSource = "search";
      } else if (skip) {
        match = {
          item: skip.item,
          storeItem: candidates[0],
          candidates,
          selectionSource: "search",
          cartQuantity: 1
        };
        previewJob.result.matched = [...matches, match].sort((left, right) => left.item.id - right.item.id);
        previewJob.result.skipped = skipped.filter((candidate) => candidate.item.id !== shoppingItemId);
      }
    } else if (restoredItem && skip) {
      skip.reason = `No store items found for "${term.trim()}".`;
      previewJob.result.skipped = [...skipped, skip].sort((left, right) => left.item.id - right.item.id);
    }

    return {
      match: match ?? null,
      items: previewJob.result.items,
      matched: previewJob.result.matched ?? matches,
      skipped: previewJob.result.skipped ?? skipped,
      resultCount: candidates.length
    };
  }

  function removeReviewItem(
    jobId: string,
    dataScope: DataScope,
    shoppingItemId: number
  ) {
    const previewJob = requirePreviewJob(jobId, dataScope);
    const reviewItem = previewJob.result.items.find((item) => item.id === shoppingItemId);
    if (!reviewItem) {
      throw new QfcWorkflowError(404, "The ingredient was not found in this store item review.");
    }
    previewJob.result.items = previewJob.result.items.filter((item) => item.id !== shoppingItemId);
    previewJob.result.matched = (previewJob.result.matched ?? [])
      .filter((match) => match.item.id !== shoppingItemId);
    previewJob.result.skipped = (previewJob.result.skipped ?? [])
      .filter((skip) => skip.item.id !== shoppingItemId);
    return {
      removedItem: reviewItem,
      items: previewJob.result.items,
      matched: previewJob.result.matched,
      skipped: previewJob.result.skipped
    };
  }

  function startAddToCart(jobId: string, dataScope: DataScope) {
    const previewJob = requirePreviewJob(jobId, dataScope);
    if (qfcService.getScopedSetting(previewJob.dataScope, "allowRealQfcCartMutation") !== "true") {
      throw new QfcWorkflowError(
        403,
        "Real QFC cart changes are disabled in this data mode. Enable them explicitly in QFC preferences."
      );
    }

    const job: QfcSubmitJob = {
      id: randomUUID(),
      kind: "add",
      menuId: previewJob.menuId,
      dataScope: previewJob.dataScope,
      status: "running",
      progress: {
        phase: "adding",
        processedItems: previewJob.result.items.length,
        totalItems: previewJob.result.items.length,
        message: "Adding reviewed store items to your QFC cart..."
      },
      createdAt: Date.now()
    };
    jobStore.set(job);

    void qfcService.addQfcMatchesToCart(
      previewJob.result.items,
      previewJob.result.matched ?? [],
      previewJob.result.skipped ?? [],
      (progress) => {
        job.progress = progress;
      }
    )
      .then((result) => {
        if (result.submittedItemCount > 0) {
          qfcRepository.markMenuSubmitted(Number(job.menuId), job.dataScope);
        }
        job.status = "complete";
        job.result = result;
        job.progress = {
          phase: "complete",
          processedItems: result.items.length,
          totalItems: result.items.length,
          message: result.message
        };
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "QFC cart submission failed.";
        job.progress = {
          phase: "complete",
          processedItems: previewJob.result?.items.length ?? 0,
          totalItems: previewJob.result?.items.length ?? 0,
          message: job.error
        };
      });

    return job;
  }

  function getJob(jobId: string, dataScope: DataScope) {
    jobStore.prune();
    const job = jobStore.getScoped(jobId, dataScope);
    if (!job) {
      throw new QfcWorkflowError(404, "QFC submission job was not found.");
    }
    return job;
  }

  return {
    getJob,
    removeReviewItem,
    searchReviewItems,
    selectStoreItem,
    startAddToCart,
    startPreview,
    updateQuantity
  };
}
