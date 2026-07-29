import { useState, type Dispatch, type SetStateAction } from "react";
import type {
  QfcStatus,
  QfcSubmitProgress,
  ShoppingListItem,
  StoreItemPreference
} from "../../../shared/contracts/index.js";
import { updateShoppingListApproval } from "../planner/api.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import {
  deleteStoreItemPreference as deleteStoreItemPreferenceRequest,
  getQfcSubmitJob,
  loadQfcSettings,
  removeStoreItemFromReview as removeStoreItemFromReviewRequest,
  searchStoreItemsForReview as searchStoreItemsForReviewRequest,
  selectStoreItem as selectStoreItemRequest,
  startAddToCart,
  startStoreItemPreview,
  updateScopedSetting,
  updateStoreItemQuantity as updateStoreItemQuantityRequest
} from "./api.js";
import type { StoreItemReview } from "./StoreItemReviewPanel.js";

const qfcCartUrl = "https://www.qfc.com/cart";
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function useQfc({
  api,
  menuId,
  shoppingList,
  setShoppingList,
  dirtyShoppingItemIds,
  sourceMetadataDirtyItemIds,
  saveDirtyShoppingItems,
  loadMenu,
  setPlannerMessage
}: {
  api: ApiRequest;
  menuId: number | null;
  shoppingList: ShoppingListItem[];
  setShoppingList: Dispatch<SetStateAction<ShoppingListItem[]>>;
  dirtyShoppingItemIds: Set<number>;
  sourceMetadataDirtyItemIds: Set<number>;
  saveDirtyShoppingItems: () => Promise<void>;
  loadMenu: (id: number) => Promise<void>;
  setPlannerMessage: Dispatch<SetStateAction<string>>;
}) {
  const [savingApprovalItemIds, setSavingApprovalItemIds] = useState<Set<number>>(() => new Set());
  const [searchingStoreItemIds, setSearchingStoreItemIds] = useState<Set<number>>(() => new Set());
  const [preferStoreBrands, setPreferStoreBrands] = useState(true);
  const [allowRealQfcCartMutation, setAllowRealQfcCartMutation] = useState(true);
  const [qfcStatus, setQfcStatus] = useState<QfcStatus | null>(null);
  const [qfcSubmitProgress, setQfcSubmitProgress] = useState<QfcSubmitProgress | null>(null);
  const [storeItemReview, setStoreItemReview] = useState<StoreItemReview | null>(null);
  const [storeItemReviewMessage, setStoreItemReviewMessage] = useState("");
  const [storeItemPreferences, setStoreItemPreferences] = useState<StoreItemPreference[]>([]);

  function invalidateStoreReview() {
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
  }

  function reset() {
    invalidateStoreReview();
    setQfcSubmitProgress(null);
  }

  async function loadSettings() {
    const { settings, preferences, status } = await loadQfcSettings(api);
    setPreferStoreBrands(settings.preferStoreBrands === "true");
    setAllowRealQfcCartMutation(settings.allowRealQfcCartMutation === "true");
    setStoreItemPreferences(preferences);
    setQfcStatus(status);
  }

  async function updateShoppingItemApproval(itemId: number, approved: boolean) {
    if (!menuId || savingApprovalItemIds.has(itemId)) return;
    const previousItem = shoppingList.find((item) => item.id === itemId);
    if (!previousItem) return;
    const currentReview = storeItemReview;

    setPlannerMessage("");
    setStoreItemReviewMessage("");
    setShoppingList((current) => current.map((item) => (
      item.id === itemId ? { ...item, approved: approved ? 1 : 0 } : item
    )));
    setSavingApprovalItemIds((current) => new Set(current).add(itemId));
    if (approved && currentReview) {
      setSearchingStoreItemIds((current) => new Set(current).add(itemId));
    }

    try {
      await updateShoppingListApproval(api, menuId, itemId, approved);

      if (
        !approved
        && currentReview
        && currentReview.result.items.some((reviewItem) => reviewItem.id === itemId)
      ) {
        try {
          const result = await removeStoreItemFromReviewRequest(api, currentReview.jobId, itemId);
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? {
            ...review,
            result: {
              ...review.result,
              items: result.items,
              matched: result.matched,
              skipped: result.skipped
            }
          } : review);
        } catch (err) {
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? null : review);
          setStoreItemReviewMessage(
            err instanceof Error
              ? `The ingredient was removed, but the store item review could not be updated: ${err.message}`
              : "The ingredient was removed, but the store item review could not be updated. Preview store items again."
          );
        }
      }

      if (approved && currentReview) {
        try {
          const result = await searchStoreItemsForReviewRequest(
            api,
            currentReview.jobId,
            itemId,
            previousItem.item || previousItem.text
          );
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? {
            ...review,
            result: {
              ...review.result,
              items: result.items,
              matched: result.matched,
              skipped: result.skipped
            }
          } : review);
          setStoreItemReviewMessage(
            result.match
              ? `Added ${previousItem.item || previousItem.text} back to the store item review.`
              : `Added ${previousItem.item || previousItem.text} back to the review, but no store items were found.`
          );
        } catch (err) {
          setStoreItemReviewMessage(
            err instanceof Error
              ? `The ingredient was re-added, but its store item search failed: ${err.message}`
              : "The ingredient was re-added, but its store item search failed."
          );
        }
      }
    } catch (err) {
      setShoppingList((current) => current.map((item) => (
        item.id === itemId ? { ...item, approved: previousItem.approved } : item
      )));
      setPlannerMessage(err instanceof Error ? err.message : "Unable to save ingredient approval.");
    } finally {
      setSavingApprovalItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      setSearchingStoreItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function previewStoreItems() {
    if (!menuId) return;
    setPlannerMessage("");

    if (sourceMetadataDirtyItemIds.size) {
      setPlannerMessage("Save eligible source changes before matching store items.");
      return;
    }

    if (dirtyShoppingItemIds.size) {
      const shouldSave = window.confirm("You have unsaved ingredient changes. Save them before matching store items?");
      if (!shouldSave) {
        setPlannerMessage("Store item matching canceled. Save or discard ingredient changes first.");
        return;
      }

      try {
        setPlannerMessage("Saving ingredient changes...");
        await saveDirtyShoppingItems();
      } catch (err) {
        setPlannerMessage(err instanceof Error ? err.message : "Unable to save ingredient changes.");
        return;
      }
    }

    setPlannerMessage("");
    setQfcSubmitProgress({
      phase: "checking",
      processedItems: 0,
      totalItems: shoppingList.filter((item) => item.approved).length,
      message: "Starting store item matching..."
    });

    try {
      invalidateStoreReview();
      const started = await startStoreItemPreview(api, menuId);
      setQfcSubmitProgress(started.progress);

      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await getQfcSubmitJob(api, started.id);
        setQfcSubmitProgress(job.progress);
      }

      if (job.status === "failed") {
        throw new Error(job.error ?? "Store item matching failed.");
      }

      setPlannerMessage(job.result?.message ?? job.progress.message);
      if (job.result) {
        setStoreItemReview({ jobId: started.id, result: job.result });
      }
    } catch (err) {
      setPlannerMessage(err instanceof Error ? err.message : "Store item matching failed.");
    } finally {
      setQfcSubmitProgress(null);
    }
  }

  async function addReviewedStoreItemsToQfc() {
    if (!storeItemReview || !menuId) return;
    setPlannerMessage("");
    setStoreItemReviewMessage("");
    setQfcSubmitProgress({
      phase: "adding",
      processedItems: storeItemReview.result.items.length,
      totalItems: storeItemReview.result.items.length,
      message: "Adding reviewed store items to your QFC cart..."
    });

    try {
      const started = await startAddToCart(api, storeItemReview.jobId);
      setQfcSubmitProgress(started.progress);
      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await getQfcSubmitJob(api, started.id);
        setQfcSubmitProgress(job.progress);
      }
      if (job.status === "failed") {
        throw new Error(job.error ?? "QFC cart submission failed.");
      }
      const confirmation = job.result?.message ?? job.progress.message;
      setPlannerMessage(confirmation);
      setStoreItemReviewMessage(confirmation);
      await loadMenu(menuId);
    } catch (err) {
      setPlannerMessage(err instanceof Error ? err.message : "QFC cart submission failed.");
    } finally {
      setQfcSubmitProgress(null);
    }
  }

  function openQfcCart() {
    window.open(qfcCartUrl, "_blank", "noopener,noreferrer");
  }

  async function updateStoreBrandPreference(next: boolean) {
    setPreferStoreBrands(next);
    setStoreItemReview(null);
    await updateScopedSetting(api, "preferStoreBrands", next);
  }

  async function updateRealQfcCartPermission(next: boolean) {
    setAllowRealQfcCartMutation(next);
    await updateScopedSetting(api, "allowRealQfcCartMutation", next);
  }

  async function selectStoreItem(shoppingItemId: number, productId: string, upc: string) {
    if (!storeItemReview) return;
    setStoreItemReviewMessage("");
    try {
      const result = await selectStoreItemRequest(
        api,
        storeItemReview.jobId,
        shoppingItemId,
        productId,
        upc
      );
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          matched: current.result.matched?.map((match) =>
            match.item.id === shoppingItemId ? result.match : match
          )
        }
      } : current);
      setStoreItemPreferences((current) => [
        ...current.filter((preference) =>
          preference.provider !== result.preference.provider
          || preference.ingredientKey !== result.preference.ingredientKey
        ),
        result.preference
      ].sort((left, right) => left.ingredientName.localeCompare(right.ingredientName)));
      setStoreItemReviewMessage(`Remembered ${result.preference.description} for ${result.preference.ingredientName}.`);
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to remember the store item selection.");
    }
  }

  async function updateStoreItemQuantity(shoppingItemId: number, cartQuantity: number) {
    if (!storeItemReview) return;
    setStoreItemReviewMessage("");
    try {
      const result = await updateStoreItemQuantityRequest(
        api,
        storeItemReview.jobId,
        shoppingItemId,
        cartQuantity
      );
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          matched: current.result.matched?.map((match) =>
            match.item.id === shoppingItemId ? result.match : match
          )
        }
      } : current);
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to update the cart quantity.");
      throw err;
    }
  }

  async function searchStoreItemsForReview(shoppingItemId: number, term: string) {
    if (!storeItemReview) {
      throw new Error("Preview store items before searching for more choices.");
    }

    const result = await searchStoreItemsForReviewRequest(
      api,
      storeItemReview.jobId,
      shoppingItemId,
      term
    );
    setStoreItemReview((current) => current ? {
      ...current,
      result: {
        ...current.result,
        items: result.items,
        matched: result.matched,
        skipped: result.skipped
      }
    } : current);
    return result;
  }

  async function removeStoreItemFromReview(item: ShoppingListItem) {
    if (!storeItemReview) {
      setStoreItemReviewMessage("Preview store items before removing an ingredient.");
      return false;
    }

    setStoreItemReviewMessage("");
    try {
      const result = await removeStoreItemFromReviewRequest(api, storeItemReview.jobId, item.id);
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          items: result.items,
          matched: result.matched,
          skipped: result.skipped
        }
      } : current);
      setStoreItemReviewMessage(`Removed ${item.item || item.text} from this review.`);
      return true;
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to remove the ingredient from this review.");
      return false;
    }
  }

  async function forgetStoreItemPreference(provider: string, ingredientKey: string) {
    await deleteStoreItemPreferenceRequest(api, provider, ingredientKey);
    setStoreItemPreferences((current) => current.filter((preference) =>
      preference.provider !== provider || preference.ingredientKey !== ingredientKey
    ));
    setStoreItemReview(null);
  }

  return {
    addReviewedStoreItemsToQfc,
    allowRealQfcCartMutation,
    forgetStoreItemPreference,
    invalidateStoreReview,
    loadSettings,
    openQfcCart,
    preferStoreBrands,
    previewStoreItems,
    qfcStatus,
    qfcSubmitProgress,
    removeStoreItemFromReview,
    reset,
    savingApprovalItemIds,
    searchingStoreItemIds,
    searchStoreItemsForReview,
    selectStoreItem,
    storeItemPreferences,
    storeItemReview,
    storeItemReviewMessage,
    updateRealQfcCartPermission,
    updateShoppingItemApproval,
    updateStoreBrandPreference,
    updateStoreItemQuantity
  };
}
