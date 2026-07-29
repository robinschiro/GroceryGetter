import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";

export type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

export type Row = Record<string, string | number | null>;

export const productionDatabasePath = path.resolve(process.cwd(), "data", "grocery-getter.sqlite");

export type GroceryDatabase = {
  readonly filePath: string;
  readonly initialized: boolean;
  initialize(): Promise<void>;
  reset(): Promise<void>;
  close(): void;
  save(): void;
  run(sql: string, params?: SqlValue[]): void;
  insert(sql: string, params?: SqlValue[]): number;
  queryAll<T extends Row>(sql: string, params?: SqlValue[]): T[];
  queryOne<T extends Row>(sql: string, params?: SqlValue[]): T | null;
  transaction<T>(callback: () => T): T;
};

function columnExists(database: GroceryDatabase, tableName: string, columnName: string) {
  const { queryAll } = database;
  return queryAll(`PRAGMA table_info(${tableName})`).some((column) => column.name === columnName);
}

function tableExists(database: GroceryDatabase, tableName: string) {
  const { queryOne } = database;
  return Boolean(queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]));
}

function columnIsNotNull(database: GroceryDatabase, tableName: string, columnName: string) {
  const { queryAll } = database;
  return queryAll(`PRAGMA table_info(${tableName})`).some(
    (column) => column.name === columnName && column.notnull === 1
  );
}

function storeItemPreferencesHaveScopeKey(database: GroceryDatabase) {
  const { queryAll } = database;
  const columns = queryAll(`PRAGMA table_info(store_item_preferences)`);
  return columns.some((column) => column.name === "data_scope" && column.pk === 1)
    && columns.some((column) => column.name === "provider" && column.pk === 2)
    && columns.some((column) => column.name === "ingredient_key" && column.pk === 3);
}

function customShoppingListsHaveScopedNameKey(database: GroceryDatabase) {
  const { queryOne } = database;
  const definition = queryOne<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'custom_shopping_lists'"
  )?.sql ?? "";
  return /UNIQUE\s*\(\s*data_scope\s*,\s*name(?:\s+COLLATE\s+NOCASE)?\s*\)/i.test(definition);
}

