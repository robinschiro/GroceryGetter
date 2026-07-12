import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Recipe, RecipeCategory, RecipeInput } from "../server/types.js";

const categories = new Set<RecipeCategory>(["entree", "vegetable_side", "starch_side"]);

type ImportRecipe = RecipeInput & {
  sourcePath?: string;
  sourceHash?: string;
  syncStatus?: string;
};

type ImportOptions = {
  apiBaseUrl: string;
  filePath: string;
  commit: boolean;
  skipExisting: boolean;
  validateOnly: boolean;
  sync: boolean;
};

type SyncPlan = {
  newRecipes: ImportRecipe[];
  changedRecipes: Array<{ existing: Recipe; recipe: ImportRecipe }>;
  unchangedRecipes: Array<{ existing: Recipe; recipe: ImportRecipe }>;
  nameConflicts: Array<{ existing: Recipe; recipe: ImportRecipe }>;
  missingFromSource: Recipe[];
};

function readArg(name: string, fallback: string) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function readOptions(): ImportOptions {
  return {
    apiBaseUrl: readArg("--api", "http://127.0.0.1:5174").replace(/\/$/, ""),
    filePath: path.resolve(readArg("--file", "imports/dropbox-recipes/parsed-recipes.json")),
    commit: process.argv.includes("--commit"),
    skipExisting: !process.argv.includes("--allow-duplicates"),
    validateOnly: process.argv.includes("--validate-only"),
    sync: process.argv.includes("--sync")
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected each recipe to be an object.");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fieldName: string, required = true) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed || !required) {
      return trimmed;
    }
  }
  if (!required) {
    return "";
  }
  throw new Error(`${fieldName} must be a non-empty string.`);
}

function readOptionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readString(value, fieldName, false);
}

function readServings(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error("servings must be a positive integer or null.");
}

function validateRecipe(value: unknown, index: number): ImportRecipe {
  const recipe = asObject(value);
  const name = readString(recipe.name, `recipes[${index}].name`);
  const category = readString(recipe.category, `recipes[${index}].category`) as RecipeCategory;

  if (!categories.has(category)) {
    throw new Error(`${name}: category must be entree, vegetable_side, or starch_side.`);
  }
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new Error(`${name}: ingredients must be a non-empty array.`);
  }

  const ingredients = recipe.ingredients.map((ingredientValue, ingredientIndex) => {
    const ingredient = asObject(ingredientValue);
    const text = readString(ingredient.text, `${name}.ingredients[${ingredientIndex}].text`);
    const item = readString(ingredient.item, `${name}.ingredients[${ingredientIndex}].item`);

    return {
      text,
      item,
      quantity: readOptionalString(ingredient.quantity, `${name}.ingredients[${ingredientIndex}].quantity`),
      unit: readOptionalString(ingredient.unit, `${name}.ingredients[${ingredientIndex}].unit`)
    };
  });

  return {
    name,
    category,
    servings: readServings(recipe.servings),
    notes: readOptionalString(recipe.notes, `${name}.notes`) ?? "",
    sourcePath: readOptionalString(recipe.sourcePath, `${name}.sourcePath`),
    sourceHash: readOptionalString(recipe.sourceHash, `${name}.sourceHash`),
    syncStatus: readOptionalString(recipe.syncStatus, `${name}.syncStatus`) || "llm_import",
    ingredients
  };
}

function sourceHashForRecipe(recipe: ImportRecipe, filePath: string) {
  if (!recipe.sourcePath) {
    return recipe.sourceHash;
  }

  const importDir = path.dirname(filePath);
  const rawPath = path.resolve(importDir, recipe.sourcePath);
  const relativeRawPath = path.relative(importDir, rawPath);
  if (relativeRawPath.startsWith("..") || path.isAbsolute(relativeRawPath)) {
    throw new Error(`${recipe.name}: sourcePath must stay inside ${path.relative(process.cwd(), importDir)}.`);
  }
  if (!fs.existsSync(rawPath)) {
    return recipe.sourceHash;
  }

  return createHash("sha256").update(fs.readFileSync(rawPath)).digest("hex");
}

