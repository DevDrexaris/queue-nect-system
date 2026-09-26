# Queue-Nect API

The backend targets PHP 8+ with PDO and MySQL. No XAMPP is required.

## Local health check

From `backend/public`, run:

```powershell
php -S localhost:8080
```

Then open `http://localhost:8080/api/health.php`.

Database credentials are read from `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD`.
