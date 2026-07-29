import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { initializeSchema } from "./schema.js";

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
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  insert(sql: string, params?: SqlValue[]): number;
  queryAll<T extends Row>(sql: string, params?: SqlValue[]): T[];
  queryOne<T extends Row>(sql: string, params?: SqlValue[]): T | null;
  transaction<T>(callback: () => T): T;
};

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
    exec(sql) {
      requireDatabase().exec(sql);
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
