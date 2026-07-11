# Grocery Getter dev setup

This app has two local development servers:

- Vite web app on port `5173`
- Express API on port `5174`

For normal local development, open the app at:

```text
http://localhost:5173/
```

For testing from another device on the same LAN, run the LAN startup script and open the host computer's LAN IP:

```powershell
.\scripts\start-lan.ps1
```

Example LAN URL:

```text
http://192.168.0.56:5173/
```

## Windows Firewall for LAN access

Vite must listen on all network interfaces for another computer, phone, or tablet on the LAN to reach it. The LAN startup script uses `vite.lan.config.mjs`, which binds Vite to `0.0.0.0` on port `5173`. The Express API can stay bound to `127.0.0.1:5174` because the browser talks to Vite, and Vite proxies `/api` requests to the local API process.

Windows Firewall may still block inbound traffic to Vite even when Vite is listening correctly. In this project, the difficult case was an explicit inbound `node.exe` block rule. A port allow rule existed, but Windows block rules override allow rules, so remote devices still could not connect until the `node.exe` block rule was disabled.

Run these commands in an Administrator PowerShell on the host computer.

First, allow inbound TCP traffic to the Vite dev port:

```powershell
netsh advfirewall firewall add rule name="Grocery Getter Vite 5173" dir=in action=allow protocol=TCP localport=5173 profile=any
```

If remote devices still cannot connect, check for a blocking `node.exe` rule:

```powershell
netsh advfirewall firewall show rule name="node.exe" verbose
```

If the rule points at the Node executable used to run the app and has `Action: Block`, disable the inbound block rules:

```powershell
netsh advfirewall firewall set rule name="node.exe" dir=in protocol=TCP new enable=no
netsh advfirewall firewall set rule name="node.exe" dir=in protocol=UDP new enable=no
```

Verify from another computer on the same LAN:

```powershell
Test-NetConnection 192.168.0.56 -Port 5173
```

Replace `192.168.0.56` with the host computer's LAN IP. A working setup reports:

```text
TcpTestSucceeded : True
```

If the test only works while Windows Firewall is disabled, local firewall rules may not be applied. In Local Group Policy Editor, enable these settings under both `Domain Profile` and `Standard Profile`:

- `Windows Defender Firewall: Allow local port exceptions`
- `Windows Defender Firewall: Define inbound port exceptions`

Use this inbound port exception value:

```text
5173:TCP:*:enabled:Grocery Getter Vite
```

Then apply policy:

```powershell
gpupdate /force
```

## Dependencies on a new computer

Install Node.js first. Use a current LTS or newer version that supports this app's tooling. The app has been run successfully with Node `24.x`; Node `22.x` LTS should also work.

From the project root, install npm dependencies from the lockfile:

```powershell
npm ci
```

The important npm packages are recorded in `package.json` and `package-lock.json`. They include:

- React and React DOM for the frontend
- Vite and `@vitejs/plugin-react` for the dev server and build
- Express for the API server
- `tsx` for running the TypeScript API in development
- `concurrently` for running Vite and the API together
- `sql.js` for the local database layer

After installing dependencies, run a quick verification:

```powershell
npm run typecheck
```

Start local-only development with:

```powershell
npm run dev
```

Start LAN development with:

```powershell
.\scripts\start-lan.ps1
```

Leave the PowerShell window open while using the app. If `scripts\start-lan.ps1` reports that ports `5173` or `5174` are already in use, stop the existing Grocery Getter server before starting a new one.

## Notes for Codex desktop

Codex can run the app in a foreground tool call, but long-running detached Windows processes may not stay alive reliably from the Codex sandbox. For LAN testing from a phone or another computer, start `scripts\start-lan.ps1` in your own PowerShell window and leave it running while Codex edits files.