async function initializeSchema(database: GroceryDatabase) {
  const { insert, queryAll, queryOne, run, save: saveDb, transaction } = database;

  if (tableExists(database, "shopping_list_items") && !tableExists(database, "menu_shopping_list_items")) {
    run("ALTER TABLE shopping_list_items RENAME TO menu_shopping_list_items");
  }
  if (tableExists(database, "shopping_list_item_sources") && !tableExists(database, "menu_shopping_list_item_recipe_sources")) {
    run("ALTER TABLE shopping_list_item_sources RENAME TO menu_shopping_list_item_recipe_sources");
  }
  if (tableExists(database, "menu_shopping_list_items") && columnExists(database, "menu_shopping_list_items", "source_recipe_names")) {
    run("ALTER TABLE menu_shopping_list_items RENAME COLUMN source_recipe_names TO source_names");
  }
  if (
    tableExists(database, "menu_shopping_list_item_recipe_sources")
    && columnExists(database, "menu_shopping_list_item_recipe_sources", "shopping_list_item_id")
  ) {
    run(
      `ALTER TABLE menu_shopping_list_item_recipe_sources
      RENAME COLUMN shopping_list_item_id TO menu_shopping_list_item_id`
    );
  }
  saveDb();

  run(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('entree', 'vegetable_side', 'starch_side')),
    data_scope TEXT NOT NULL DEFAULT 'production'
      CHECK (data_scope IN ('production', 'sandbox')),
    include_in_menu_generation INTEGER NOT NULL DEFAULT 0,
    servings INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    source_path TEXT,
    source_hash TEXT,
    sync_status TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    meal_count INTEGER NOT NULL,
    data_scope TEXT NOT NULL DEFAULT 'production'
      CHECK (data_scope IN ('production', 'sandbox')),
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    meal_number INTEGER NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('entree', 'vegetable_side', 'starch_side')),
    recipe_id INTEGER REFERENCES recipes(id)
  );

  CREATE TABLE IF NOT EXISTS menu_shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL,
    source_names TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS custom_shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE,
    data_scope TEXT NOT NULL DEFAULT 'production'
      CHECK (data_scope IN ('production', 'sandbox')),
    include_in_menu_by_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (data_scope, name COLLATE NOCASE)
  );

  CREATE TABLE IF NOT EXISTS custom_shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custom_shopping_list_id INTEGER NOT NULL REFERENCES custom_shopping_lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_custom_shopping_lists (
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    custom_shopping_list_id INTEGER NOT NULL REFERENCES custom_shopping_lists(id) ON DELETE CASCADE,
    PRIMARY KEY (menu_id, custom_shopping_list_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scoped_settings (
    data_scope TEXT NOT NULL
      CHECK (data_scope IN ('production', 'sandbox')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (data_scope, key)
  );

  CREATE TABLE IF NOT EXISTS store_item_preferences (
    data_scope TEXT NOT NULL
      CHECK (data_scope IN ('production', 'sandbox')),
    ingredient_key TEXT NOT NULL,
    ingredient_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    store_item_id TEXT NOT NULL,
    upc TEXT NOT NULL,
    description TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    is_store_brand INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (data_scope, provider, ingredient_key)
  );
  `);
  saveDb();

  if (!columnExists(database, "custom_shopping_lists", "include_in_menu_by_default")) {
    run(
      "ALTER TABLE custom_shopping_lists ADD COLUMN include_in_menu_by_default INTEGER NOT NULL DEFAULT 0"
    );
    saveDb();
  }

  if (!columnExists(database, "recipes", "data_scope")) {
    run("ALTER TABLE recipes ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'production'");
    if (columnExists(database, "recipes", "is_test_data")) {
      run("UPDATE recipes SET data_scope = CASE WHEN is_test_data = 1 THEN 'sandbox' ELSE 'production' END");
    }
    saveDb();
  }

  if (!columnExists(database, "recipes", "include_in_menu_generation")) {
    run(
      "ALTER TABLE recipes ADD COLUMN include_in_menu_generation INTEGER NOT NULL DEFAULT 0"
    );
    saveDb();
  }

  if (!columnExists(database, "menus", "data_scope")) {
    run("ALTER TABLE menus ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'production'");
    if (columnExists(database, "menus", "is_test_data")) {
      run("UPDATE menus SET data_scope = CASE WHEN is_test_data = 1 THEN 'sandbox' ELSE 'production' END");
    }
    saveDb();
  }

  if (!columnExists(database, "custom_shopping_lists", "data_scope")) {
    run("ALTER TABLE custom_shopping_lists ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'production'");
    saveDb();
  }

  if (!customShoppingListsHaveScopedNameKey(database)) {
    run("PRAGMA foreign_keys = OFF");
    run(`
      CREATE TABLE custom_shopping_lists_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE,
        data_scope TEXT NOT NULL DEFAULT 'production'
          CHECK (data_scope IN ('production', 'sandbox')),
        include_in_menu_by_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (data_scope, name COLLATE NOCASE)
      )
    `);
    run(`
      INSERT INTO custom_shopping_lists_new (
        id, name, data_scope, include_in_menu_by_default, created_at, updated_at
      )
      SELECT id, name, data_scope, include_in_menu_by_default, created_at, updated_at
      FROM custom_shopping_lists
    `);
    run("DROP TABLE custom_shopping_lists");
    run("ALTER TABLE custom_shopping_lists_new RENAME TO custom_shopping_lists");
    run("PRAGMA foreign_keys = ON");
    saveDb();
  }

  const menusWithCrossScopeCustomLists = queryAll<{ menuId: number }>(
    `SELECT DISTINCT menu_custom_shopping_lists.menu_id AS menuId
    FROM menu_custom_shopping_lists
    JOIN menus ON menus.id = menu_custom_shopping_lists.menu_id
    JOIN custom_shopping_lists
      ON custom_shopping_lists.id = menu_custom_shopping_lists.custom_shopping_list_id
    WHERE menus.data_scope <> custom_shopping_lists.data_scope`
  );
  if (menusWithCrossScopeCustomLists.length) {
    transaction(() => {
      for (const { menuId } of menusWithCrossScopeCustomLists) {
        run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
      }
      run(
        `DELETE FROM menu_custom_shopping_lists
        WHERE EXISTS (
          SELECT 1
          FROM menus
          JOIN custom_shopping_lists
            ON custom_shopping_lists.id = menu_custom_shopping_lists.custom_shopping_list_id
          WHERE menus.id = menu_custom_shopping_lists.menu_id
            AND menus.data_scope <> custom_shopping_lists.data_scope
        )`
      );
    });
  }

  if (!storeItemPreferencesHaveScopeKey(database)) {
    const oldPreferencesHaveImageUrl = columnExists(database, "store_item_preferences", "image_url");
    run("ALTER TABLE store_item_preferences RENAME TO store_item_preferences_old");
    run(`
      CREATE TABLE store_item_preferences (
        data_scope TEXT NOT NULL
          CHECK (data_scope IN ('production', 'sandbox')),
        ingredient_key TEXT NOT NULL,
        ingredient_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        store_item_id TEXT NOT NULL,
        upc TEXT NOT NULL,
        description TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        is_store_brand INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (data_scope, provider, ingredient_key)
      )
    `);
    run(`
      INSERT INTO store_item_preferences (
        data_scope, ingredient_key, ingredient_name, provider, store_item_id, upc,
        description, brand, size, image_url, is_store_brand, created_at, updated_at
      )
      SELECT
        'production', ingredient_key, ingredient_name, provider, store_item_id, upc,
        description, brand, size, ${oldPreferencesHaveImageUrl ? "image_url" : "''"},
        is_store_brand, created_at, updated_at
      FROM store_item_preferences_old
    `);
    run("DROP TABLE store_item_preferences_old");
    saveDb();
  }

  if (!columnExists(database, "store_item_preferences", "image_url")) {
    run("ALTER TABLE store_item_preferences ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
    saveDb();
  }

  if (columnIsNotNull(database, "menu_items", "recipe_id")) {
    run("PRAGMA foreign_keys = OFF");
    run("ALTER TABLE menu_items RENAME TO menu_items_old");
    run(`
      CREATE TABLE menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        meal_number INTEGER NOT NULL,
        slot TEXT NOT NULL CHECK (slot IN ('entree', 'vegetable_side', 'starch_side')),
        recipe_id INTEGER REFERENCES recipes(id)
      )
    `);
    run(`
      INSERT INTO menu_items (id, menu_id, meal_number, slot, recipe_id)
      SELECT id, menu_id, meal_number, slot, recipe_id
      FROM menu_items_old
    `);
    run("DROP TABLE menu_items_old");
    run("PRAGMA foreign_keys = ON");
    saveDb();
  }

  run(`
    CREATE TABLE IF NOT EXISTS menu_shopping_list_item_recipe_sources (
      menu_shopping_list_item_id INTEGER NOT NULL REFERENCES menu_shopping_list_items(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      recipe_ingredient_id INTEGER NOT NULL REFERENCES recipe_ingredients(id) ON DELETE CASCADE,
      PRIMARY KEY (menu_shopping_list_item_id, menu_item_id, recipe_ingredient_id)
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS menu_shopping_list_item_custom_sources (
      menu_shopping_list_item_id INTEGER NOT NULL REFERENCES menu_shopping_list_items(id) ON DELETE CASCADE,
      custom_shopping_list_item_id INTEGER NOT NULL REFERENCES custom_shopping_list_items(id) ON DELETE CASCADE,
      PRIMARY KEY (menu_shopping_list_item_id, custom_shopping_list_item_id)
    )
  `);
  saveDb();

  const settings = queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM settings");
  if (settings?.count === 0) {
    run("INSERT INTO settings (key, value) VALUES (?, ?)", ["preferStoreBrands", "true"]);
    run("INSERT INTO settings (key, value) VALUES (?, ?)", ["qfcAdapterMode", "stub"]);
    saveDb();
  }

  const productionLocationId = queryOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'krogerLocationId'"
  )?.value;
  if (productionLocationId) {
    run(
      `INSERT INTO scoped_settings (data_scope, key, value)
      VALUES ('production', 'krogerLocationId', ?)
      ON CONFLICT(data_scope, key) DO NOTHING`,
      [productionLocationId]
    );
  }
  const preferStoreBrands = queryOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'preferStoreBrands'"
  )?.value ?? "true";
  run(
    `INSERT INTO scoped_settings (data_scope, key, value)
    VALUES ('production', 'preferStoreBrands', ?)
    ON CONFLICT(data_scope, key) DO NOTHING`,
    [preferStoreBrands]
  );
  run(
    `INSERT INTO scoped_settings (data_scope, key, value)
    VALUES ('sandbox', 'preferStoreBrands', 'true')
    ON CONFLICT(data_scope, key) DO NOTHING`
  );
  run(
    `INSERT INTO scoped_settings (data_scope, key, value)
    VALUES ('production', 'allowRealQfcCartMutation', 'true')
    ON CONFLICT(data_scope, key) DO NOTHING`
  );
  run(
    `INSERT INTO scoped_settings (data_scope, key, value)
    VALUES ('sandbox', 'allowRealQfcCartMutation', 'false')
    ON CONFLICT(data_scope, key) DO NOTHING`
  );
  saveDb();
}

export function createDatabase({ filePath }: { filePath: string }): GroceryDatabase {
  const resolvedFilePath = path.resolve(filePath);
  let rawDatabase: Database | null = null;

  const requireDatabase = () => {
    if (!rawDatabase) {
      throw new Error(`Database has not been initialized: ${resolvedFilePath}`);
    }
    return rawDatabase;
  };

  const database: GroceryDatabase = {
    filePath: resolvedFilePath,
    get initialized() {
      return rawDatabase !== null;
    },
    async initialize() {
      if (rawDatabase) return;
      fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true });
      const SQL = await initSqlJs();
      rawDatabase = fs.existsSync(resolvedFilePath)
        ? new SQL.Database(fs.readFileSync(resolvedFilePath))
        : new SQL.Database();
      rawDatabase.run("PRAGMA foreign_keys = ON");
      await initializeSchema(database);
    },
    async reset() {
      rawDatabase?.close();
      rawDatabase = null;
      if (fs.existsSync(resolvedFilePath)) {
        fs.rmSync(resolvedFilePath);
      }
      await database.initialize();
    },
    close() {
      rawDatabase?.close();
      rawDatabase = null;
    },
    save() {
      fs.writeFileSync(resolvedFilePath, Buffer.from(requireDatabase().export()));
    },
    run(sql, params = []) {
      requireDatabase().run(sql, params);
    },
    insert(sql, params = []) {
      requireDatabase().run(sql, params);
      const row = database.queryOne<{ id: number }>("SELECT last_insert_rowid() AS id");
      return row?.id ?? 0;
    },
    queryAll<T extends Row>(sql: string, params: SqlValue[] = []) {
      const stmt = requireDatabase().prepare(sql, params);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return rows;
    },
    queryOne<T extends Row>(sql: string, params: SqlValue[] = []): T | null {
      return database.queryAll<T>(sql, params)[0] ?? null;
    },
    transaction<T>(callback: () => T) {
      database.run("BEGIN");
      try {
        const result = callback();
        database.run("COMMIT");
        database.save();
        return result;
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      }
    }
  };

  return database;
}

let defaultDatabase: GroceryDatabase | null = null;

export function setDefaultDatabase(database: GroceryDatabase) {
  defaultDatabase = database;
}

function getDefaultDatabase() {
  if (!defaultDatabase) {
    throw new Error("The default database has not been configured.");
  }
  return defaultDatabase;
}

/** @deprecated Prefer an injected GroceryDatabase instance. */
export async function initializeDb() {
  const database = createDatabase({ filePath: productionDatabasePath });
  await database.initialize();
  setDefaultDatabase(database);
}

/** @deprecated Prefer database.save(). */
export function saveDb() {
  getDefaultDatabase().save();
}

/** @deprecated Prefer database.run(). */
export function run(sql: string, params: SqlValue[] = []) {
  getDefaultDatabase().run(sql, params);
}

/** @deprecated Prefer database.insert(). */
export function insert(sql: string, params: SqlValue[] = []) {
  return getDefaultDatabase().insert(sql, params);
}

/** @deprecated Prefer database.queryAll(). */
export function queryAll<T extends Row>(sql: string, params: SqlValue[] = []): T[] {
  return getDefaultDatabase().queryAll<T>(sql, params);
}

/** @deprecated Prefer database.queryOne(). */
export function queryOne<T extends Row>(sql: string, params: SqlValue[] = []): T | null {
  return getDefaultDatabase().queryOne<T>(sql, params);
}

/** @deprecated Prefer database.transaction(). */
export function transaction<T>(callback: () => T): T {
  return getDefaultDatabase().transaction(callback);
}
