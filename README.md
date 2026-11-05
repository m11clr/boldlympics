# BOLDLYMPICS

Multiplayer design olympics for up to 300 players. One Node.js server, three pages:

| Page | Who opens it |
|---|---|
| `/screen` | The projector. Click **Start broadcast** once (turns on sound and fullscreen). |
| `/admin?key=YOUR_KEY` | The host. Opens the stadium, adds bots, skips phases, shows the countdown only at the end. |
| `/` | Players. The QR code on the big screen points here. |

## Run locally

```
npm install
ADMIN_KEY=secret npm start
```
Then open http://localhost:3000/screen and http://localhost:3000/admin?key=secret.
Phones on the same Wi-Fi can join via your computer's IP address, e.g. http://192.168.1.20:3000/.

## Deploy on Render (free)

1. Put this folder in a GitHub repository.
2. On render.com: **New → Blueprint**, pick the repository. Render reads `render.yaml`.
3. When asked for `ADMIN_KEY`, type a password for Adminland.
4. After the deploy, your game runs at `https://boldlympics-xxxx.onrender.com`.

The free plan goes to sleep after 15 minutes without visitors; the first visit then takes about a minute to wake it up. Open `/screen` a few minutes before the game starts.

## Files

- `server.js` runs the game clock, phases, bots, scoring and the moving finish line.
- `public/app.html` is the client for all three pages (role chosen by the URL).
- `public/assets/` holds the sponsor logos and the gradient objects exported from Figma.
- `public/vo.js` and `public/sfx.js` hold the voiceover, crowd and organ sounds (loaded only by `/screen`).
