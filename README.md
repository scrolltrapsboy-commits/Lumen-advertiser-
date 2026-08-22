# Lumen — Local Digital Advertising Platform

Lumen is a Node.js + Express backend for a local digital signage advertising
platform. Businesses upload photo/video advertisements which go live
**immediately** after server-side validation (no manual approval step), and
each screen runs a lightweight web-based player that stays in sync with the
server in near real time — no page reloads anywhere in the app.

This project was converted from a static HTML/CSS/vanilla-JS prototype into
a production-ready Express application, then hardened with a second pass
that removed the approval workflow, added real-time polling, fixed a
timezone bug in screen operating hours, and fixed the mobile sidebar menu.
The original pages and styling are preserved throughout.

## Tech stack

- Node.js + Express
- Multer (file uploads)
- express-session (temporary in-memory sessions)
- Helmet, Compression, CORS, Morgan
- JSON files as a lightweight database (`/data`)
- Vanilla HTML5 / CSS3 / JavaScript on the frontend (ES modules, no framework)

## Project structure

```
project/
├── server.js              Express app entrypoint
├── package.json
├── render.yaml             Render Blueprint
├── .env.example
├── config/                 db + multer configuration
├── controllers/            request handlers
├── services/                business logic (users, screens, ads, analytics…)
├── middleware/              auth guards + error handling
├── routes/                  API + page routes
├── data/                    JSON "database" (auto-created on first run)
├── uploads/                 uploaded advertisement media (auto-created)
└── public/                  static frontend (HTML/CSS/JS)
    └── assets/
        ├── css/
        └── js/
            ├── core/        api client, auth, settings helpers
            ├── components/  shell, toast, modal, loader, tv-preview
            ├── services/    frontend fetch wrappers around the API
            ├── utils/       pure helpers (dates, slots, validation)
            └── pages/       one script per page
```

## Getting started locally

```bash
npm install
cp .env.example .env    # edit values as needed
npm run dev              # or: npm start
```

The app starts on `http://localhost:3000` by default. Visit `/` for the
marketing page, `/login` and `/signup` for auth, `/dashboard` for the
advertiser portal, and `/admin` for the admin control center.

> **Note on dependencies:** this project was assembled in a sandboxed
> environment without registry access, so `package-lock.json` is not
> pre-generated. Running `npm install` will create it on first install —
> commit it afterwards for reproducible builds.

### Admin login

```
Email:    lumen@gmail.com
Password: lumen@6922
```

