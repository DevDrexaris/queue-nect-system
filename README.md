# Queue-Nect

Queue-Nect is a React + TypeScript + Vite frontend with a PHP 8+ / PDO / MySQL backend foundation.

## Frontend setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set `VITE_PUBLIC_URL` in `.env` to the deployed HTTPS origin when hosting is available. Until then, the app intentionally uses `https://YOUR-FUTURE-DOMAIN.com` as a visible placeholder and never presents it as a real production URL.

The generated QR payload is a normal URL:

`{VITE_PUBLIC_URL}/queue/{CLINIC_IDENTIFIER}`

It uses high error correction and can be scanned by a phone's built-in camera or QR scanner.

## Backend setup

The PHP API is in `backend/`. See [backend/README.md](backend/README.md) for the local PHP server and database configuration.
