export type CartSubmissionItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
};

export type CartSubmissionResult = {
  mode: "stub";
  submittedItemCount: number;
  message: string;
  items: CartSubmissionItem[];
};

export async function submitToQfcCart(items: CartSubmissionItem[]): Promise<CartSubmissionResult> {
  return {
    mode: "stub",
    submittedItemCount: items.length,
    message: "QFC cart submission is stubbed until the product/search/cart API is implemented.",
    items
  };
}
