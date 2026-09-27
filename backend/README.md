# Queue-Nect API

The backend targets PHP 8+ with PDO and MySQL. No XAMPP is required.

## Local health check

From `backend/public`, run:

```powershell
php -S localhost:8080
```

Then open `http://localhost:8080/api/health.php`.

Database credentials are read from `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD`.

## Supabase queue upgrade

After the existing Supabase schema is installed, apply `database/migrations/20260927_strict_queue_presence_realtime.sql` in the Supabase SQL Editor. This migration moves queue state changes behind database RPCs, adds private student status capabilities and ephemeral presence, and enables scoped Realtime events. Do not deploy the updated frontend before applying this migration.
