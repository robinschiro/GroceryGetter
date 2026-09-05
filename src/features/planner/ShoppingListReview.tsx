import { useState } from "react";
import { Check, ChevronRight, LoaderCircle, Pencil, Send, Trash2, X } from "lucide-react";
import type {
  QfcSubmitProgress,
  ShoppingListItem,
  ShoppingListSourceTarget
} from "../../../shared/contracts/index.js";
import { recipeEditRoute, shoppingListEditRoute } from "../../shared/router.js";
import { QfcSubmitProgressBar } from "../../shared/QfcSubmitProgressBar.js";

export function ShoppingListReview({
  items,
  openSource,
  savingApprovalItemIds,
  savingPantryItemIds,
  searchingStoreItemIds,
  savingSourceItemIds,
  updateApproval,
  updatePantry,
  saveToSource,
  clearItems,
  previewStoreItems,
  qfcSubmitProgress,
  message
}: {
  items: ShoppingListItem[];
  openSource: (source: ShoppingListSourceTarget) => void;
  savingApprovalItemIds: Set<number>;
  savingPantryItemIds: Set<number>;
  searchingStoreItemIds: Set<number>;
  savingSourceItemIds: Set<number>;
  updateApproval: (id: number, approved: boolean) => Promise<void>;
  updatePantry: (id: number, isPantry: boolean) => Promise<ShoppingListItem | null>;
  saveToSource: (item: ShoppingListItem) => Promise<boolean>;
  clearItems: () => Promise<void>;
  previewStoreItems: () => Promise<void>;
  qfcSubmitProgress: QfcSubmitProgress | null;
  message: string;
}) {
  const [showUncheckedItems, setShowUncheckedItems] = useState(false);
  const [pantryDrafts, setPantryDrafts] = useState<Record<number, boolean>>({});
  const [expandedSourceItemIds, setExpandedSourceItemIds] = useState<Set<number>>(() => new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemName, setEditingItemName] = useState("");
  const approvedItems = items.filter((item) => Boolean(item.approved));
  const uncheckedItems = items.filter((item) => !item.approved);

  function beginEditingItem(item: ShoppingListItem) {
    setEditingItemId(item.id);
    setEditingItemName(item.item);
  }

  function cancelEditingItem() {
    setEditingItemId(null);
    setEditingItemName("");
  }

  function sourceLink(source: ShoppingListSourceTarget) {
    return (
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
            && event.button === 0
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
    );
  }

  function renderSources(item: ShoppingListItem) {
    const sources = item.sourceTargets;
    if (!sources.length) {
      return (
        <div className="shopping-source">
          <span className="shopping-source-summary">
            <span className="shopping-source-label">For</span>
            <span>{item.sourceNames}</span>
          </span>
        </div>
      );
    }
    if (sources.length === 1) {
      return (
        <div className="shopping-source">
          <span className="shopping-source-summary">
            <span className="shopping-source-label">For</span>
            {sourceLink(sources[0])}
          </span>
        </div>
      );
    }

    const expanded = expandedSourceItemIds.has(item.id);
    const detailsId = `shopping-item-sources-${item.id}`;
    return (
      <div className="shopping-source">
        <span className="shopping-source-summary">
          <span className="shopping-source-label">For</span>
          <button
            className="shopping-source-multiple-button"
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpandedSourceItemIds((current) => {
              const next = new Set(current);
              if (expanded) next.delete(item.id);
              else next.add(item.id);
              return next;
            })}
          >
            multiple
          </button>
        </span>
        {expanded ? (
          <ul className="shopping-source-list" id={detailsId}>
            {sources.map((source) => (
              <li key={`${source.type}-${source.id}`}>{sourceLink(source)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  async function saveEditedItemName(item: ShoppingListItem) {
    const nextItemName = editingItemName.trim();
    if (!nextItemName) return;
    if (nextItemName === item.item) {
      cancelEditingItem();
      return;
    }

    const saved = await saveToSource({ ...item, item: nextItemName });
    if (saved) cancelEditingItem();
  }

  function renderShoppingRow(item: ShoppingListItem) {
    const isApproved = Boolean(item.approved);
    const isSavingApproval = savingApprovalItemIds.has(item.id);
    const isSearchingStoreItems = searchingStoreItemIds.has(item.id);
    const isSavingPantry = savingPantryItemIds.has(item.id);
    const isSaving = isSavingApproval || isSavingPantry;
    const isPantry = pantryDrafts[item.id] ?? item.isPantry;
    const isEditing = editingItemId === item.id;

    function toggleApproval() {
      if (!isSaving) {
        void updateApproval(item.id, !isApproved);
      }
    }

    async function togglePantry(nextIsPantry: boolean) {
      setPantryDrafts((current) => ({ ...current, [item.id]: nextIsPantry }));
      if (nextIsPantry) setShowUncheckedItems(true);
      try {
        await updatePantry(item.id, nextIsPantry);
      } finally {
        setPantryDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
    }

    return (
      <div
        aria-disabled={isSaving}
        aria-label={`${isApproved ? "Cross off" : "Restore"} ${item.item}`}
        aria-pressed={!isApproved}
        className={`shopping-row ${isApproved ? "" : "shopping-row-crossed-off"}`}
        key={item.id}
        role="button"
        tabIndex={isSaving ? -1 : 0}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button, input, textarea, select, label")) return;
          if (isEditing && (event.target as HTMLElement).closest(".shopping-item-editor")) return;
          toggleApproval();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          toggleApproval();
        }}
      >
        <div className="shopping-item-editor">
          {isSearchingStoreItems ? (
            <LoaderCircle
              className="store-search-spinner store-search-spinner-prominent"
              size={20}
              aria-hidden="true"
            />
          ) : null}
          {!item.unit.trim() && item.quantity.trim() ? (
            <span className="shopping-item-quantity">{item.quantity}</span>
          ) : null}
          {item.canPersistToSource ? (
            isEditing ? (
              <>
                <input
                  autoFocus
                  aria-label={`Item name for ${item.sourceNames}`}
                  value={editingItemName}
                  disabled={savingSourceItemIds.has(item.id)}
                  onChange={(event) => setEditingItemName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveEditedItemName(item);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEditingItem();
                    }
                  }}
                />
                <span className="shopping-item-edit-actions">
                  <button
                    className="secondary shopping-item-icon-button"
                    type="button"
                    aria-label={`Save item name to ${item.sourceNames}`}
                    aria-busy={savingSourceItemIds.has(item.id)}
                    disabled={!editingItemName.trim() || savingSourceItemIds.has(item.id)}
                    onClick={() => void saveEditedItemName(item)}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="secondary shopping-item-icon-button"
                    type="button"
                    aria-label={`Cancel editing item name for ${item.sourceNames}`}
                    disabled={savingSourceItemIds.has(item.id)}
                    onClick={cancelEditingItem}
                  >
                    <X size={16} />
                  </button>
                </span>
              </>
            ) : (
              <>
                <strong className="shopping-item-name">{item.item}</strong>
                <button
                  className="secondary shopping-item-icon-button"
                  type="button"
                  aria-label={`Edit item name for ${item.sourceNames}`}
                  disabled={savingSourceItemIds.has(item.id)}
                  onClick={() => beginEditingItem(item)}
                >
                  <Pencil size={16} />
                </button>
              </>
            )
          ) : (
            <strong className="shopping-item-name">{item.item}</strong>
          )}
          <label className="shopping-pantry-toggle">
            <input
              type="checkbox"
              aria-label={`Pantry status for ${item.item}`}
              checked={isPantry}
              disabled={isSavingPantry}
              onChange={(event) => void togglePantry(event.target.checked)}
            />
            <span>Pantry</span>
          </label>
        </div>
        {renderSources(item)}
        {item.automaticExclusionReason === "pantry" ? (
          <span className="automatic-exclusion-reason">
            Automatically unchecked — pantry ingredient
          </span>
        ) : null}
        {isSearchingStoreItems ? (
          <span className="approval-save-status store-search-status" role="status">
            Searching store items...
          </span>
        ) : isSavingApproval ? <span className="approval-save-status">Saving...</span> : null}
      </div>
    );
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Check size={18} />
        <h3>Ingredient Review</h3>
      </div>

      {items.length ? (
        <>
          <div className="shopping-table">
            {approvedItems.map(renderShoppingRow)}
            {uncheckedItems.length ? (
              <>
                <button
                  className="unchecked-ingredients-toggle"
                  type="button"
                  aria-expanded={showUncheckedItems}
                  onClick={() => setShowUncheckedItems((current) => !current)}
                >
                  <ChevronRight size={17} aria-hidden="true" />
                  <span>
                    {uncheckedItems.length} unchecked ingredient{uncheckedItems.length === 1 ? "" : "s"}
                  </span>
                </button>
                {showUncheckedItems ? uncheckedItems.map(renderShoppingRow) : null}
              </>
            ) : null}
          </div>
          <div className="panel-actions">
            <button className="secondary" onClick={() => void clearItems()}>
              <Trash2 size={17} />
              Clear aggregated ingredients
            </button>
            <button
              aria-busy={Boolean(qfcSubmitProgress)}
              onClick={() => void previewStoreItems()}
              disabled={Boolean(qfcSubmitProgress)}
            >
              <Send size={17} />
              {qfcSubmitProgress ? "Matching store items..." : "Review store items"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Aggregate a menu to review its grocery list.</div>
      )}

      {qfcSubmitProgress && qfcSubmitProgress.phase !== "adding" ? <QfcSubmitProgressBar progress={qfcSubmitProgress} /> : null}
      {message ? <div className="success">{message}</div> : null}
    </section>
  );
}
