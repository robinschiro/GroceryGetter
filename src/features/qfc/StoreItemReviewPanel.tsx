import React, { useEffect, useState } from "react";
import {
  BookmarkPlus,
  ChevronRight,
  ExternalLink,
  Info,
  LoaderCircle,
  Minus,
  Package,
  Plus,
  Search,
  Send,
  Trash2
} from "lucide-react";
import type {
  QfcCartSkip,
  QfcSubmitJob,
  QfcSubmitProgress,
  ShoppingListItem,
  ShoppingListSourceTarget,
  StoreItemCandidate,
  StoreItemMatch
} from "../../../shared/contracts/index.js";
import { recipeEditRoute, shoppingListEditRoute } from "../../shared/router.js";
import { QfcSubmitProgressBar } from "../../shared/QfcSubmitProgressBar.js";
import type { StoreItemReviewSearchResult } from "./api.js";

export type StoreItemReview = {
  jobId: string;
  result: NonNullable<QfcSubmitJob["result"]>;
};

function formatPrice(candidate: StoreItemCandidate) {
  if (candidate.promotionalPrice !== null) {
    const promotional = `$${candidate.promotionalPrice.toFixed(2)} promo`;
    return candidate.regularPrice !== null && candidate.regularPrice !== candidate.promotionalPrice
      ? `${promotional} (reg. $${candidate.regularPrice.toFixed(2)})`
      : promotional;
  }

  return candidate.regularPrice === null ? "Price unavailable" : `$${candidate.regularPrice.toFixed(2)}`;
}

function formatAvailability(stockLevel: string) {
  switch (stockLevel) {
    case "HIGH":
      return "In stock";
    case "LOW":
      return "Low stock";
    case "TEMPORARILY_OUT_OF_STOCK":
      return "Out of stock";
    default:
      return "Availability unavailable";
  }
}

function formatCandidateOption(candidate: StoreItemCandidate) {
  const product = [candidate.description, candidate.brand, candidate.size].filter(Boolean).join(" — ");
  return `${product} · ${formatPrice(candidate)} · ${formatAvailability(candidate.stockLevel)}`;
}

