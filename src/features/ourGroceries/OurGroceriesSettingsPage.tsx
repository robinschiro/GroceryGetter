import { Link2, RefreshCw, Settings, Unplug } from "lucide-react";
import { useState } from "react";
import type {
  DataScope,
  OurGroceriesListSummary,
  OurGroceriesStatus
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import {
  disconnectOurGroceries,
  saveDefaultOurGroceriesList,
  connectOurGroceries
} from "./api.js";
import "./styles.css";

export function OurGroceriesSettingsPage({
  api,
  dataScope,
  status,
  lists,
  refresh
}: {
  api: ApiRequest;
  dataScope: DataScope;
  status: OurGroceriesStatus | null;
  lists: OurGroceriesListSummary[];
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OurGroceries request failed.");
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    void run(async () => {
      await connectOurGroceries(api, email, password);
      setPassword("");
      await refresh();
    });
  }

  function disconnect() {
    if (!window.confirm("Disconnect Grocery Getter from OurGroceries? Saved menu snapshots will remain available.")) return;
    void run(async () => {
      await disconnectOurGroceries(api);
      await refresh();
    });
  }

  function updateDefault(listId: string) {
    void run(async () => {
      await saveDefaultOurGroceriesList(api, listId || null);
      await refresh();
    });
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Settings size={18} />
        <h3>OurGroceries Settings</h3>
      </div>

      {dataScope === "sandbox" ? (
        <div className="sandbox-notice">
          Sandbox can use the shared read-only connection, but connection changes require production mode.
        </div>
      ) : null}

      <div className="status-strip">
        <span className={status?.connected ? "status-good" : "status-muted"}>
          {status?.connected ? "Connected" : "Not connected"}
        </span>
        <span className={status?.hasStoredCredentials ? "status-good" : "status-muted"}>
          {status?.accountLabel || "Credentials not stored"}
        </span>
        <span className={status?.defaultList ? "status-good" : "status-muted"}>Default list</span>
      </div>

      <div className="qfc-grid">
        <label>
          OurGroceries email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={dataScope === "sandbox" || busy}
          />
        </label>
        <label>
          OurGroceries password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={status?.hasStoredCredentials ? "Enter password to reconnect" : ""}
            disabled={dataScope === "sandbox" || busy}
          />
        </label>
        <label className="wide-field">
          Default list for new menus
          <select
            aria-label="Default OurGroceries list"
            value={status?.defaultList?.id ?? ""}
            onChange={(event) => updateDefault(event.target.value)}
            disabled={!status || busy}
          >
            <option value="">No default</option>
            {status?.defaultList && !lists.some((list) => list.id === status.defaultList?.id) ? (
              <option value={status.defaultList.id}>{status.defaultList.name} (unavailable)</option>
            ) : null}
            {lists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
          </select>
        </label>
      </div>

      {status?.defaultList && !status.defaultListAvailable ? (
        <div className="message error" role="alert">
          The saved default list is not currently available. Choose another list or clear the default.
        </div>
      ) : null}
      {error ? <div className="message error" role="alert">{error}</div> : null}
      <p className="helper-text">
        Grocery Getter stores these credentials only in its local database and never returns the password to the browser.
        OurGroceries does not publish this private web API, so a future service update may require an adapter update.
      </p>

      <div className="panel-actions">
        <button className="secondary" onClick={() => void run(refresh)} disabled={busy}>
          <RefreshCw size={17} /> Refresh lists
        </button>
        <button onClick={connect} disabled={dataScope === "sandbox" || busy || !email.trim() || !password}>
          <Link2 size={17} /> {status?.connected ? "Update credentials" : "Connect OurGroceries"}
        </button>
        <button className="secondary" onClick={disconnect} disabled={dataScope === "sandbox" || !status?.connected || busy}>
          <Unplug size={17} /> Disconnect
        </button>
      </div>

      <div className="result-list ourgroceries-list" aria-label="OurGroceries shopping lists">
        {lists.map((list) => (
          <a
            className="result-row ourgroceries-list-row"
            href={list.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${list.name} in OurGroceries`}
            key={list.id}
          >
            <strong>{list.name}</strong>
            <span>Open in OurGroceries</span>
          </a>
        ))}
      </div>
    </section>
  );
}
