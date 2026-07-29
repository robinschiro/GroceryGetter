import type { ComponentProps, ReactNode } from "react";
import { MenuBuilder } from "./MenuBuilder.js";
import { ShoppingListReview } from "./ShoppingListReview.js";

export function PlannerPage({
  menuBuilder,
  shoppingListReview,
  storeItemReview
}: {
  menuBuilder: ComponentProps<typeof MenuBuilder>;
  shoppingListReview: ComponentProps<typeof ShoppingListReview>;
  storeItemReview: ReactNode;
}) {
  return (
    <div className="grid planner-grid">
      <MenuBuilder {...menuBuilder} />
      <ShoppingListReview {...shoppingListReview} />
      {storeItemReview}
    </div>
  );
}
