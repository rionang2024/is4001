# Working on Question A inside the team's existing repo with Claude Code

Claude Code runs on your computer, so it can read the large `dashboard_data/` folder that is too big for a chat or for GitHub.
Official docs: https://code.claude.com/docs/en/overview and https://code.claude.com/docs/en/quickstart

## 1. Get the existing repo and make a branch
```
git clone <the team's repo URL>
cd <repo>
git checkout -b qa/integration
```
Do not work on `main`. Open pull requests so the Question B side can review.

## 2. Add this pack
Copy the contents of this pack into the repo (names chosen so nothing existing is overwritten):
- `docs/` -> `docs/qa/` (so you have `docs/qa/QA_CONTEXT.md`, `TASKS.md`, `DATA_CONTRACT.md`, `dashboard_data_README.md`, `assets/`)
- `reference-prototype/` -> `docs/qa/reference-prototype/` (reference code to port, not part of the site)
- Add the lines in `gitignore-additions.txt` to the repo's existing `.gitignore`.
If the repo already has a `CLAUDE.md`, leave it alone. Add one line to it: "Question A context: docs/qa/QA_CONTEXT.md".
If it has none, add a `CLAUDE.md` containing only that line.

## 3. Put the data next to the code (not in git)
Copy the data package so the folder looks like `dashboard_data/minute/floor=1/month=2018-10/part-00000.parquet`.
Share it with the team through Drive. If Question B already keeps its data somewhere, use the same place and tell Claude Code.

## 4. Install Claude Code
Needs a Claude subscription or a Console account.
- macOS, Linux, WSL: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Homebrew: `brew install --cask claude-code`

## 5. Start it in the repo and paste this
```
cd <repo>
claude
```
> Read CLAUDE.md, then docs/qa/QA_CONTEXT.md, docs/qa/TASKS.md and docs/qa/DATA_CONTRACT.md. Do T0 only: audit this repo as described, look at the Parquet files in
> dashboard_data/ and tell me their real schema and how zone and end_use are encoded, then ask me the open questions at the bottom of TASKS.md.
> Do not change any files yet.

After you approve the plan, ask it to do T1, T2 and T3 one at a time, each on its own branch and pull request.

## Tips
- Tell Claude Code to run the site and take screenshots (desktop, phone width, dark mode) before it calls a task done.
- If the site's stack differs from the prototype's (for example React or Next.js), ask it to wrap `building.js` and each chart as a component first, and to port only if wrapping is awkward.
- Claude Code on the web (claude.ai/code) works from a GitHub repo but cannot see your local `dashboard_data/`; use the local version for this.
