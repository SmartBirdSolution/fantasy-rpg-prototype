---
name: git-push
description: Push committed changes to the remote repository. Use this skill when the user asks to push, deploy, or publish changes. Always ensure git-commit has been run first.
tools: Bash
---

# Git Push

Push the current branch to its remote and confirm the result.

## Workflow

### Step 1 — Pre-push checks
Run these in parallel:
```bash
git status
```
```bash
git log --oneline origin/HEAD..HEAD 2>/dev/null || git log --oneline -5
```
```bash
git remote -v
```

Verify:
- Working tree is clean (all changes committed — if not, stop and run `/git-commit` first)
- There are commits ahead of the remote to push
- A remote named `origin` exists

### Step 2 — Push
If the branch has an upstream set:
```bash
git push
```

If this is the first push for a new branch:
```bash
git push -u origin <branch-name>
```

### Step 3 — Confirm
```bash
git log --oneline origin/<branch>..HEAD 2>/dev/null; echo "Push complete"
```
Report the remote URL and how many commits were pushed.

## Rules
- **Never force-push to main/master** — warn the user if they request it
- Never use `--force` unless the user has explicitly requested it and understands the consequence
- If the working tree is dirty (uncommitted changes exist), stop and tell the user to run `/git-commit` first
- If no remote is configured, tell the user to set one up (`git remote add origin <url>`) before pushing
- Do not push if the pre-push check shows 0 commits ahead of remote — nothing to push

## Deployment note
After a successful push to `main`/`master`, remind the user to restart the game server if the server-side code (`server.js`) was among the pushed changes:
```
node server.js
```
