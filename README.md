# Stream Yours' — v2

Free, peer-to-peer movie & series streaming in the browser. Videos never touch a server: the host's browser sends
them straight to the viewer's browser over WebRTC. This repo is a plain static site (no bundler) plus one optional
Cloudflare Pages Function.

```
index.html  style.css  app.js          the app (markup / styles / logic)
sw.js  manifest.webmanifest  icons/    installable PWA + fast repeat loads
vendor/                                MP4Box + QR generator, self-hosted (no CDN dependency for these)
404.html  _headers  _redirects         Cloudflare Pages: error page, security/cache headers, /host /movies /series
robots.txt  sitemap.xml  llms.txt      SEO / AI-crawler files (unchanged from yours, plus Disallow: /api/)
google450a35d41fc058df.html            Search Console verification (unchanged)
og-image.png  favicon.png  favicon.ico social preview + icons
functions/api/turn.js                  OPTIONAL TURN relay credentials (see "Optional: TURN")
firebase/stream-yours.rules.json       Realtime Database rules for this app (MERGE, don't overwrite — see below)
wrangler.toml  package.json  scripts/  build + deploy tooling
.github/workflows/deploy.yml           OPTIONAL GitHub → Cloudflare auto-deploy
```

## 1. Deploy to Cloudflare Pages

Requires Node 20+ for the build step (`npm install` once).

**A. Command line (simplest, supports the TURN function)**
```bash
npm install
npx wrangler login          # first time only
npm run deploy              # builds ./dist and publishes to the "stream-yours" Pages project
```
If the project name differs, edit `--project-name` in `package.json` and `name` in `wrangler.toml`.

