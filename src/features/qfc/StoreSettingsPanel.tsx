import { useEffect, useState } from "react";
import { Check, RefreshCw, Send, Settings } from "lucide-react";
import type {
  DataScope,
  QfcLocation,
  QfcStatus,
  StoreItemCandidate,
  StoreItemPreference
} from "../../../shared/contracts/index.js";
import type { QfcSettingsTab } from "../../app/router.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import {
  refreshCustomerOAuth as refreshCustomerOAuthRequest,
  saveQfcSettings,
  searchQfcLocations,
  searchQfcStoreItems,
  startCustomerOAuth as startCustomerOAuthRequest
} from "./api.js";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function browserQfcCallbackUri() {
  return `${window.location.origin}/api/qfc/oauth/callback`;
}

export function StoreSettingsPanel({
  api,
  activeTab,
  onTabChange,
  status,
  dataScope,
  reloadStatus,
  preferStoreBrands,
  updateStoreBrandPreference,
  allowRealQfcCartMutation,
  updateRealQfcCartPermission,
  storeItemPreferences,
  forgetStoreItemPreference
}: {
  api: ApiRequest;
  activeTab: QfcSettingsTab;
  onTabChange: (tab: QfcSettingsTab) => void;
  status: QfcStatus | null;
  dataScope: DataScope;
  reloadStatus: () => Promise<void>;
  preferStoreBrands: boolean;
  updateStoreBrandPreference: (next: boolean) => Promise<void>;
  allowRealQfcCartMutation: boolean;
  updateRealQfcCartPermission: (next: boolean) => Promise<void>;
  storeItemPreferences: StoreItemPreference[];
  forgetStoreItemPreference: (provider: string, ingredientKey: string) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [locationId, setLocationId] = useState("");
  const [serviceScopes, setServiceScopes] = useState("product.compact");
  const [customerScopes, setCustomerScopes] = useState("cart.basic:write");
  const [redirectUri, setRedirectUri] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locations, setLocations] = useState<QfcLocation[]>([]);
  const [storeItemTerm, setStoreItemTerm] = useState("");
  const [storeItems, setStoreItems] = useState<StoreItemCandidate[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!status) return;
    setClientId(status.clientId);
    setLocationId(status.locationId);
    setServiceScopes(status.serviceScopes);
    setCustomerScopes(status.customerScopes);
    setRedirectUri(isLoopbackHost(window.location.hostname) ? status.redirectUri : browserQfcCallbackUri());
  }, [status]);

  async function saveSettings() {
    setError("");
    try {
      await saveQfcSettings(api, dataScope === "sandbox"
        ? { locationId }
        : {
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
          locationId,
          serviceScopes,
          customerScopes,
          redirectUri
        });
      setClientId(clientId.trim());
      setLocationId(locationId.trim());
      setClientSecret("");
      await reloadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save QFC settings.");
    }
  }

  async function startCustomerOAuth() {
    setError("");
    try {
      const nextRedirectUri = isLoopbackHost(window.location.hostname)
        ? redirectUri.trim()
        : browserQfcCallbackUri();
      if (nextRedirectUri && nextRedirectUri !== status?.redirectUri) {
        await saveQfcSettings(api, { redirectUri: nextRedirectUri });
        setRedirectUri(nextRedirectUri);
      }
      const result = await startCustomerOAuthRequest(api);
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start customer OAuth.");
    }
  }

  async function refreshCustomerOAuth() {
    setError("");
    try {
      await refreshCustomerOAuthRequest(api);
      await reloadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh customer OAuth.");
    }
  }

  async function findLocations() {
    setError("");
    try {
      setLocations(await searchQfcLocations(api, locationQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search locations.");
    }
  }

  async function findStoreItems() {
    setError("");
    try {
      const trimmedLocationId = locationId.trim();
      if (trimmedLocationId) {
        await saveLocationId(trimmedLocationId);
      }
      setStoreItems(await searchQfcStoreItems(api, storeItemTerm, trimmedLocationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search store items.");
    }
  }

  async function saveLocationId(nextLocationId: string) {
    await saveQfcSettings(api, { locationId: nextLocationId });
    setLocationId(nextLocationId);
    await reloadStatus();
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Settings size={18} />
        <h3>QFC Settings</h3>
      </div>

      <div className="sub-tabs" role="tablist" aria-label="QFC settings sections">
        <button
          className={`sub-tab-button ${activeTab === "api" ? "active" : ""}`}
          onClick={() => onTabChange("api")}
          role="tab"
          aria-selected={activeTab === "api"}
          type="button"
        >
          QFC API Setup
        </button>
        <button
          className={`sub-tab-button ${activeTab === "preferences" ? "active" : ""}`}
          onClick={() => onTabChange("preferences")}
          role="tab"
          aria-selected={activeTab === "preferences"}
          type="button"
        >
          Store Item Preferences
        </button>
      </div>

      {activeTab === "api" ? (
        <div className="tab-panel" role="tabpanel">
          {dataScope === "sandbox" ? (
            <div className="sandbox-notice">
              Sandbox uses the real QFC catalog and shared connection. Credentials and OAuth can only be changed in production.
            </div>
          ) : null}
          <div className="status-strip">
            <span className={status?.hasClientId ? "status-good" : "status-muted"}>Client ID</span>
            <span className={status?.hasClientSecret ? "status-good" : "status-muted"}>Client secret</span>
            <span className={status?.locationId ? "status-good" : "status-muted"}>Location</span>
            <span className={status?.hasCustomerAccessToken ? "status-good" : "status-muted"}>Customer OAuth</span>
            <span className={status?.hasCustomerRefreshToken ? "status-good" : "status-muted"}>Refresh token</span>
          </div>

          <div className="qfc-grid">
            <label>
              Client ID
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label>
              Client secret
              <input
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={status?.hasClientSecret ? "Already saved" : ""}
                type="password"
                disabled={dataScope === "sandbox"}
              />
            </label>
            <label>
              Location ID
              <input value={locationId} onChange={(event) => setLocationId(event.target.value)} />
            </label>
            <label>
              Service scopes
              <input value={serviceScopes} onChange={(event) => setServiceScopes(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label>
              Customer scopes
              <input value={customerScopes} onChange={(event) => setCustomerScopes(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label className="wide-field">
              Redirect URI
              <input value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
          </div>

          <div className="panel-actions">
            <button className="secondary" onClick={() => void reloadStatus()}>
              <RefreshCw size={17} />
              Refresh status
            </button>
            <button className="secondary" onClick={() => void refreshCustomerOAuth()} disabled={dataScope === "sandbox"}>
              <RefreshCw size={17} />
              Refresh OAuth
            </button>
            <button onClick={() => void startCustomerOAuth()} disabled={dataScope === "sandbox"}>
              <Send size={17} />
              Start customer OAuth
            </button>
            <button onClick={() => void saveSettings()}>
              <Check size={17} />
              {dataScope === "sandbox" ? "Save sandbox location" : "Save QFC settings"}
            </button>
          </div>

          <div className="qfc-tools">
            <div>
              <div className="tool-row">
                <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search locations by ZIP" />
                <button className="secondary" onClick={() => void findLocations()}>Find locations</button>
              </div>
              <div className="result-list">
                {locations.map((location) => (
                  <button
                    className="result-row"
                    key={location.locationId}
                    onClick={() => void saveLocationId(location.locationId)}
                  >
                    <strong>{location.name}</strong>
                    <span>{location.locationId}</span>
                    <span>{[location.address?.addressLine1, location.address?.city, location.address?.state].filter(Boolean).join(", ")}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="tool-row">
                <input value={storeItemTerm} onChange={(event) => setStoreItemTerm(event.target.value)} placeholder="Search store items" />
                <button className="secondary" onClick={() => void findStoreItems()}>Find store items</button>
              </div>
              <div className="result-list">
                {storeItems.map((storeItem) => (
                  <div className="store-item-row" key={`${storeItem.productId}-${storeItem.upc}`}>
                    <strong>{storeItem.description}</strong>
                    <span>{[storeItem.brand, storeItem.size, storeItem.stockLevel].filter(Boolean).join(" / ")}</span>
                    <span>{storeItem.price === null ? "" : `$${storeItem.price.toFixed(2)}`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error ? <div className="error">{error}</div> : null}
        </div>
      ) : (
        <div className="tab-panel" role="tabpanel">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={preferStoreBrands}
              onChange={(event) => void updateStoreBrandPreference(event.target.checked)}
            />
            <span>Prefer store brands when an ingredient has no remembered store item</span>
          </label>
          <label className={`toggle-row ${dataScope === "sandbox" ? "sandbox-cart-toggle" : ""}`}>
            <input
              type="checkbox"
              checked={allowRealQfcCartMutation}
              onChange={(event) => void updateRealQfcCartPermission(event.target.checked)}
            />
            <span>
              Allow this {dataScope} mode to add reviewed items to the real QFC cart
            </span>
          </label>
          <div className="store-item-preference-section">
            <div>
              <h4>Remembered store items</h4>
              <p>Selections made during store item review are reused whenever the same ingredient appears again.</p>
            </div>
            {storeItemPreferences.length ? (
              <div className="store-item-preference-list">
                {storeItemPreferences.map((preference) => (
                  <div className="store-item-preference-row" key={preference.ingredientKey}>
                    <div>
                      <strong>{preference.ingredientName}</strong>
                      <span>{preference.description}</span>
                      <span>{[preference.brand, preference.size].filter(Boolean).join(" · ")}</span>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void forgetStoreItemPreference(preference.provider, preference.ingredientKey)}
                      type="button"
                    >
                      Forget
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No store item choices have been remembered yet.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
