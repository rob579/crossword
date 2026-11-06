# Crossword

A personal crossword solver. Import `.ipuz` files, solve them in the browser, and pick up where you left off on any device.

## Features

- **Import .ipuz** – tap *Import* or drop files anywhere on the page. Handles numbered grids, blocks, circled cells, barred (cryptic-style) grids, enumerations and linked clues (e.g. "14, 16 Across": typing and Backspace run through every part, and "See 14" clues jump to the main clue).
- **Sync across devices** – puzzles and progress are stored in Cloudflare KV and merged letter-by-letter (newest wins), so you can start on your phone and finish on the laptop. Everything also saves locally, so it works offline and syncs when you're back.
- **Standard solving**
  - The current word is highlighted in the direction you're solving, and its clue is highlighted in the list (the crossing clue gets a faint marker).
  - Click a square to select it; click the selected square again to switch between Across and Down.
  - Arrow keys move (an arrow across the current direction switches direction first), Space switches direction, Tab / Shift+Tab or Enter jump between clues, Backspace clears and steps back.
  - Click a clue to jump to it. On phones, tap the clue bar to switch direction and use ‹ › to step through clues.
  - On touch devices an on-screen keyboard is shown, so the phone's own keyboard never covers the grid.
  - Check / Reveal (letter, word, puzzle) when the file includes a solution; Clear letter / word / puzzle.
- **Share links** – *Share* (or ⋯ → *Share link…* on a phone) creates a link to the puzzle. Anyone who opens it gets a blank copy in their own library; your answers stay private. Creating a link needs sync turned on; opening one doesn't.
- **WordPlay** (the anagrammer, *WP* button) – tap clue words to load all, odd or even letters, or type letters, then drag tiles around, tap two tiles to swap them, or hit *Shuffle*. It also shows the current answer's pattern (letters you've already got) for reference.

## Branches

| Branch    | Purpose                                     | Cloudflare URL                          |
|-----------|---------------------------------------------|-----------------------------------------|
| `testing` | New features land here first for review     | `https://testing.<project>.pages.dev`   |
| `main`    | Approved features, merged from `testing`    | `https://<project>.pages.dev`           |

## Project layout

```
public/            static site (no build step)
  index.html
  styles.css
  js/app.js        UI: library, grid, clues, keyboard, menus
  js/ipuz.js       ipuz parser
  js/store.js      localStorage + sync client
  js/anagram.js    anagrammer
functions/api/     Cloudflare Pages Functions (the sync API)
lib/util.js        shared server helpers
samples/mini.ipuz  small test puzzle
```

## Cloudflare Pages setup (one-off)

1. **Create the Pages project** – Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*, and choose `rob579/crossword` (authorise the Cloudflare GitHub app for this repo if asked).
2. **Build settings**
   - Production branch: `main`
   - Framework preset: *None*
   - Build command: *(leave empty)*
   - Build output directory: `public`
   - Root directory: *(leave empty / `/`)*
3. **Preview branch** – in the project's *Settings → Builds* (branch control), make sure preview deployments are enabled for `testing` (either "All non-production branches" or a custom rule including `testing`).
4. **KV storage** – *Storage & Databases → KV* → create a namespace, e.g. `crossword`. (Optionally a second one, `crossword-preview`, so testing never touches your real progress.)
5. **Bind KV** – Pages project → *Settings → Bindings* → *Add* → *KV namespace*. Variable name **`CROSSWORD_KV`**. Do this for **both** Production and Preview environments.
6. **Sync key** – Pages project → *Settings → Variables and Secrets* → add **`SYNC_TOKEN`** as a *Secret* (any long random string — a password manager can generate one). Add it to both Production and Preview.
7. **Redeploy** – bindings and secrets apply to new deployments, so retry the latest deployment for each branch (or push a commit).
8. On each device, open the site, tap the settings icon (top right) and paste the sync key.

The API rejects every request that isn't signed in (Google) or carrying a sync key, so your data is private even though the URL is public.

### Free tier note

Cloudflare KV's free plan allows 1,000 writes a day. The app batches saves (one write after you pause typing for a few seconds, plus one when you leave the page), so normal solving uses a few dozen writes per puzzle. KV is eventually consistent — changes can take up to about a minute to appear on another device.

### Extra people (their own sync key)

Each extra person gets their own private library and progress. Add a secret **`SYNC_USERS`** in the Pages project's *Variables and Secrets* (Production and Preview), e.g.

```
{"sam": "a-long-random-key-for-sam"}
```

Add more people as more entries. Names are lowercase letters, numbers, `-` or `_`. Your own `SYNC_TOKEN` keeps working exactly as before. Redeploy after changing it. Each person enters their key in Settings on their devices.

## Google sign-in (Cloudflare Access)

People sign in with Google instead of typing a sync key. Cloudflare Access protects only the **`/login`** page; signing in there sets a signed `CF_Authorization` cookie for the site, and the API checks that cookie itself (`lib/access.js`: signature, issuer, audience, expiry). So:

- the page and share links stay public – anyone with a link can open and solve a puzzle on their device;
- syncing needs a Google sign-in, and only accounts allowed by the Access policy can sign in;
- sync keys (`SYNC_TOKEN` / `SYNC_USERS`) keep working alongside, so devices can move over one at a time;
- the `*.pages.dev` addresses aren't protected by Access, so sign-in doesn't work there (sync keys still do).

**One-off setup**

1. Zero Trust → Access → **Applications** → *Add* → *Self-hosted*. Destination: `crossword.robsofficetips.com` path `login`. Policy: *Allow*, include the email list(s) of people who may sync. Login method: Google.
2. Copy the application's **Application Audience (AUD) Tag**.
3. Pages project → *Settings → Variables and Secrets* (Production, and Preview if testing there):
   - `ACCESS_TEAM_DOMAIN` = `robsofficetips.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag (several allowed, comma-separated)
   - `ACCESS_USERS` (optional, secret) = links Google accounts to the libraries people already have, e.g. `{"rob@gmail.com": "", "sam@gmail.com": "sam"}` – `""` is the original `SYNC_TOKEN` library, other names are `SYNC_USERS` names. Anyone not listed gets a new library of their own (`u:g-<hash>:`).
4. Redeploy. `GET /api/health` should show `GOOGLE_SIGN_IN: configured`.

To let someone in (or remove them), edit the email list in Zero Trust; nothing here needs to change.

## Local development

```bash
npm i -g wrangler
echo 'SYNC_TOKEN=devkey' > .dev.vars
wrangler pages dev public --kv CROSSWORD_KV
```

Then open http://localhost:8788 and use `devkey` as the sync key.
