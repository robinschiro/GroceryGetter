# Grocery Getter Agent Guidance

## Project Shape
- This is a local grocery planning app with a React/Vite frontend in `src/` and an Express API in `server/`.
- The app manages recipes, generates weekly menus, aggregates shopping lists, and can connect to QFC/Kroger APIs.
- Local data is persisted with `sql.js` in `data/grocery-getter.sqlite`. Treat files in `data/` as user data unless a task explicitly asks to reset or migrate them.
- API setup and Kroger/QFC notes live in `docs/`.

## Commands
- Install dependencies: `npm install`
- Start frontend and API together: `npm run dev`
- Start API only: `npm run dev:api`
- Start web only: `npm run dev:web`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Preview production build: `npm run preview`

## Codex Shell Environment
- Do not assume `npm` or `node` are installed globally or available on `PATH` in the Codex PowerShell session.
- Use the Codex-managed Node binary when running project tools: `C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`.
- Prefer invoking local package binaries through that Node binary, for example:
  - Typecheck: `& 'C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\typescript\bin\tsc --noEmit`
  - Vite: `& 'C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vite\bin\vite.js`
  - TSX: `& 'C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\tsx\dist\cli.mjs`
- If a command needs `.cmd` shims, first prepend the managed Node directory to `PATH` for that PowerShell command.

## Development Notes
- The API listens on `127.0.0.1:5174`; Vite serves the frontend on `127.0.0.1`.
- Keep frontend requests relative to `/api/...` so Vite proxy behavior remains simple.
- Use existing TypeScript types and recipe/category naming conventions: `entree`, `vegetable_side`, and `starch_side`.
- Prefer small, focused changes. Avoid broad refactors unless they are needed for the requested behavior.
- Preserve local secrets, OAuth tokens, and saved settings. Do not print credentials or write them into docs.
- When touching QFC/Kroger behavior, review `docs/qfc-api-setup.md`, `docs/kroger-api-notes.md`, and `server/qfcAdapter.ts`.

## Verification
- Run `npm run typecheck` for TypeScript-only changes.
- Before attempting a Vite build in Codex, check whether the app is already running:
  - Frontend: `Invoke-WebRequest -Uri http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2`
  - API: `Invoke-WebRequest -Uri http://127.0.0.1:5174/api/recipes -UseBasicParsing -TimeoutSec 2`
- If both servers are already responding, prefer browser or endpoint verification against the running app instead of forcing a local build in the constrained Codex shell.
- Run `npm run build` before finishing changes that affect runtime behavior or frontend code.
- If changing API routes or persistence logic, exercise the affected endpoint or workflow when practical.
