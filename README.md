# Fixture Fault Log — Railway deployment

A single-page fixture test and fault log. Data is stored as one JSON file on a
Railway Volume, so there's no database to run or pay for.

```
index.html    The whole app (no build step, no framework)
server.js     Express: serves the page, reads/writes the log file
package.json  Dependencies and the start command
```

All four files sit at the top level of the repo. Keep them there — Railway
looks for `package.json` at the root to detect a Node app.

## Deploy

1. **Get the code onto Railway.** Upload these files to a GitHub repo (the web
   uploader at *Add file → Upload files* is fine) and choose *Deploy from
   GitHub repo* in Railway. Or run `railway init` then `railway up` from this
   directory. Railway detects Node and runs `npm start` on its own — no
   Dockerfile or config needed.

2. **Add the Volume.** This is the step that matters. In the service, go to
   *Settings → Volumes → Add Volume* and set the mount path to:

   ```
   /data
   ```

   Without it, the log file lives on the container's ephemeral disk and is
   wiped on every redeploy and restart.

3. **Set variables** under *Variables*:

   | Variable   | Value                | Notes                                        |
   |------------|----------------------|----------------------------------------------|
   | `DATA_DIR` | `/data`              | Must match the volume mount path. Default is already `/data`. |
   | `PASSCODE` | e.g. `rig-2026`      | Optional. If set, the page asks for it once and remembers it. Leave unset for open access. |

   Don't set `PORT` — Railway provides it.

4. **Generate a domain** under *Settings → Networking → Generate Domain*, then
   open it. First load shows "Synced HH:MM" in the header once it reaches the
   server.

## Running locally

```bash
npm install
DATA_DIR=./data npm start      # http://localhost:3000
```

## How storage works

- The server keeps the log in memory and rewrites `/data/fixture-log.json`
  after every change, writing to a temp file and renaming it so a crash can't
  leave a half-written file. A rolling copy is kept at `fixture-log.json.bak`.
- The browser never edits state directly — it posts an action (`addEntry`,
  `toggleEntry`, and so on) and the server returns the updated log. Two people
  logging faults at the same time won't overwrite each other.
- Open tabs re-poll every 20 seconds and whenever you switch back to the tab.
- `GET /api/backup` downloads the whole log as JSON. Worth hitting occasionally,
  or pointing a cron at it.

## Notes

- `PASSCODE` is a shared secret, not user accounts. It keeps out passers-by with
  the URL; it is not protection against a determined attacker. Everything is
  served over Railway's HTTPS.
- If the service logs permission errors writing to `/data`, set
  `RAILWAY_RUN_UID=0` — volumes mount as root and some images run as a
  non-root user.
- Size is not a concern here. Thousands of entries is a file of a few hundred KB,
  far below the smallest volume.
