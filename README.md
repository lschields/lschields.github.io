# Training Dashboard

A static training-plan dashboard for the Cambridge Half Marathon (Nov 1, 2026,
goal 1:28:00), built from real Garmin data. No backend - it's plain HTML/CSS/JS
reading two JSON files, hosted free on GitHub Pages.

- `index.html` / `assets/` - the dashboard itself
- `data/plan.json` - the prescribed plan (source: `scripts/build_plan.py`)
- `data/history.json` - actual performance data (source: `scripts/parse_garmin.py`)
- `scripts/build_plan.py` - regenerates `plan.json`. Edit this file when the plan changes.
- `scripts/parse_garmin.py` - ingests new Garmin exports into `history.json`. Never edit `history.json` by hand.
- `data/raw/` - archive of every raw file that's been fed in, organized into `data/raw/<monday-date>/`
  subfolders by the week the activity/export falls in (Monday-Sunday, matching the plan's week
  boundaries), in case anything needs reprocessing.

## Viewing it locally

```
cd site
python3 -m http.server 8000
```

Then open `http://localhost:8000`. (Opening `index.html` directly as a `file://`
URL won't work - browsers block the `fetch()` calls that load the JSON data.)

## Weekly update workflow

Every week (or whenever you've got new runs to log):

1. In Garmin Connect, export each new activity as a `.fit` file
   (Activity → the `...` menu → **Export Original**).
2. Export your Garmin Coach/health data the same way you did for the seed data.
3. Open a chat with Claude in this project and upload those files.
4. Ask Claude to update the dashboard. Behind the scenes that means:
   - `python3 scripts/parse_garmin.py <files>` to fold the new data into `data/history.json`
   - Claude reviews the new readiness/load numbers and how the week actually went, and if the
     upcoming weeks in `scripts/build_plan.py` need adjusting (paces, volume, an extra recovery
     day), it edits that file and re-runs it to regenerate `data/plan.json`
   - Commit and push (see below)
5. Refresh the site on your phone/computer - it's live within a minute or two of the push.

Tell Claude how you're actually feeling when you upload data (sore Achilles, great sleep,
crushed a session, whatever) - the readiness/load numbers are only half the picture.

## One-time setup: GitHub repo + Pages

You already have a GitHub account (`lschields`). The simplest path to a URL that needs no
extra configuration is naming the repo `lschields.github.io` - GitHub automatically serves
that repo at `https://lschields.github.io/`, no Pages settings to dig through.

1. On github.com, create a new **public** repo named exactly `lschields.github.io`. Leave it empty
   (no README/gitignore - this project already has them).
2. From this `site/` folder:
   ```
   git remote add origin https://github.com/lschields/lschields.github.io.git
   git branch -M main
   git push -u origin main
   ```
   (Uses whatever GitHub auth you already have set up in Terminal - if `git push` asks for a
   password, GitHub wants a Personal Access Token there now, not your account password; generate
   one at github.com → Settings → Developer settings → Personal access tokens, or use
   `gh auth login` / GitHub Desktop instead.)
3. In the repo's **Settings → Pages**, confirm the source is "Deploy from a branch", branch `main`,
   folder `/ (root)`. For a `username.github.io` repo this is usually already the default.
4. Give it a minute, then check `https://lschields.github.io/`.

After that, the weekly workflow is just: update the data, `git add -A && git commit -m "..." && git push`.

## One-time setup: point lukeschields.com at it

Good news from checking: **you still own lukeschields.com** - it's registered through Squarespace
Domains LLC until Jan 4, 2027. The "expired" message you saw is about the Squarespace *website/hosting
plan* being cancelled, not the domain registration. No need to buy it anywhere else.

1. **In this repo**: the `CNAME` file already contains `lukeschields.com` - GitHub Pages picks it up
   automatically as long as it's in the repo root (it is).
2. **In Squarespace's domain DNS settings** (Squarespace Domains dashboard → lukeschields.com → DNS
   Settings), remove any existing A/ALIAS/CNAME records pointing at Squarespace's website hosting, and add:

   | Type  | Host | Value                  |
   |-------|------|------------------------|
   | A     | @    | 185.199.108.153        |
   | A     | @    | 185.199.109.153        |
   | A     | @    | 185.199.110.153        |
   | A     | @    | 185.199.111.153        |
   | CNAME | www  | lschields.github.io.   |

3. Back in **GitHub → repo Settings → Pages → Custom domain**, enter `lukeschields.com` and save.
   Wait for DNS to propagate (can take up to a few hours), then check the "Enforce HTTPS" box once
   GitHub shows the certificate as issued.
4. `https://lukeschields.com` and `https://lschields.github.io` will both work; the custom domain
   is what you'll actually use day to day.

If Squarespace's DNS panel won't let you edit records because the domain shows as "expired" in some
UI, that's a Squarespace account-status quirk, not a registration problem - the WHOIS record confirms
it's registered and active. Worth a quick support chat with Squarespace if the DNS panel is genuinely
locked, rather than assuming you need to re-buy the domain.

## Notes on the data

- **FIT over TCX/GPX**: your Garmin FIT export includes running dynamics (vertical oscillation,
  ground contact time/balance, step length) that get stripped out of the TCX/GPX exports. `parse_garmin.py`
  is built around `.fit` files for that reason.
- **Checkmarks on running sessions** are computed automatically by matching an uploaded activity's
  date against the plan - not something you toggle. Strength/core/PT sessions don't have a Garmin
  data source, so those checkboxes are a manual, browser-local toggle (click to check) - they won't
  sync between your phone and computer, just a personal reminder.
- **The Week 8 time trial matters.** Goal paces in the Peak block are set from your half marathon PR
  (1:30) and last year's Cambridge result (1:35), not from Grandma's Marathon (GI issues skew that
  one). The 10K time trial in Week 8 is there to confirm or adjust those paces with real, current data
  before the peak-phase paces lock in.
