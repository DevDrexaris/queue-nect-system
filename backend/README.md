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

Apply the SQL files below manually in the Supabase SQL Editor, in order. Do not deploy a frontend that uses a migration's RPCs until that migration is applied and verified. These files are not automatically run by this project.

1. `database/migrations/20260927_strict_queue_presence_realtime.sql` adds RPC-controlled queue transitions, student status capabilities, presence, and scoped Realtime.
2. `database/migrations/20260928_add_awaiting_return_status.sql` adds the awaiting-return queue state.
3. `database/migrations/20260928_notifications_announcement_analytics.sql` adds notification, announcement, and analytics database support.
4. `database/migrations/20260929_queue_lifecycle_sync.sql` synchronizes queue lifecycle operations.
5. `database/migrations/20260930_fix_awaiting_return_transition.sql` fixes awaiting-return transitions.
6. `database/migrations/20261001_fix_student_queue_realtime_events.sql` fixes student queue Realtime events.
7. `database/migrations/20261002_queue_availability.sql` adds queue admission availability and queue-aware registration contracts.
8. `database/migrations/20261003_walk_in_registration.sql` adds authorized walk-in registration.
9. `database/migrations/20261004_multi_location_queues.sql` adds backward-compatible locations and queues, data backfill, scoped queue operations, and queue-specific numbering/QR registration.
10. `database/migrations/20261005_multi_queue_scope_hardening.sql` binds public queue lookups to organization identifiers, restricts staff statistics to assigned scopes, and removes direct anonymous QR-token table access.
11. `database/migrations/20261006_staff_queue_scope_analytics_realtime.sql` scopes staff analytics, activity logs, presence, and Realtime to assigned queues while preserving organization-wide administrator access.
12. `database/migrations/20261007_queue_session_lifecycle.sql` adds explicit queue session start/resume, publishes active session state, and requires an active session for QR and walk-in registration.

The multi-queue prerequisite chain begins with the existing schema in `database/schema.sql` and migrations 20261002 through 20261007, but all earlier numbered migrations should be applied in order on a deployment that has not already run them. Apply each migration once through the Dashboard; the 20261005 through 20261007 hardening/lifecycle migrations contain post-apply checks. No production migration has been applied or verified from this workspace.