**B. Git integration** — push this folder to GitHub/GitLab, then Cloudflare → Workers & Pages → Create → Pages →
Connect to Git. Build command `npm run build`, output directory `dist`. (If you use this, delete
`.github/workflows/deploy.yml` so it doesn't deploy twice.)

**C. Dashboard upload (no TURN)** — run `npm run build`, then drag the `dist/` folder into the Pages dashboard.
Dashboard drag-and-drop does not include the `functions/` folder, so use A or B if you want the TURN relay.

Preview locally: `npm run dev` → http://localhost:8788

> Always deploy the **built `dist/`** (the build stamps a new service-worker version so returning visitors get the
> new files). If you ever upload files by hand, change `BUILD_ID` in `sw.js` to any new string first.

## 2. Firebase Realtime Database rules — read before touching

The app finds hosts and exchanges WebRTC handshakes through your Firebase Realtime Database
(`cloud-db-studio`, nodes `stream-yours-hosts` and `stream-yours-signals`). Its Firebase web config is public by
design; **the database rules are what protect it**.

`firebase/stream-yours.rules.json` contains rules for just those two nodes (size/type validation, no half-built
host records). **Do not run `firebase deploy --only database` with it as-is**: that replaces the rules for the entire
database and would lock out any other app that shares it. Instead:

1. Firebase console → Realtime Database → Rules.
2. Copy the `"stream-yours-hosts"` and `"stream-yours-signals"` blocks into your existing `"rules": { … }` object.
3. Test them in the **Rules Playground**, then Publish.

Free (Spark) plan limits to know: **100 simultaneous connections**, 1 GB stored, 10 GB/month downloaded — shared by
every app on that database. Every open tab holds a connection, so v2 releases the connection of tabs that have been
hidden for 2 minutes (and are not hosting or playing). If you outgrow it, Firebase's pay-as-you-go plan is the next step.

Remaining weakness (inherent to no-login apps): anyone can write to those nodes. The rules limit what they can write;
they do not stop deliberate abuse. Adding Firebase Anonymous Auth + App Check is the next hardening step.

## 3. Optional: TURN relay for strict networks

Some mobile carriers / campus Wi-Fi block direct peer-to-peer. A TURN relay gives those viewers a fallback. Direct
connections are always tried first.

1. Cloudflare dashboard → Realtime → TURN Server → create a key (copy the **Key ID** and **API token**).
2. Pages project → Settings → Variables and Secrets → add `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` (as secrets).
3. Redeploy (method A or B). Visit `/api/turn`: it should show `"configured": true`. The app picks it up by itself.

Cost: at the time of writing Cloudflare gives 1,000 GB of TURN traffic per month free and charges per GB after that.
Relayed video is **real traffic** (a 2-hour film is several GB), so set a billing notification in Cloudflare before
enabling it. The endpoint only answers requests from your own site. To use a different TURN provider instead, put
its servers in `APP_CONFIG.extraIceServers` at the top of `app.js`.

## 4. Custom domain

Pages → Custom domains → add it. Then build with your URL so canonical/OG/sitemap/robots all match:
`SITE_URL=https://watch.example.com npm run build` (for Git builds, add `SITE_URL` as a build variable).
Add the new domain as a property in Google Search Console and submit `sitemap.xml`.

## 5. After deploying — 5-minute check

1. Open the site on two devices, **Host Folder** on one, watch on the other (try different networks if you can).
2. Share button (top bar) → QR code opens the site on a phone.
3. Pause and drag the timeline on a phone; switch audio language on a multi-audio MP4.
4. Chrome DevTools → Console on the live site: there should be no red "Refused to …" messages (that would mean a
   security-header rule in `_headers` needs adjusting).
5. Lighthouse (Chrome DevTools) for performance / PWA / SEO; Search Console → Sitemaps → submit.

## 6. What changed in v2

**Bugs fixed**
- Files whose audio/video the browser's MSE engine can't play (very common: AC-3/E-AC-3 audio, some HEVC) fell back
  to progressive playback **after closing the very connection it needed**, so the video never started. Now it
  keeps the connection and streams the file on a fresh stream id.
- Host ICE candidates that arrived before the host's answer was applied were silently dropped → random "Host
  unreachable". They are now queued and applied in order.
- One viewer with a bad connection could delete a healthy host's shared record. Hiding is now local to that viewer,
  hosts re-publish themselves if their record disappears, and stale records are only deleted while the client is
  provably online (a stale cache after a network drop used to be able to wipe live hosts).
- Host heartbeats were throttled in background tabs, making hosts look offline after a few minutes. They now run in
  a Worker; hosts also request a screen wake lock so phones don't sleep mid-stream.
- A pending connection was never torn down when you closed the player or opened another title.
- The explorer re-rendered every 2.5 s (losing keyboard focus/hover). It now redraws only when something changed.
- Resume points were keyed by a per-session host id, so "resume" broke whenever a host reloaded. Now keyed by file.
- Large non-MP4 files held every chunk in JS memory; chunks are now collapsed into a Blob the browser can page out.
- A blocked `localStorage` (private mode) or blocked Firebase CDN crashed the whole app at load; both now degrade
  gracefully. A malformed host record can no longer break everyone's catalog.
- Viewport no longer disables pinch-zoom (accessibility); keyboard focus rings; reduced-motion support.

**Enhancements**
- Faster: split into cacheable CSS/JS, deferred scripts, preconnect hints, service-worker app shell, self-hosted MP4Box.
- Installable PWA (manifest, maskable icons, shortcuts for Movies / Series / Host).
- Share & Install sheet: copy/share link, QR code for other devices, install button.
- Drag-to-scrub timeline, picture-in-picture, media keys / lock-screen controls, keyboard shortcuts
  (Space, ←/→ or J/L ±10 s, ↑/↓ volume, M mute, F fullscreen).
- Optional TURN relay, longer connection timeout (12 s), clearer error messages, online/offline toasts.
- Security headers + CSP, 404 page, short URLs (`/host`, `/movies`, `/series`), social preview image, privacy FAQ.
- Theme follows the system light/dark setting on first visit.

Nothing was removed: your catalog logic, Firebase paths/schema, MSE multi-audio engine, SEO content, JSON-LD and the
"Reliable Host" link are all intact.

## 7. Good to know

- The host's tab must stay open (that is what makes it zero-upload). Phones may suspend backgrounded tabs.
- Browsers can't decode every format. If a file has no sound or won't play, re-encode it once:
  `ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4`
- Multi-audio language switching needs Media Source Extensions; where unavailable the video still plays with its
  default audio track.
- **Privacy:** hosting publishes your device label and the names/sizes of the chosen videos to anyone who visits.
  Viewer and host can see each other's network address during a stream (inherent to P2P). Only share files you have
  the right to share.
