export function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) {
    const whole = Number(parts[0]);
    const fraction = parseQuantity(parts[1]);
    if (Number.isFinite(whole) && fraction !== null) return whole + fraction;
  }

  if (trimmed.includes("/")) {
    const [numerator, denominator] = trimmed.split("/").map(Number);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatQuantity(value: number) {
  if (Number.isInteger(value)) return String(value);

  const commonFractions = [
    [0.25, "1/4"],
    [0.33, "1/3"],
    [0.5, "1/2"],
    [0.67, "2/3"],
    [0.75, "3/4"]
  ] as const;
  const whole = Math.floor(value);
  const remainder = value - whole;
  const match = commonFractions.find(([decimal]) => Math.abs(remainder - decimal) < 0.01);

  if (match) return whole > 0 ? `${whole} ${match[1]}` : match[1];
  return Number(value.toFixed(2)).toString();
}

const irregularIngredientSingulars: Record<string, string> = {
  berries: "berry",
  brownies: "brownie",
  cookies: "cookie",
  halves: "half",
  knives: "knife",
  leaves: "leaf",
  loaves: "loaf",
  pies: "pie",
  potatoes: "potato",
  smoothies: "smoothie",
  tomatoes: "tomato",
  veggies: "veggie"
};

const ingredientWordsEndingInS = new Set([
  "asparagus",
  "couscous",
  "hummus",
  "molasses"
]);

function singularizeIngredientWord(word: string) {
  const irregular = irregularIngredientSingulars[word];
  if (irregular) return irregular;
  if (ingredientWordsEndingInS.has(word)) return word;
  if (word.endsWith("oes") && word.length > 4) return word.slice(0, -2);
  if (/(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("s") && !/(?:ss|us|is|ous)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function normalizeAggregateItem(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const [name, ...qualifiers] = normalized.split(",");
  const singularName = name.replace(
    /[a-z]+(?=[^a-z]*$)/,
    (word) => singularizeIngredientWord(word)
  );
  return [singularName, ...qualifiers].join(",");
}
