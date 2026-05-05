# Git Setup

Do not push this project to an old template repository. Create or select a new private repository for KUB first.

## Option 1: GitHub CLI

```bash
gh repo create kub-messenger --private --source=. --remote=origin --push
```

## Option 2: Manual Setup

```bash
git remote remove origin
git remote add origin <URL_НОВОГО_PRIVATE_REPO>
git add .
git commit -m "Initial KUB messenger release"
git branch -M main
git push -u origin main
```

## If The Repository Already Exists

```bash
git remote set-url origin <URL_НОВОГО_PRIVATE_REPO>
git push -u origin main
```

## Current Checklist Before Push

```bash
git remote -v
git status
git ls-files .env .env.local .env.production attached_assets node_modules dist build
```

The last command should not list real env files, local assets, dependencies, or build outputs.