These can be overridden via the `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment
variables.

### Advertisement lifecycle (no manual approval)

Uploads are validated server-side (file type, size, video duration, slot
availability) and go **live immediately** — there is no pending/approval
state. An advertisement is either `active` (currently running) or `expired`
(its campaign length has elapsed). Admins can still pull an ad down early
("Pause" in the Admin → Advertisements tab, which marks it `expired`) or
delete it outright; both take effect immediately everywhere the ad appears.

### Real-time updates

The frontend polls a lightweight `GET /api/meta` endpoint roughly once a
second. It returns only version stamps for each data collection (bumped in
memory whenever that collection is written), so pages only re-fetch full
data — and only the specific resource that changed — when something
actually changed. This powers live-updating dashboards, history, the admin
panel, upload-page slot counts, and the display player, all without a page
reload or reload-based polling of full collections.

### Screen operating hours & timezone

Screens store `openTime`/`closeTime` as `"HH:MM"` 24-hour strings, edited
via a real time picker in the admin UI. Whether a screen is currently open,
its "next opening" label, and the current time shown on a closed display
are all computed **server-side** using `Intl.DateTimeFormat` pinned to the
`timezone` configured in `data/settings.json` (default `Asia/Kolkata`) —
not the kiosk device's local clock — so schedules are correct regardless of
what timezone the display hardware or browser is set to.

### Connecting a display screen

Open `/display?id=SCREEN001` (or visit `/display` and enter a Screen ID on
the connect screen) on the TV/kiosk device. The player polls
`GET /api/display/:screenId` every 60 seconds for the current approved ad
rotation — no page reload required.

## Data storage

All application data lives in flat JSON files under `/data`
(`users.json`, `screens.json`, `ads.json`, `settings.json`,
`analytics.json`), created automatically on first run with sensible
defaults (including four demo screens). Uploaded advertisement files are
stored on disk under `/uploads` and served statically at `/uploads/<file>`.

This is intentionally simple ("temporary" per the project brief) — for a
real production deployment, swap `config/db.js` for a proper database and
attach persistent/object storage for uploads.

## API overview

| Method | Route                          | Description                                   |
|--------|---------------------------------|------------------------------------------------|
| POST   | `/api/auth/login`               | Admin or advertiser login                      |
| POST   | `/api/auth/signup`              | Create an advertiser account                   |
| POST   | `/api/auth/logout`              | Destroy the session                            |
| GET    | `/api/auth/session`             | Current session user (or null)                 |
| POST   | `/api/auth/reset-password`      | Reset password by email                        |
| PUT    | `/api/auth/profile`             | Update the logged-in advertiser's name          |
| GET    | `/api/screens`                  | List screens (with live slot availability)      |
| GET    | `/api/screens/:id`              | Get one screen                                  |
| POST   | `/api/screens`                  | Create a screen (admin)                         |
| PUT    | `/api/screens/:id`              | Update a screen (admin)                         |
| DELETE | `/api/screens/:id`              | Delete a screen (admin)                         |
| GET    | `/api/ads`                      | List advertisements                             |
| POST   | `/api/upload`                   | Upload a new advertisement \u2014 goes live immediately (multipart/form-data) |
| PUT    | `/api/ads/:id/status`           | Pause/resume (`active`/`expired`) an ad (admin) |
| PUT    | `/api/ads/:id/renew`            | Extend a campaign                               |
| POST   | `/api/ads/:id/duplicate`        | Duplicate a campaign                            |
| DELETE | `/api/ads/:id`                  | Delete an advertisement (owner or admin)        |
| GET    | `/api/display/:screenId`        | Public: screen + playable ads + open/closed status + player config |
| GET    | `/api/meta`                     | Version stamps for ads/screens/users/settings, polled by the frontend for live updates |
| GET    | `/api/users`                    | List advertiser accounts (admin)                |
| DELETE | `/api/users/:id`                | Remove an advertiser account (admin)            |
| GET    | `/api/analytics`                | Platform summary stats (admin)                  |
| GET    | `/api/settings`                 | Public platform settings/pricing                |
| PUT    | `/api/settings`                 | Update pricing (admin)                          |

## Pricing rules

- Photo campaigns: ₹2000 (configurable in `data/settings.json` or via the
  admin Settings tab)
- Video campaigns: ₹4000
- Prices are always calculated server-side on upload — the client never
  sets its own price.

## Upload rules

- Images: PNG, JPG, JPEG, WEBP — max 10MB
- Videos: MP4, MOV, WEBM — max 100MB and max 30 seconds
- Both are validated server-side (type, size, and — for video — duration)
  before an advertisement is created. Uploads are rejected outright if the
  target screen has no free slots for the requested duration.

## Deploying to Render

1. Push this repository to GitHub/GitLab.
2. In Render, choose **New → Blueprint** and point it at the repo — it will
   read `render.yaml` automatically. Alternatively create a **Web Service**
   manually with:
   - Build command: `npm install`
   - Start command: `npm start`
3. Set `ADMIN_PASSWORD` (marked `sync: false` in the blueprint) and any
   other secrets in the Render dashboard.
4. Deploy. No further configuration is required — direct routes like
   `/login`, `/dashboard`, and `/admin` work out of the box, including on
   refresh, since they're served by the Express server rather than a static
   host.

> Uploaded files and JSON data are stored on local disk. Render's free tier
> does **not** persist local disk across deploys/restarts — attach a paid
> persistent disk (see the commented-out `disk:` block in `render.yaml`) if
> you need uploads to survive redeploys.

## Security notes

- All uploads are validated for MIME type, file size, and (for video)
  duration before being written to disk or referenced in the database.
- Sessions are `httpOnly`, `sameSite: lax`, and marked `secure` automatically
  in production.
- Helmet sets a restrictive Content-Security-Policy; QR codes are the only
  cross-origin image source allowed (`https://api.qrserver.com`).
- All routes are wrapped in try/catch and funnel into a single error
  handler — the server logs and returns a JSON error instead of crashing.