function loadRecipes(filePath: string) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Import file must contain a JSON array of recipes.");
  }
  return parsed.map((value, index) => {
    const recipe = validateRecipe(value, index);
    return {
      ...recipe,
      sourceHash: sourceHashForRecipe(recipe, filePath)
    };
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

function recipeKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

function sourceKey(sourcePath: string) {
  return sourcePath.trim().replaceAll("\\", "/").toLocaleLowerCase();
}

function planSync(recipes: ImportRecipe[], existingRecipes: Recipe[]): SyncPlan {
  const existingBySourcePath = new Map<string, Recipe>();
  const existingByName = new Map<string, Recipe>();
  const parsedSourcePaths = new Set<string>();
  const newRecipes: ImportRecipe[] = [];
  const changedRecipes: Array<{ existing: Recipe; recipe: ImportRecipe }> = [];
  const unchangedRecipes: Array<{ existing: Recipe; recipe: ImportRecipe }> = [];
  const nameConflicts: Array<{ existing: Recipe; recipe: ImportRecipe }> = [];

  existingRecipes.forEach((recipe) => {
    existingByName.set(recipeKey(recipe.name), recipe);
    if (recipe.sourcePath) {
      existingBySourcePath.set(sourceKey(recipe.sourcePath), recipe);
    }
  });

  recipes.forEach((recipe) => {
    if (!recipe.sourcePath) {
      throw new Error(`${recipe.name}: sync mode requires sourcePath.`);
    }

    const key = sourceKey(recipe.sourcePath);
    parsedSourcePaths.add(key);
    const existing = existingBySourcePath.get(key);

    if (existing) {
      if (existing.sourceHash && recipe.sourceHash && existing.sourceHash === recipe.sourceHash) {
        unchangedRecipes.push({ existing, recipe });
      } else {
        changedRecipes.push({ existing, recipe });
      }
      return;
    }

    const existingName = existingByName.get(recipeKey(recipe.name));
    if (existingName) {
      nameConflicts.push({ existing: existingName, recipe });
      return;
    }

    newRecipes.push(recipe);
  });

  const missingFromSource = existingRecipes.filter(
    (recipe) =>
      recipe.sourcePath &&
      recipe.syncStatus === "llm_import" &&
      !parsedSourcePaths.has(sourceKey(recipe.sourcePath))
  );

  return { newRecipes, changedRecipes, unchangedRecipes, nameConflicts, missingFromSource };
}

function printSyncPlan(plan: SyncPlan) {
  console.log(`New: ${plan.newRecipes.length}`);
  console.log(`Changed: ${plan.changedRecipes.length}`);
  console.log(`Unchanged: ${plan.unchangedRecipes.length}`);
  console.log(`Name conflicts: ${plan.nameConflicts.length}`);
  console.log(`Missing from source: ${plan.missingFromSource.length}`);

  plan.nameConflicts.forEach(({ existing, recipe }) => {
    console.log(`Name conflict: "${recipe.name}" (${recipe.sourcePath}) matches existing #${existing.id}.`);
  });
  plan.missingFromSource.forEach((recipe) => {
    console.log(`Missing from source, left alone: #${recipe.id} ${recipe.name} (${recipe.sourcePath})`);
  });
}

async function main() {
  const options = readOptions();
  const recipes = loadRecipes(options.filePath);

  if (options.validateOnly) {
    console.log(`Validated ${recipes.length} recipe(s) from ${path.relative(process.cwd(), options.filePath)}.`);
    return;
  }

  const existingRecipes = await api<Array<Recipe | null>>(`${options.apiBaseUrl}/api/recipes`);
  const existing = existingRecipes.filter((recipe): recipe is Recipe => Boolean(recipe));

  if (options.sync) {
    const plan = planSync(recipes, existing);
    console.log(`Validated ${recipes.length} recipe(s) from ${path.relative(process.cwd(), options.filePath)}.`);
    printSyncPlan(plan);

    if (plan.nameConflicts.length > 0) {
      console.log("Resolve name conflicts before committing sync.");
      return;
    }
    if (!options.commit) {
      console.log("Dry run only. Re-run with --sync --commit to create and update recipes.");
      return;
    }

    for (const recipe of plan.newRecipes) {
      const created = await api<Recipe>(`${options.apiBaseUrl}/api/recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe)
      });
      console.log(`Created #${created.id}: ${created.name}`);
    }
    for (const { existing: existingRecipe, recipe } of plan.changedRecipes) {
      const updated = await api<Recipe>(`${options.apiBaseUrl}/api/recipes/${existingRecipe.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe)
      });
      console.log(`Updated #${updated.id}: ${updated.name}`);
    }
    return;
  }

  const existingNames = new Set(
    existing.map((recipe) => recipeKey(recipe.name))
  );

  const toImport = recipes.filter((recipe) => !options.skipExisting || !existingNames.has(recipeKey(recipe.name)));
  const skipped = recipes.length - toImport.length;

  console.log(`Validated ${recipes.length} recipe(s) from ${path.relative(process.cwd(), options.filePath)}.`);
  console.log(`${toImport.length} new recipe(s), ${skipped} skipped as existing by name.`);

  if (!options.commit) {
    console.log("Dry run only. Re-run with --commit to create recipes.");
    return;
  }

  for (const recipe of toImport) {
    const created = await api<Recipe>(`${options.apiBaseUrl}/api/recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipe)
    });
    console.log(`Created #${created.id}: ${created.name}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
