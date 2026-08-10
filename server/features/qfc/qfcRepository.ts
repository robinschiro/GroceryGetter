import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { DataScope } from "../../types.js";
import type { QfcSubmitJob } from "./qfcJobStore.js";

type PersistedReviewRow = {
  menuId: number;
  dataScope: DataScope;
  jobId: string;
  reviewRevision: number;
  resultJson: string;
  createdAt: number;
};

type CompletePreviewJob = QfcSubmitJob & {
  kind: "preview";
  status: "complete";
  result: NonNullable<QfcSubmitJob["result"]>;
  reviewRevision: number;
};

export function createQfcRepository(database: GroceryDatabase) {
  function deserializeReview(row: PersistedReviewRow | null): CompletePreviewJob | null {
    if (!row) return null;
    try {
      const result = JSON.parse(row.resultJson) as NonNullable<QfcSubmitJob["result"]>;
      return {
        id: row.jobId,
        kind: "preview",
        menuId: String(row.menuId),
        dataScope: row.dataScope,
        status: "complete",
        progress: {
          phase: "complete",
          processedItems: result.items.length,
          totalItems: result.items.length,
          message: result.message
        },
        result,
        createdAt: row.createdAt,
        reviewRevision: row.reviewRevision
      };
    } catch {
      return null;
    }
  }

  function beginReview(menuId: number, dataScope: DataScope) {
    return database.transaction(() => {
      database.run(
        `UPDATE menus
        SET qfc_review_revision = qfc_review_revision + 1
        WHERE id = ? AND data_scope = ?`,
        [menuId, dataScope]
      );
      database.run("DELETE FROM store_item_reviews WHERE menu_id = ?", [menuId]);
      return database.queryOne<{ reviewRevision: number }>(
        `SELECT qfc_review_revision AS reviewRevision
        FROM menus WHERE id = ? AND data_scope = ?`,
        [menuId, dataScope]
      )?.reviewRevision ?? 0;
    });
  }

  function saveReview(job: CompletePreviewJob) {
    const reviewRevision = job.reviewRevision;
    if (!Number.isInteger(reviewRevision)) return false;
    const currentRevision = database.queryOne<{ reviewRevision: number }>(
      `SELECT qfc_review_revision AS reviewRevision
      FROM menus WHERE id = ? AND data_scope = ?`,
      [Number(job.menuId), job.dataScope]
    )?.reviewRevision;
    if (currentRevision !== reviewRevision) return false;

    database.run(
      `INSERT INTO store_item_reviews
        (menu_id, data_scope, job_id, review_revision, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(menu_id) DO UPDATE SET
        data_scope = excluded.data_scope,
        job_id = excluded.job_id,
        review_revision = excluded.review_revision,
        result_json = excluded.result_json,
        created_at = excluded.created_at,
        updated_at = CURRENT_TIMESTAMP
      WHERE excluded.review_revision = store_item_reviews.review_revision`,
      [
        Number(job.menuId),
        job.dataScope,
        job.id,
        reviewRevision,
        JSON.stringify(job.result),
        job.createdAt
      ]
    );
    database.save();
    return getReviewByJobId(job.id, job.dataScope)?.reviewRevision === reviewRevision;
  }

  function getReviewByJobId(jobId: string, dataScope: DataScope) {
    return deserializeReview(database.queryOne<PersistedReviewRow>(
      `SELECT menu_id AS menuId, data_scope AS dataScope, job_id AS jobId,
        review_revision AS reviewRevision,
        result_json AS resultJson, created_at AS createdAt
      FROM store_item_reviews
      WHERE job_id = ? AND data_scope = ?`,
      [jobId, dataScope]
    ));
  }

  function getReviewByMenuId(menuId: number, dataScope: DataScope) {
    return deserializeReview(database.queryOne<PersistedReviewRow>(
      `SELECT store_item_reviews.menu_id AS menuId,
        store_item_reviews.data_scope AS dataScope,
        store_item_reviews.job_id AS jobId,
        store_item_reviews.review_revision AS reviewRevision,
        store_item_reviews.result_json AS resultJson,
        store_item_reviews.created_at AS createdAt
      FROM store_item_reviews
      JOIN menus ON menus.id = store_item_reviews.menu_id
      WHERE store_item_reviews.menu_id = ?
        AND store_item_reviews.data_scope = ?
        AND menus.data_scope = ?`,
      [menuId, dataScope, dataScope]
    ));
  }

  function clearReviews(dataScope: DataScope) {
    database.transaction(() => {
      database.run(
        `UPDATE menus SET qfc_review_revision = qfc_review_revision + 1
        WHERE data_scope = ?`,
        [dataScope]
      );
      database.run("DELETE FROM store_item_reviews WHERE data_scope = ?", [dataScope]);
    });
  }

  function getScopedSettings(dataScope: DataScope) {
    const settings = database.queryAll<{ key: string; value: string }>(
      "SELECT key, value FROM scoped_settings WHERE data_scope = ? ORDER BY key",
      [dataScope]
    );
    return Object.fromEntries(settings.map(({ key, value }) => [key, value]));
  }

  function markMenuSubmitted(menuId: number, dataScope: DataScope) {
    database.run(
      `UPDATE menus SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND data_scope = ?`,
      [menuId, dataScope]
    );
    database.save();
  }

  return {
    beginReview,
    clearReviews,
    getReviewByJobId,
    getReviewByMenuId,
    getScopedSettings,
    markMenuSubmitted,
    saveReview
  };
}
