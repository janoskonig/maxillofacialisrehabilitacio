# Git Repository Cleanup Guide

## Problem
Your repository exceeded GitHub's size limit because `node_modules` and `.next` directories were being tracked in Git.

## Solution Applied
1. ✅ Updated `.gitignore` to exclude all Next.js build artifacts and dependencies
2. ✅ Removed `node_modules/` from Git tracking (but kept locally)
3. ✅ Removed `.next/` from Git tracking (but kept locally)

## What You Need to Do Now

### Step 1: Commit the Changes

```bash
git add .gitignore
git commit -m "Remove node_modules and .next from Git, fix repository size"
```

### Step 2: Push to GitHub

```bash
git push origin main
```

**Note**: If you get an error about the repository being too large, you may need to remove the files from Git history (see Step 3 below).

### Step 3: If the Push Still Fails - Clean Git History

If GitHub still rejects the push because the files are in the Git history, you'll need to clean the history:

#### Option A: BFG Repo-Cleaner (Recommended - Faster)

1. Install BFG:
   ```bash
   brew install bfg  # macOS
   # or download from: https://rtyley.github.io/bfg-repo-cleaner/
   ```

2. Remove large files from history:
   ```bash
   bfg --delete-folders node_modules
   bfg --delete-folders .next
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

3. Force push:
   ```bash
   git push origin main --force
   ```

#### Option B: Git Filter-Branch (Built-in, but slower)

1. Remove files from all commits:
   ```bash
   git filter-branch --force --index-filter \
     "git rm -rf --cached --ignore-unmatch node_modules .next" \
     --prune-empty --tag-name-filter cat -- --all
   ```

2. Clean up:
   ```bash
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

3. Force push:
   ```bash
   git push origin main --force
   ```

#### Option C: Start Fresh (If history doesn't matter)

If you don't need the Git history, you can start fresh:

```bash
# Make a backup first!
cp -r . ../backup-maxillofacial

# Remove .git folder
rm -rf .git

# Re-initialize
git init
git add .
git commit -m "Initial commit - cleaned repository"
git branch -M main
git remote add origin <your-github-url>
git push -u origin main --force
```

## Verification

After pushing, verify the repository size:

```bash
git count-objects -vH
```

The repository should now be much smaller (typically under 10MB instead of 200MB+).

## Prevention

Going forward:
- ✅ `.gitignore` is now properly configured
- ✅ `node_modules` and `.next` will never be tracked again
- ✅ Always run `git status` before committing to check what's being added

## Important Notes

⚠️ **These directories were removed from Git but NOT from your local filesystem:**
- `node_modules/` - Still exists locally (needed for development)
- `.next/` - Still exists locally (build cache, will be regenerated)

If you clone the repository fresh, you'll need to:
```bash
npm install  # This recreates node_modules
```

The `.next` directory will be automatically created when you run `npm run dev` or `npm run build`.

## Current Status

✅ `.gitignore` updated
✅ `node_modules` removed from Git
✅ `.next` removed from Git
⏳ Waiting for you to commit and push

---

**Next Steps**: Run the commit command above, then push to GitHub!

