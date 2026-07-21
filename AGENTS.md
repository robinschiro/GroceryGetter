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
- Use Vite's native config loader in Codex (`--configLoader native`). The default bundled config loader invokes esbuild while loading `vite.config.*`, and this sandbox can deny esbuild reads above the workspace.

## Git Commits and Pushes from Codex
- Do not run `git add` or `git commit` directly from the Codex shell. Write a gitignored `.codex-git-commit.json` manifest containing a single-line `commitMessage` string and a `paths` array of repository-relative paths, then use this exact standalone command: `& .\scripts\git-commit.ps1`.
- Invoke the commit wrapper without chaining, prefixes, suffixes, or surrounding PowerShell logic. A narrow Codex rule allows this exact command to run outside the sandbox so Git can update protected `.git` files. The wrapper removes the manifest after every attempt and refuses `.git`, `.env*`, `data/`, absolute paths, and path traversal.
- Do not run `git push` directly from the Codex shell. Use the repository wrapper with this exact standalone command: `& .\scripts\git-push.ps1`.
- Invoke the wrapper without chaining, prefixes, suffixes, or surrounding PowerShell logic. A narrow Codex rule allows this exact command to run outside the sandbox so Git can update protected `.git` tracking refs.
- The wrapper supports both the Codex-managed Git layout and the normal Windows Git installation, avoids the broken Schannel path, and restricts credentials to `https://github.com/robinschiro/GroceryGetter.git`.
- The wrapper reads `GITHUB_USERNAME` and `GITHUB_PAT` from the gitignored `.env`. Never print, log, stage, commit, or ask the user to paste these values into chat.
- If `.env` is missing or the wrapper rejects its configuration, stop and ask the user to configure it locally. Do not fall back to embedding credentials in a remote URL, command argument, tracked file, or general application settings.
- After a successful wrapper push, verify that local `HEAD` and local `origin/<branch>` agree. Do not separately check GitHub or query the remote after every successful push unless the wrapper output is ambiguous or the user explicitly asks for remote verification. Treat `.env` as a local secret and leave it untracked.

## Development Notes
- The API listens on `127.0.0.1:5174`; Vite serves the frontend on `127.0.0.1`.
- Keep frontend requests relative to `/api/...` so Vite proxy behavior remains simple.
- Use existing TypeScript types and recipe/category naming conventions: `entree`, `vegetable_side`, and `starch_side`.
- Prefer small, focused changes. Avoid broad refactors unless they are needed for the requested behavior.
- Preserve local secrets, OAuth tokens, and saved settings. Do not print credentials or write them into docs.
- When touching QFC/Kroger behavior, review `docs/qfc-api-setup.md`, `docs/kroger-api-notes.md`, and `server/qfcAdapter.ts`.

## User Shorthands
- If the user sends exactly `c`, treat it as: review the current git diff, summarize the intended commit, then create a git commit with an appropriate message.
- If the user sends exactly `cp`, treat it as: do everything for `c`, then push the resulting commit to the current branch using the exact standalone wrapper command documented under "Git Pushes from Codex."
- If the user sends exactly `rsd`, treat it as: run the Dropbox recipe sync dry run for `imports/dropbox-recipes/parsed-recipes.json`. First validate the JSON with `scripts/import-recipes.ts --validate-only`, then run `scripts/import-recipes.ts --sync` without `--commit` against the local API. Report new, changed, unchanged, name-conflict, and missing-source recipes. Do not create, update, or delete recipes.
- Before committing, run the relevant verification for the touched files when practical.
- Never include unrelated work in the commit. If unrelated changes are present, leave them unstaged and mention them.
- Do not push if the commit fails, verification fails, or the branch/upstream state is unclear; explain the blocker instead.

## Verification
- Run `npm run typecheck` for TypeScript-only changes.
- Before attempting a Vite build in Codex, check whether the app is already running:
  - Frontend: `Invoke-WebRequest -Uri http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2`
  - API: `Invoke-WebRequest -Uri http://127.0.0.1:5174/api/recipes -UseBasicParsing -TimeoutSec 2`
- If both servers are already responding, prefer browser or endpoint verification against the running app instead of forcing a local build in the constrained Codex shell.
- Run `npm run build` before finishing changes that affect runtime behavior or frontend code.
- If changing API routes or persistence logic, exercise the affected endpoint or workflow when practical.
