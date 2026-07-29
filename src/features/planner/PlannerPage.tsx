import type { ComponentProps } from "react";
import { StoreItemReviewPanel } from "../qfc/StoreItemReviewPanel.js";
import { MenuBuilder } from "./MenuBuilder.js";
import { ShoppingListReview } from "./ShoppingListReview.js";

export function PlannerPage({
  menuBuilder,
  shoppingListReview,
  storeItemReview
}: {
  menuBuilder: ComponentProps<typeof MenuBuilder>;
  shoppingListReview: ComponentProps<typeof ShoppingListReview>;
  storeItemReview: ComponentProps<typeof StoreItemReviewPanel>;
}) {
  return (
    <div className="grid planner-grid">
      <MenuBuilder {...menuBuilder} />
      <ShoppingListReview {...shoppingListReview} />
      <StoreItemReviewPanel {...storeItemReview} />
    </div>
  );
}
