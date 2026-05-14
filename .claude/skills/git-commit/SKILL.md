---
name: git-commit
description: Stage and commit all current changes to git. Use this skill whenever the user asks to commit, save progress, or checkpoint work. Always run this before git-push.
tools: Bash
---

# Git Commit

Create a well-formed git commit for all current changes in the repository.

## Workflow

### Step 1 — Inspect current state
Run these in parallel:
```bash
git status
```
```bash
git diff
```
```bash
git log --oneline -5
```

### Step 2 — Analyze changes
Review the diff output and determine:
- What type of change is this? (feat / fix / refactor / chore / docs)
- Which system or file was primarily affected?
- What is the "why" — the user-facing reason for the change?

### Step 3 — Stage files
Stage changed and new files by name. Prefer explicit paths over `git add -A` to avoid accidentally including `.env` or large binaries:
```bash
git add <specific files or directories>
```
If all changes are safe and intentional, staging everything is acceptable:
```bash
git add -A
```

### Step 4 — Write and create the commit
Commit message rules:
- First line: max 72 chars, imperative mood ("Add X", "Fix Y", "Update Z")
- Focus on the **why**, not just the what
- No bullet lists in the subject line
- Always append the Co-Authored-By trailer

```bash
git commit -m "$(cat <<'EOF'
<subject line here>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Step 5 — Confirm
```bash
git status
git log --oneline -3
```
Report the commit hash and message to the user.

## Rules
- Never use `--no-verify` (do not skip hooks)
- Never amend a published commit — create a new one instead
- If there is nothing to commit, say so clearly — do not create an empty commit
- If a pre-commit hook fails, fix the underlying issue before retrying