export function StoreItemReviewPanel({
  review,
  allowRealQfcCartMutation,
  addToCart,
  selectStoreItem,
  updateCartQuantity,
  searchStoreItems,
  removeStoreItem,
  openSource,
  openQfcCart,
  qfcSubmitProgress,
  message
}: {
  review: StoreItemReview | null;
  allowRealQfcCartMutation: boolean;
  addToCart: () => Promise<void>;
  selectStoreItem: (shoppingItemId: number, productId: string, upc: string) => Promise<void>;
  updateCartQuantity: (shoppingItemId: number, cartQuantity: number) => Promise<void>;
  searchStoreItems: (
    shoppingItemId: number,
    term: string
  ) => Promise<{
    match: StoreItemMatch | null;
    matched: StoreItemMatch[];
    skipped: QfcCartSkip[];
    resultCount: number;
  }>;
  removeStoreItem: (item: ShoppingListItem) => Promise<boolean>;
  openSource: (source: ShoppingListSourceTarget) => void;
  openQfcCart: () => void;
  qfcSubmitProgress: QfcSubmitProgress | null;
  message: string;
}) {
  const [selectingItemId, setSelectingItemId] = useState<number | null>(null);
  const [updatingQuantityItemId, setUpdatingQuantityItemId] = useState<number | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  const [quantityDetailsOpen, setQuantityDetailsOpen] = useState<Record<number, boolean>>({});
  const [findingItemId, setFindingItemId] = useState<number | null>(null);
  const [searchingItemId, setSearchingItemId] = useState<number | null>(null);
  const [removingItemId, setRemovingItemId] = useState<number | null>(null);
  const [customSearchTerm, setCustomSearchTerm] = useState("");
  const [customSearchFeedback, setCustomSearchFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const matches = review?.result.matched ?? [];
  const skipped = review?.result.skipped ?? [];

  useEffect(() => {
    setFindingItemId(null);
    setUpdatingQuantityItemId(null);
    setQuantityDrafts({});
    setQuantityDetailsOpen({});
    setSearchingItemId(null);
    setRemovingItemId(null);
    setCustomSearchTerm("");
    setCustomSearchFeedback(null);
  }, [review?.jobId]);

  async function updateSelection(match: StoreItemMatch, selection: string) {
    const [productId, upc] = JSON.parse(selection) as [string, string];
    await rememberSelection(match, productId, upc);
  }

  async function rememberSelection(match: StoreItemMatch, productId: string, upc: string) {
    setSelectingItemId(match.item.id);
    try {
      await selectStoreItem(match.item.id, productId, upc);
    } finally {
      setSelectingItemId(null);
    }
  }

  async function updateQuantity(match: StoreItemMatch, value: string) {
    setQuantityDrafts((current) => ({ ...current, [match.item.id]: value }));
    const cartQuantity = Number(value);
    if (!Number.isInteger(cartQuantity) || cartQuantity < 1 || cartQuantity === match.cartQuantity) return;
    setUpdatingQuantityItemId(match.item.id);
    try {
      await updateCartQuantity(match.item.id, cartQuantity);
      setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(cartQuantity) }));
    } catch {
      setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(match.cartQuantity) }));
    } finally {
      setUpdatingQuantityItemId(null);
    }
  }

  function restoreQuantityIfInvalid(match: StoreItemMatch) {
    const draft = quantityDrafts[match.item.id];
    const cartQuantity = Number(draft);
    if (draft === undefined || (Number.isInteger(cartQuantity) && cartQuantity >= 1)) return;
    setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(match.cartQuantity) }));
  }

  function adjustedQuantity(match: StoreItemMatch, change: number) {
    const draftQuantity = Number(quantityDrafts[match.item.id]);
    const currentQuantity = Number.isInteger(draftQuantity) && draftQuantity >= 1
      ? draftQuantity
      : match.cartQuantity;
    return Math.max(1, currentQuantity + change);
  }

  function renderQuantityDetails(match: StoreItemMatch) {
    const itemName = match.item.item || match.item.text;
    const detailsId = `store-item-quantity-details-${match.item.id}`;
    const isOpen = Boolean(quantityDetailsOpen[match.item.id]);

    return (
      <>
        <button
          className="secondary icon-button store-item-quantity-info-button"
          type="button"
          aria-label={`${isOpen ? "Hide" : "Show"} quantity sources for ${itemName}`}
          aria-expanded={isOpen}
          aria-controls={detailsId}
          title={`${isOpen ? "Hide" : "Show"} recipe and list quantities`}
          onClick={() => setQuantityDetailsOpen((current) => ({
            ...current,
            [match.item.id]: !current[match.item.id]
          }))}
        >
          <Info size={18} aria-hidden="true" />
        </button>
        {isOpen ? (
          <div
            className="store-item-quantity-details"
            id={detailsId}
            role="region"
            aria-label={`Quantity sources for ${itemName}`}
          >
            <span className="eyebrow">Recipe and list quantities</span>
            {match.item.sourceDetails.map((source, index) => (
              <div
                className="store-item-quantity-detail"
                key={`${source.type}-${source.id}-${index}`}
              >
                <span>{source.name}</span>
                <strong>
                  {[source.quantity, source.unit].filter(Boolean).join(" ")
                    || "Quantity not specified"}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  async function removeReviewItem(item: ShoppingListItem) {
    setRemovingItemId(item.id);
    try {
      const removed = await removeStoreItem(item);
      if (removed && findingItemId === item.id) {
        setFindingItemId(null);
        setCustomSearchTerm("");
        setCustomSearchFeedback(null);
      }
    } finally {
      setRemovingItemId(null);
    }
  }

  function renderRemoveButton(item: ShoppingListItem) {
    const itemName = item.item || item.text;

    return (
      <button
        className="icon-button danger store-item-remove-button"
        type="button"
        aria-label={`Remove ${itemName} from review`}
        aria-busy={removingItemId === item.id}
        disabled={removingItemId === item.id}
        onClick={() => void removeReviewItem(item)}
      >
        <Trash2 size={16} />
      </button>
    );
  }

  function renderSourceLinks(item: ShoppingListItem) {
    if (!item.sourceTargets?.length) {
      return <span>{item.sourceNames}</span>;
    }

    return (
      <span className="shopping-source-links">
        {item.sourceTargets.map((source, index) => (
          <React.Fragment key={`${source.type}-${source.id}`}>
            {index ? ", " : null}
            <a
              href={source.type === "ourGroceries"
                ? source.webUrl
                : source.type === "recipe"
                  ? recipeEditRoute(source.id).path
                  : shoppingListEditRoute(source.id).path}
              target={source.type === "ourGroceries" ? "_blank" : undefined}
              rel={source.type === "ourGroceries" ? "noopener noreferrer" : undefined}
              aria-label={source.type === "ourGroceries" ? `Open ${source.name} in OurGroceries` : undefined}
              onClick={(event) => {
                if (
                  source.type !== "ourGroceries"
                  &&
                  event.button === 0
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && !event.shiftKey
                ) {
                  event.preventDefault();
                  openSource(source);
                }
              }}
            >
              {source.name}
            </a>
          </React.Fragment>
        ))}
      </span>
    );
  }

  function showCustomSearch(item: ShoppingListItem) {
    setFindingItemId(item.id);
    setCustomSearchTerm(item.item || item.text);
    setCustomSearchFeedback(null);
  }

  async function runCustomSearch(event: React.FormEvent, item: ShoppingListItem) {
    event.preventDefault();
    const term = customSearchTerm.trim();
    if (!term) {
      setCustomSearchFeedback({ type: "error", text: "Enter a search term." });
      return;
    }

    const wasUnmatched = skipped.some((skip) => skip.item.id === item.id);
    setSearchingItemId(item.id);
    setCustomSearchFeedback(null);
    try {
      const result = await searchStoreItems(item.id, term);
      if (!result.resultCount) {
        setCustomSearchFeedback({ type: "error", text: `No store items found for “${term}”.` });
      } else {
        setCustomSearchFeedback({
          type: "success",
          text: wasUnmatched
            ? `${result.resultCount} store item${result.resultCount === 1 ? "" : "s"} found. The ingredient is now matched.`
            : `Dropdown replaced with ${result.resultCount} store item${result.resultCount === 1 ? "" : "s"}.`
        });
      }
    } catch (err) {
      setCustomSearchFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to search store items."
      });
    } finally {
      setSearchingItemId(null);
    }
  }

  function renderFindItemControl(item: ShoppingListItem) {
    if (findingItemId !== item.id) {
      return (
        <button
          className="secondary store-item-find-button"
          type="button"
          onClick={() => showCustomSearch(item)}
        >
          <Search size={16} />
          Find item
        </button>
      );
    }

    return (
      <form className="store-item-custom-search" onSubmit={(event) => void runCustomSearch(event, item)}>
        <label>
          <span className="eyebrow">Custom store item search</span>
          <input
            value={customSearchTerm}
            onChange={(event) => setCustomSearchTerm(event.target.value)}
            placeholder="Enter a different search term"
            autoFocus
          />
        </label>
        <div className="store-item-custom-search-actions">
          <button
            type="submit"
            aria-busy={searchingItemId === item.id}
            disabled={!customSearchTerm.trim() || searchingItemId === item.id}
          >
            <Search size={16} />
            {searchingItemId === item.id ? "Searching..." : "Search"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setFindingItemId(null);
              setCustomSearchFeedback(null);
            }}
          >
            Cancel
          </button>
        </div>
        {customSearchFeedback ? (
          <span
            className={`store-item-search-feedback ${customSearchFeedback.type}`}
            role="status"
          >
            {customSearchFeedback.text}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Send size={18} />
        <h3>Store Item Review</h3>
      </div>

      {review ? (
        <>
          {matches.length ? (
            <div className="store-item-match-list">
              {matches.map((match) => (
                <div className="store-item-match-row" key={match.item.id}>
                  <div className="store-item-match-ingredient">
                    <span className="eyebrow">Aggregated ingredient</span>
                    <strong>{match.item.text || [match.item.quantity, match.item.unit, match.item.item].filter(Boolean).join(" ")}</strong>
                    {renderSourceLinks(match.item)}
                  </div>
                  <ChevronRight className="store-item-match-arrow" size={22} aria-hidden="true" />
                  <div className="store-item-match-selection">
                    <span className="eyebrow">
                      {match.selectionSource === "remembered"
                        ? "Remembered store item"
                        : match.selectionSource === "search"
                          ? "Selected from custom search"
                          : match.selectionSource === "preferred-unavailable"
                            ? "Available search result"
                            : match.selectionSource === "review"
                              ? "Selected for this review"
                              : "Selected by general preferences"}
                    </span>
                    {match.selectionSource === "preferred-unavailable" ? (
                      <span className="store-item-fallback-note">
                        Your preferred item is out of stock, so an available search result is selected for this review.
                      </span>
                    ) : null}
                    <select
                      aria-label={`Store item for ${match.item.item || match.item.text}`}
                      disabled={selectingItemId === match.item.id}
                      value={JSON.stringify([match.storeItem.productId, match.storeItem.upc])}
                      onChange={(event) => void updateSelection(match, event.target.value)}
                    >
                      {match.candidates.map((candidate) => (
                        <option
                          key={`${candidate.productId}-${candidate.upc}`}
                          value={JSON.stringify([candidate.productId, candidate.upc])}
                        >
                          {formatCandidateOption(candidate)}
                        </option>
                      ))}
                    </select>
                    <div className="store-item-selection-actions">
                      {renderFindItemControl(match.item)}
                      {findingItemId !== match.item.id ? (
                        <button
                          className="secondary icon-button store-item-remember-button"
                          type="button"
                          aria-label={`Remember selected store item for ${match.item.item || match.item.text}`}
                          title={
                            match.selectionSource === "remembered"
                              ? "This store item is already remembered"
                              : "Remember the selected store item"
                          }
                          aria-busy={selectingItemId === match.item.id}
                          disabled={
                            selectingItemId === match.item.id
                            || match.selectionSource === "remembered"
                          }
                          onClick={() => void rememberSelection(
                            match,
                            match.storeItem.productId,
                            match.storeItem.upc
                          )}
                        >
                          <BookmarkPlus size={17} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    <div className="store-item-quantity">
                      <span className="eyebrow">Cart quantity</span>
                      <div className="store-item-quantity-controls">
                        <div className="store-item-number-control">
                          <button
                            type="button"
                            aria-label={`Decrease cart quantity for ${match.storeItem.description}`}
                            aria-busy={updatingQuantityItemId === match.item.id}
                            disabled={updatingQuantityItemId === match.item.id || adjustedQuantity(match, 0) <= 1}
                            onClick={() => void updateQuantity(match, String(adjustedQuantity(match, -1)))}
                          >
                            <Minus size={18} />
                          </button>
                          <input
                            aria-label={`Cart quantity for ${match.storeItem.description}`}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={quantityDrafts[match.item.id] ?? String(match.cartQuantity)}
                            disabled={updatingQuantityItemId === match.item.id}
                            onChange={(event) => void updateQuantity(match, event.target.value)}
                            onBlur={() => restoreQuantityIfInvalid(match)}
                          />
                          <button
                            type="button"
                            aria-label={`Increase cart quantity for ${match.storeItem.description}`}
                            aria-busy={updatingQuantityItemId === match.item.id}
                            disabled={updatingQuantityItemId === match.item.id}
                            onClick={() => void updateQuantity(match, String(adjustedQuantity(match, 1)))}
                          >
                            <Plus size={18} />
                          </button>
                        </div>
                        {renderQuantityDetails(match)}
                      </div>
                    </div>
                  </div>
                  <div className="store-item-selected-details">
                    {match.storeItem.imageUrl ? (
                      <img
                        className="store-item-thumbnail"
                        src={match.storeItem.imageUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="store-item-thumbnail placeholder" aria-hidden="true">
                        <Package size={28} />
                      </div>
                    )}
                    <div>
                      <strong>{match.storeItem.description}</strong>
                      <span>{[match.storeItem.brand, match.storeItem.size].filter(Boolean).join(" · ") || "Package details unavailable"}</span>
                      <span>
                        {formatPrice(match.storeItem)}
                        {` · ${formatAvailability(match.storeItem.stockLevel)}`}
                        {` · Qty ${match.cartQuantity}`}
                      </span>
                    </div>
                  </div>
                  {renderRemoveButton(match.item)}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No store items were matched.</div>
          )}

          {skipped.length ? (
            <div className="store-item-unmatched">
              <h4>Unmatched ingredients</h4>
              {skipped.map((skip) => (
                <div className="store-item-unmatched-row" key={skip.item.id}>
                  <div>
                    <strong>{skip.item.text || skip.item.item}</strong>
                    {renderSourceLinks(skip.item)}
                    <span>{skip.reason}</span>
                  </div>
                  <div className="store-item-unmatched-actions">
                    {renderFindItemControl(skip.item)}
                  </div>
                  {renderRemoveButton(skip.item)}
                </div>
              ))}
            </div>
          ) : null}

          <div className="panel-actions store-item-review-actions">
            <button
              aria-busy={qfcSubmitProgress?.phase === "adding"}
              onClick={() => void addToCart()}
              disabled={
                !allowRealQfcCartMutation
                || !matches.length
                || Boolean(qfcSubmitProgress)
                || updatingQuantityItemId !== null
              }
              title={allowRealQfcCartMutation ? undefined : "Enable real cart changes in QFC preferences"}
            >
              <Send size={17} />
              {qfcSubmitProgress?.phase === "adding"
                ? "Adding to QFC..."
                : allowRealQfcCartMutation
                  ? `Add ${matches.length} reviewed store item${matches.length === 1 ? "" : "s"} to QFC`
                  : "Real QFC cart changes disabled"}
            </button>
            <button className="secondary" onClick={openQfcCart}>
              <ExternalLink size={17} />
              Open cart on QFC
            </button>
          </div>
          {qfcSubmitProgress?.phase === "adding" ? <QfcSubmitProgressBar progress={qfcSubmitProgress} /> : null}
          {message ? <div className="success" role="status">{message}</div> : null}
        </>
      ) : (
        <div className="empty-state">Review and approve ingredients, then match them to store items.</div>
      )}
    </section>
  );
}
