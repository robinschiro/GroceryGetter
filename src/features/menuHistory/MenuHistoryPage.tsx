import { ArrowLeft, CalendarDays, Trash2, Utensils } from "lucide-react";
import { useEffect, useState } from "react";
import type { Menu, MenuSummary } from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import { deleteMenu, getMenu, listMenus } from "../planner/api.js";

function parseDatabaseDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parseDatabaseDate(value));
}

export function MenuHistoryPage({
  api,
  menuId,
  onOpenMenu,
  onBack,
  onDeleted
}: {
  api: ApiRequest;
  menuId: number | null;
  onOpenMenu: (menuId: number) => void;
  onBack: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setActionError("");
    setDeleting(false);
    setMenu(null);

    const request = menuId === null ? listMenus(api) : getMenu(api, menuId);
    void request
      .then((result) => {
        if (!active) return;
        if (menuId === null) {
          setMenus(result as MenuSummary[]);
        } else {
          setMenu(result as Menu);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load menu history.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, menuId]);

  async function removeMenu() {
    if (!menu?.id || deleting) return;
    if (!window.confirm(`Delete “${menu.name}”? This action cannot be undone.`)) return;

    setDeleting(true);
    setActionError("");
    try {
      await deleteMenu(api, menu.id);
      await onDeleted();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to delete menu.");
      setDeleting(false);
    }
  }

  if (loading) {
    return <section className="panel menu-history-state">Loading menu history…</section>;
  }

  if (error) {
    return (
      <section className="panel">
        {menuId !== null ? (
          <button className="secondary menu-history-back" type="button" onClick={onBack}>
            <ArrowLeft size={17} />
            Back to menu history
          </button>
        ) : null}
        <div className="error" role="alert">{error}</div>
      </section>
    );
  }

  if (menuId !== null && menu) {
    return (
      <section className="panel menu-detail">
        <div className="menu-detail-actions">
          <button className="secondary menu-history-back" type="button" onClick={onBack}>
            <ArrowLeft size={17} />
            Back to menu history
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => void removeMenu()}
            disabled={deleting}
          >
            <Trash2 size={17} />
            {deleting ? "Deleting…" : "Delete menu"}
          </button>
        </div>
        {actionError ? <div className="error" role="alert">{actionError}</div> : null}
        <div className="panel-heading menu-detail-heading">
          <CalendarDays size={18} />
          <div>
            <h3>{menu.name}</h3>
            <p>
              {menu.createdAt ? `Saved ${formatDate(menu.createdAt)} · ` : ""}
              {menu.mealCount} {menu.mealCount === 1 ? "meal" : "meals"} · {menu.status}
            </p>
          </div>
        </div>
        <div className="menu-detail-meals">
          {Array.from({ length: menu.mealCount }, (_, index) => index + 1).map((mealNumber) => (
            <article className="menu-detail-meal" key={mealNumber}>
              <h4>Meal {mealNumber}</h4>
              <dl>
                <div>
                  <dt>Entrée</dt>
                  <dd>{menu.items.find((item) => item.mealNumber === mealNumber && item.slot === "entree")?.recipeName ?? "None"}</dd>
                </div>
                <div>
                  <dt>Vegetable side</dt>
                  <dd>{menu.items.find((item) => item.mealNumber === mealNumber && item.slot === "vegetable_side")?.recipeName ?? "None"}</dd>
                </div>
                <div>
                  <dt>Starch side</dt>
                  <dd>{menu.items.find((item) => item.mealNumber === mealNumber && item.slot === "starch_side")?.recipeName ?? "None"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <CalendarDays size={18} />
        <h3>Menu History</h3>
      </div>
      {menus.length ? (
        <div className="menu-history-table-wrap">
          <table className="menu-history-table">
            <thead>
              <tr>
                <th scope="col">Menu</th>
                <th scope="col">Saved</th>
                <th scope="col">Meals</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {menus.map((summary) => (
                <tr
                  className="menu-history-row"
                  key={summary.id}
                  onClick={() => onOpenMenu(summary.id)}
                >
                  <th scope="row">
                    <button
                      className="menu-history-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenMenu(summary.id);
                      }}
                    >
                      {summary.name}
                    </button>
                  </th>
                  <td className="menu-history-chip" data-label="Saved">
                    {formatDate(summary.createdAt)}
                  </td>
                  <td className="menu-history-chip" data-label="Meals">
                    {summary.mealCount}
                  </td>
                  <td className="menu-history-chip menu-history-status-chip" data-label="Status">
                    <span className="menu-status">{summary.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Utensils size={20} />
          No saved menus yet. Save a menu from the Planner to start your history.
        </div>
      )}
    </section>
  );
}
