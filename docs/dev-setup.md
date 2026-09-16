# Grocery Getter dev setup

This app has two local development servers:

- Vite web app on port `5173`
- Express API on port `5174`

The existing native scripts remain the default development workflow. Docker is an additional option; do not run the native and Docker workflows at the same time because they use the same ports and database file.

See [architecture.md](architecture.md) for module ownership, dependency rules, disposable-test guarantees, and the full verification commands.

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
npm run setup:browsers
```

The browser setup command installs Playwright's Chromium binary in the gitignored
`.cache/ms-playwright` directory inside this workspace. Run it again after upgrading
Playwright to ensure the matching browser version is available.

The important npm packages are recorded in `package.json` and `package-lock.json`. They include:

- React and React DOM for the frontend
- Vite and `@vitejs/plugin-react` for the dev server and build
- Express for the API server
- `tsx` for running the TypeScript API in development
- `concurrently` for running Vite and the API together
- `sql.js` for the local database layer
- Playwright and its workspace-local Chromium binary for browser tests

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

## Docker

Install Docker Desktop on Windows from an Administrator PowerShell if it is not already installed:

```powershell
winget install --exact --id Docker.DockerDesktop
```

Windows build `26200` currently has a [Docker Desktop startup regression](https://github.com/docker/desktop-feedback/issues/554) involving inaccessible AF_UNIX socket files. On affected computers, install Docker Desktop `4.69.0` and leave automatic Docker Desktop updates disabled until the regression is fixed:

```powershell
winget install --exact --id Docker.DockerDesktop --version 4.69.0
```

Docker Desktop uses the WSL 2 backend. Its installer may require an administrator prompt, Windows restart, or first-run setup. After Docker Desktop is running, verify both commands:

```powershell
docker version
docker compose version
```

Before the first containerized run, make a backup of the existing database:

```powershell
Copy-Item .\data\grocery-getter.sqlite .\data\grocery-getter.before-docker.sqlite
```

The backup remains ignored by Git. Production uses an Nginx frontend container and a private Express API container:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f
```

Open `http://localhost:5173/` locally or use the computer's LAN IP from another device. Only port `5173` is published in production. Stop the stack with:

```powershell
docker compose down
```

For containerized development with Vite and API live reload, use the separate development Compose file:

```powershell
docker compose -f compose.dev.yaml up --build --watch
```

Compose Watch synchronizes source changes into the containers' Linux filesystems, avoiding slow Windows-to-WSL bind-mounted source access and polling. Dependency changes rebuild the development images automatically. Only the API container receives a writable `data/` bind mount. Vite is available on LAN port `5173`; the API is also available locally at `http://127.0.0.1:5174` for debugging. Stop it with:

```powershell
docker compose -f compose.dev.yaml down
```

Both Docker workflows use the existing `data/grocery-getter.sqlite`. Stop all native Grocery Getter processes before starting Docker, and stop Docker before returning to `scripts\dev.ps1` or `scripts\start-lan.ps1`.

To benchmark the built production containers, run:

```powershell
npm run test:perf:docker:production
```

This starts an isolated production Compose project on `http://127.0.0.1:5183`, benchmarks it with the same Playwright performance suite, and tears it down afterward. The benchmark uses a temporary copy of `data/grocery-getter.sqlite`, so it does not write to the live database. Set `PERF_DOCKER_PORT` to use a different host port.

## Notes for Codex desktop

Codex can run the app in a foreground tool call, but long-running detached Windows processes may not stay alive reliably from the Codex sandbox. For LAN testing from a phone or another computer, start `scripts\start-lan.ps1` in your own PowerShell window and leave it running while Codex edits files.
