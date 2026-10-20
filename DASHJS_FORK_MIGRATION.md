# dash.js Fork Migration — Handoff Notes

## Goal
Move our `orb-patches-v5.2.1` branch (containing all of our local fixes/patches on top of
upstream `dash.js`) off of the read-only upstream clone and onto a publishable fork, so the
branch can be shared internally.

## Fork used
- Fork: https://github.com/Chrisnezz/dash.js
- This is a personal GitHub account (not the enterprise account), used because forking
  outside of the enterprise org wasn't permitted from the primary account.

## What's done so far
1. Added a new git remote in the local `dash.js/` repo pointing at the fork:
   ```
   git remote add chrisnezz https://github.com/Chrisnezz/dash.js.git
   ```
2. Pushed the full `orb-patches-v5.2.1` branch (all patch commits, history intact) to the fork:
   ```
   git push https://Chrisnezz@github.com/Chrisnezz/dash.js.git orb-patches-v5.2.1:orb-patches-v5.2.1
   ```
   - This required a fine-grained GitHub Personal Access Token (PAT) scoped to the
     `Chrisnezz/dash.js` repo with **Contents: Read and write** AND **Workflows (Actions):
     Read and write** permissions (the branch touches `.github/workflows/check-workflows.yaml`,
     which GitHub blocks without the workflow scope).
   - Authentication must be done with the username explicitly in the URL
     (`https://Chrisnezz@github.com/...`) to force a credential prompt — otherwise VS Code's
     built-in GitHub auth silently injects the signed-in enterprise account and the push is
     rejected with a 403 (permission denied) with no prompt at all.
3. Set the local branch to track the fork remote going forward:
   ```
   git fetch chrisnezz
   git branch -u chrisnezz/orb-patches-v5.2.1 orb-patches-v5.2.1
   ```
   So a plain `git push` / `git pull` on `orb-patches-v5.2.1` now targets the fork by default.

## Current remote layout (in `dash.js/`)
- `origin` → `https://github.com/Dash-Industry-Forum/dash.js.git` (read-only upstream, kept for
  pulling in upstream updates)
- `chrisnezz` → `https://github.com/Chrisnezz/dash.js.git` (the publishable fork; branch
  `orb-patches-v5.2.1` tracks `chrisnezz/orb-patches-v5.2.1`)
- `orbdashjs` → local sibling path `../orbdashjs` (unrelated local remote, pre-existing)

## Branch status
- Local branch: `orb-patches-v5.2.1`
- Head commit at time of writing: `f16d00238` — "Set seekTime = 0 if it is negative in
  StreamController::_switchStream, to avoid playback issues on RDK platforms"
- Working tree was clean at time of push (no uncommitted changes).
- The branch is a linear series of patch commits on top of an older upstream base (not rebased
  onto latest `development`), including our hbbtv/ORB-specific fixes such as:
  - BASEURL / EVENT / ERRORHANDLE test-suite related fixes (org.hbbtv_DASH-* test IDs)
  - MPD anchor / baseURL / inband event-track handling fixes
  - RDK-platform seek time fix (HEAD commit)

## Remaining / possible next steps
- Open a PR on the fork (`https://github.com/Chrisnezz/dash.js/pull/new/orb-patches-v5.2.1`) if a
  visual diff/review against the fork's `development` branch is wanted — not required just to
  publish the branch.
- If more patches are cherry-picked onto `orb-patches-v5.2.1` locally, just `git push` (it will go
  to `chrisnezz` since upstream tracking is set).
- Consider whether `.github/workflows/*` from upstream should be stripped/disabled on the fork
  branch if there's no intention of running CI there.
- If a colleague continues this, they'll need their own PAT (or SSH key) with write access to the
  `Chrisnezz/dash.js` fork, or the fork owner should grant them collaborator access.
