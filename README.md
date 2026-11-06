# Foundry Line

A factory automation game you play in the browser, with accounts and cloud saves.

- Create an account, or play as a guest with saves kept in your browser
- Three save slots per account, saved to the server every 45 seconds and when you switch tabs
- Blueprints sync to your account
- Beating the game (launching the Ark) unlocks creative-mode saves for the account
- No npm packages: the server uses Node's built-in web server, password hashing (scrypt) and SQLite

## Run it on your computer

You need Node.js 22.13 or newer (check with `node -v`).

```
npm start
```

Open http://localhost:3000. Saves go in the `data` folder next to the code.

## Put it online with Railway

1. **Push this folder to GitHub.** Create a new repository and upload everything in this folder. The `.gitignore` keeps your local `data` folder out of it.
2. **Create the Railway service.** In Railway, click New Project → Deploy from GitHub repo, and pick the repository. Railway sees `package.json` and runs `npm start`.
3. **Add a volume so saves survive redeploys.** This step matters: without a volume, every account and save is wiped each time you deploy.
   - Open the service, then right-click the canvas (or use the command palette) → Add Volume, and attach it to this service.
   - Set its mount path to `/data`.
   - The server finds the volume on its own through Railway's `RAILWAY_VOLUME_MOUNT_PATH` variable. You can also set `DATA_DIR=/data` under Variables to be explicit.
4. **Give it a web address.** Go to the service → Settings → Networking → Generate Domain. You can attach your own domain there later.
5. **Optional health check.** Under Settings → Deploy → Healthcheck Path, enter `/healthz`.

Open the generated address, create an account, and play.

### Node version

`package.json` asks for Node 22.13 or newer, which Railway reads automatically. If a deploy log shows an older Node, add a variable `NIXPACKS_NODE_VERSION=22` (or `RAILPACK_NODE_VERSION=22`, depending on which builder your project uses).

## Changing the game

The game lives in `build/game.html`. That is the same single file as the Claude artifact.

1. Replace `build/game.html` with the new version.
2. Run `npm run build` to regenerate `public/index.html`.
3. Commit and push. Railway redeploys on its own.

The build script adds the login screen, save slots and cloud saving around the game. The website pieces are in:
- `build/site-boot.js`: login, save slots, cloud saves
- `build/site.css`: their styles
- `build/site-head.html`: page header tags

## Files

| File | What it does |
| --- | --- |
| `server.js` | Web server: accounts, sessions, save and blueprint API, serves the game |
| `db.js` | SQLite database: users, sessions, saves, blueprints |
| `public/index.html` | The built game page (generated, but committed so Railway can serve it) |
| `build/` | Game source and the website shell |

## Security notes

- Passwords are hashed with scrypt and a random salt per user. Plain passwords are never stored.
- Sessions use a random token in an HttpOnly, SameSite=Lax cookie that lasts 30 days. Only a hash of the token is stored on the server.
- The cookie is marked Secure when running on Railway, which serves the site over HTTPS.
- Logins are rate limited to 10 attempts per 15 minutes per username and IP. Sign-ups are limited to 8 per hour per IP.
- There is no password reset, since accounts have no email address. If someone forgets a password, you can delete their row from the `users` table and they can sign up again.

## API

All routes return JSON. Every route except register, login and logout needs the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/register` | `{username, password}` creates an account and logs in |
| POST | `/api/login` | `{username, password}` |
| POST | `/api/logout` | Ends the session |
| GET | `/api/me` | Current username, and whether the account has beaten the game (unlocks creative saves) |
| GET | `/api/saves` | Summary of each slot |
| GET / PUT / DELETE | `/api/saves/1` to `/3` | Read, write `{data, meta}`, or clear a slot |
| GET / PUT | `/api/blueprints` | Read or replace the blueprint list |
