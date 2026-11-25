# Checkpoints

Named restore points. Each one is a git tag; the matching live build can be
re-deployed from that tag.

| Checkpoint | Tag | Date | What it contains |
| --- | --- | --- | --- |
| Checkpoint 1 | `checkpoint-1` | 2026-11-25 | Rashio rename; both clipboard layouts; safe incremental sync; full-revert undo; "Keep my payments as they are"; single Import & Sync entry; file-only Google Sheets sync; mobile/iPad layout |

## Going back to a checkpoint

```bash
git checkout checkpoint-1          # look at it
git switch -c back-to-checkpoint-1 checkpoint-1   # work from it
npm ci && npm run build
npx firebase-tools deploy --only hosting:app    # put that version live
```

Your data is not part of a code checkpoint: it stays in the cloud database.
A private JSON copy of your data at each checkpoint is kept on your Mac in the
git-ignored `private/` folder, restorable from Settings → Restore from JSON backup.
