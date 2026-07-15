import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";

export type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "grocery-getter.sqlite");
const legacyDbPath = path.join(dataDir, "grocery-helper.sqlite");

let SQL: SqlJsStatic;
export let db: Database;

export type Row = Record<string, string | number | null>;

function columnExists(tableName: string, columnName: string) {
  return queryAll(`PRAGMA table_info(${tableName})`).some((column) => column.name === columnName);
}

function columnIsNotNull(tableName: string, columnName: string) {
  return queryAll(`PRAGMA table_info(${tableName})`).some(
    (column) => column.name === columnName && column.notnull === 1
  );
}

function storeItemPreferencesHaveProviderKey() {
  const columns = queryAll(`PRAGMA table_info(store_item_preferences)`);
  return columns.some((column) => column.name === "provider" && column.pk === 1)
    && columns.some((column) => column.name === "ingredient_key" && column.pk === 2);
}

export async function initializeDb() {
  SQL = await initSqlJs();
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    fs.renameSync(legacyDbPath, dbPath);
  }
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('entree', 'vegetable_side', 'starch_side')),
    is_test_data INTEGER NOT NULL DEFAULT 0,
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
    is_test_data INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL,
    source_recipe_names TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS store_item_preferences (
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
    PRIMARY KEY (provider, ingredient_key)
  );
`);
  saveDb();

  if (!storeItemPreferencesHaveProviderKey()) {
    run("ALTER TABLE store_item_preferences RENAME TO store_item_preferences_old");
    run(`
      CREATE TABLE store_item_preferences (
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
        PRIMARY KEY (provider, ingredient_key)
      )
    `);
    run(`
      INSERT INTO store_item_preferences (
        ingredient_key, ingredient_name, provider, store_item_id, upc,
        description, brand, size, image_url, is_store_brand, created_at, updated_at
      )
      SELECT
        ingredient_key, ingredient_name, provider, store_item_id, upc,
        description, brand, size, '', is_store_brand, created_at, updated_at
      FROM store_item_preferences_old
    `);
    run("DROP TABLE store_item_preferences_old");
    saveDb();
  }

  if (!columnExists("store_item_preferences", "image_url")) {
    run("ALTER TABLE store_item_preferences ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
    saveDb();
  }

  if (!columnExists("recipes", "is_test_data")) {
    run("ALTER TABLE recipes ADD COLUMN is_test_data INTEGER NOT NULL DEFAULT 0");
    run("UPDATE recipes SET is_test_data = 1");
    saveDb();
  }

  if (!columnExists("menus", "is_test_data")) {
    run("ALTER TABLE menus ADD COLUMN is_test_data INTEGER NOT NULL DEFAULT 0");
    saveDb();
  }

  if (columnIsNotNull("menu_items", "recipe_id")) {
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

  const settings = queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM settings");
  if (settings?.count === 0) {
    run("INSERT INTO settings (key, value) VALUES (?, ?)", ["preferStoreBrands", "true"]);
    run("INSERT INTO settings (key, value) VALUES (?, ?)", ["qfcAdapterMode", "stub"]);
    saveDb();
  }
}

export function saveDb() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export function run(sql: string, params: SqlValue[] = []) {
  db.run(sql, params);
}

export function insert(sql: string, params: SqlValue[] = []) {
  db.run(sql, params);
  const row = queryOne<{ id: number }>("SELECT last_insert_rowid() AS id");
  return row?.id ?? 0;
}

export function queryAll<T extends Row>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql, params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T extends Row>(sql: string, params: SqlValue[] = []): T | null {
  return queryAll<T>(sql, params)[0] ?? null;
}

export function transaction<T>(callback: () => T): T {
  run("BEGIN");
  try {
    const result = callback();
    run("COMMIT");
    saveDb();
    return result;
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
}
