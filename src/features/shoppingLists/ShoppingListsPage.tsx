import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Plus,
  Trash2,
  X
} from "lucide-react";
import type {
  CustomShoppingList,
  CustomShoppingListInput,
  CustomShoppingListItem
} from "../../../shared/contracts/index.js";
import type { ShoppingListsTab } from "../../app/router.js";
import { shoppingListEditRoute } from "../../app/router.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import {
  createShoppingList,
  deleteShoppingList,
  updateShoppingList
} from "./api.js";

type ShoppingListsPageProps = {
  api: ApiRequest;
  activeTab: ShoppingListsTab;
  editingListId: number | null;
  lists: CustomShoppingList[];
  onEdit: (listId: number) => void;
  onExitEdit: () => void;
  onTabChange: (tab: ShoppingListsTab) => void;
  onSaved: () => Promise<void>;
};

export function ShoppingListsPage({
  api,
  activeTab,
  editingListId,
  lists,
  onEdit,
  onExitEdit,
  onTabChange,
  onSaved
}: ShoppingListsPageProps) {
  const editingList = lists.find((list) => list.id === editingListId) ?? null;

  async function create(input: CustomShoppingListInput) {
    const list = await createShoppingList(api, input);
    await onSaved();
    return list;
  }

  async function update(input: CustomShoppingListInput) {
    if (!editingList) return;
    await updateShoppingList(api, editingList.id, input);
    await onSaved();
  }

  async function remove() {
    if (!editingList) return;
    await deleteShoppingList(api, editingList.id);
    await onSaved();
    onExitEdit();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <ListChecks size={18} />
        <h3>Shopping Lists</h3>
      </div>
      <div className="sub-tabs" role="tablist" aria-label="Shopping list sections">
        <button
          className={`sub-tab-button ${activeTab === "manage" ? "active" : ""}`}
          onClick={() => onTabChange("manage")}
          role="tab"
          aria-selected={activeTab === "manage"}
          type="button"
        >
          Manage Lists
        </button>
        <button
          className={`sub-tab-button ${activeTab === "create" ? "active" : ""}`}
          onClick={() => onTabChange("create")}
          role="tab"
          aria-selected={activeTab === "create"}
          type="button"
        >
          Add List
        </button>
      </div>
      {activeTab === "create" ? (
        <ShoppingListForm mode="create" onSubmit={create} />
      ) : editingList ? (
        <ShoppingListForm
          mode="edit"
          initialList={editingList}
          onCancel={onExitEdit}
          onDelete={remove}
          onSubmit={update}
        />
      ) : (
        <div className="tab-panel" role="tabpanel">
          {lists.length ? (
            <div className="recipe-list shopping-list-management-list">
              {lists.map((list) => (
                <button
                  className="recipe-list-item recipe-management-item shopping-list-management-item"
                  key={list.id}
                  onClick={() => onEdit(list.id)}
                  type="button"
                >
                  <div className="recipe-management-copy"><strong>{list.name}</strong></div>
                  <div className="recipe-management-meta">
                    <span className="recipe-meta-chip">
                      {list.items.length} {list.items.length === 1 ? "item" : "items"}
                    </span>
                    <span className={`recipe-meta-chip recipe-status-chip ${
                      list.includeInMenuByDefault ? "enabled" : ""
                    }`}>
                      {list.includeInMenuByDefault
                        ? "Included by default"
                        : "Not included by default"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No custom shopping lists have been added yet.</div>
          )}
        </div>
      )}
    </section>
  );
}

function emptyItem(): CustomShoppingListItem {
  return { text: "", quantity: "", unit: "", item: "" };
}

function ShoppingListForm({
  mode,
  initialList,
  onCancel,
  onDelete,
  onSubmit
}: {
  mode: "create" | "edit";
  initialList?: CustomShoppingList;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
  onSubmit: (input: CustomShoppingListInput) => Promise<CustomShoppingList | void>;
}) {
  const makeInitialForm = () => ({
    name: initialList?.name ?? "",
    includeInMenuByDefault: initialList?.includeInMenuByDefault ?? false,
    items: initialList?.items.length
      ? initialList.items.map((item) => ({ ...item }))
      : [emptyItem()]
  });
  const [form, setForm] = useState(makeInitialForm);
  const [error, setError] = useState("");
  const [createdList, setCreatedList] = useState<CustomShoppingList | null>(null);
  const [updatedListName, setUpdatedListName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const itemEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setForm(makeInitialForm());
    setError("");
    setCreatedList(null);
    setUpdatedListName(null);
  }, [initialList?.id]);

  function moveItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.items.length) return;
    setForm((current) => {
      const items = [...current.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...current, items };
    });
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }));
    window.requestAnimationFrame(() => {
      const inputs = itemEditorRef.current?.querySelectorAll<HTMLInputElement>(
        ".custom-list-item-input"
      );
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  async function save() {
    const items = form.items
      .map((entry) => {
        const item = entry.item.trim();
        return { ...entry, item, text: entry.text.trim() || item };
      })
      .filter((entry) => entry.item);
    setError("");
    setCreatedList(null);
    setUpdatedListName(null);
    setIsSubmitting(true);
    try {
      const list = await onSubmit({
        name: form.name.trim(),
        includeInMenuByDefault: form.includeInMenuByDefault,
        items
      });
      if (mode === "create") {
        if (list) setCreatedList(list);
        setForm({ name: "", includeInMenuByDefault: false, items: [emptyItem()] });
      } else {
        setUpdatedListName(form.name.trim());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the shopping list.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove() {
    if (!onDelete || !initialList) return;
    if (!window.confirm(`Delete “${initialList.name}”? This action cannot be undone.`)) return;
    setError("");
    setIsSubmitting(true);
    try {
      await onDelete();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete the shopping list."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="tab-panel" role="tabpanel">
      {mode === "edit" ? (
        <div className="edit-heading">
          <div>
            <div className="subhead">Editing shopping list</div>
            <strong>{initialList?.name}</strong>
          </div>
          <button className="secondary" onClick={onCancel} type="button">
            <X size={17} />
            Cancel
          </button>
        </div>
      ) : null}
      <label>
        Name
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({
            ...current,
            name: event.target.value
          }))}
          placeholder="Robin’s regulars"
        />
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.includeInMenuByDefault}
          onChange={(event) => setForm((current) => ({
            ...current,
            includeInMenuByDefault: event.target.checked
          }))}
        />
        <span>Include in new menus by default</span>
      </label>
      <div className="ingredient-editor custom-list-item-editor" ref={itemEditorRef}>
        <div className="subhead">Items</div>
        {form.items.map((entry, index) => (
          <div className="custom-list-item-row" key={`${entry.id ?? "new"}-${index}`}>
            <input
              className="custom-list-item-input"
              value={entry.item}
              onChange={(event) => setForm((current) => ({
                ...current,
                items: current.items.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, item: event.target.value, text: event.target.value }
                    : item
                )
              }))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addItem();
                }
              }}
              placeholder="Coffee"
            />
            <button
              className="icon-button secondary"
              disabled={index === 0}
              onClick={() => moveItem(index, -1)}
              aria-label="Move item up"
              type="button"
            >
              <ChevronUp size={16} />
            </button>
            <button
              className="icon-button secondary"
              disabled={index === form.items.length - 1}
              onClick={() => moveItem(index, 1)}
              aria-label="Move item down"
              type="button"
            >
              <ChevronDown size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => setForm((current) => ({
                ...current,
                items: current.items.filter((_, itemIndex) => itemIndex !== index)
              }))}
              aria-label="Remove item"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button className="secondary" onClick={addItem} type="button">
          <Plus size={17} />
          Add item
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {createdList ? (
        <div className="success" role="status">
          Shopping list “{createdList.name}” was created successfully.{" "}
          <a href={shoppingListEditRoute(createdList.id).path}>View shopping list</a>
        </div>
      ) : null}
      {updatedListName ? (
        <div className="success" role="status">
          Shopping list “{updatedListName}” was updated successfully.
        </div>
      ) : null}
      <div className="panel-actions">
        {mode === "edit" ? (
          <button
            className="danger delete-recipe-button"
            disabled={isSubmitting}
            onClick={() => void remove()}
            type="button"
          >
            <Trash2 size={17} />
            Delete list
          </button>
        ) : null}
        <button disabled={isSubmitting} onClick={() => void save()} type="button">
          <Check size={17} />
          {mode === "create" ? "Save list" : "Update list"}
        </button>
      </div>
    </div>
  );
}
