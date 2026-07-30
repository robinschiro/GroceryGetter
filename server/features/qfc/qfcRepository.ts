import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { DataScope } from "../../types.js";

export function createQfcRepository(database: GroceryDatabase) {
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

  return { getScopedSettings, markMenuSubmitted };
}
