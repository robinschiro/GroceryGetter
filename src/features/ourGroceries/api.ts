import type {
  OurGroceriesListSummary,
  OurGroceriesStatus
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export function loadOurGroceriesStatus(api: ApiRequest) {
  return api<OurGroceriesStatus>("/api/ourgroceries/status");
}

export function listOurGroceriesLists(api: ApiRequest) {
  return api<OurGroceriesListSummary[]>("/api/ourgroceries/lists");
}

export function connectOurGroceries(api: ApiRequest, email: string, password: string) {
  return api<OurGroceriesStatus>("/api/ourgroceries/connection", {
    method: "PUT",
    body: JSON.stringify({ email, password })
  });
}

export function disconnectOurGroceries(api: ApiRequest) {
  return api<{ disconnected: true }>("/api/ourgroceries/connection", { method: "DELETE" });
}

export function saveDefaultOurGroceriesList(api: ApiRequest, listId: string | null) {
  return api<{ defaultList: OurGroceriesListSummary | null }>("/api/ourgroceries/default-list", {
    method: "PUT",
    body: JSON.stringify({ listId })
  });
}
