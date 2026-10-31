# Backend Workflow

This document explains how the MedCare backend works from startup to request handling and shutdown.

## 1. Application startup

When the backend starts, the server loads environment variables and initializes the main constants:

- `PORT` from environment or default `5000`
- `DB_PATH` = `data_test/medical_store.db`
- `ARCHIVE_DIR` = `data_test/archive`

Then the app calls `db_existence()` to ensure the database is available.

### Database initialization flow

`db_existence()` does the following:

1. Ensures the database folder exists.
2. Checks whether the main SQLite DB file exists.
3. If it exists, opens a connection with `better-sqlite3`.
4. If it does not exist, it tries to restore the latest database archive.
5. If no archive is available, it creates a fresh database via `db_i.initDb(DB_PATH)`.
6. After creation, it inserts default settings such as:
   - `activation_key`
   - `lock_status = 'LOCKED'`

This is the first system gate: the backend cannot operate meaningfully without a valid database connection.

---

## 2. Server boot and global state

After DB setup, the server initializes the Express app:

- `app.use(express.json())` to parse incoming JSON payloads
- a global middleware runs on every request

### Global request middleware

The middleware in `app.use((req, res, next) => { ... })` checks:

- whether `db_instance` exists
- whether the database file still exists

If either is missing, the backend responds with `503` and stops the request with:

- `Database unavailable. Please restore the database or restart the backend service.`

This protects the app from requests running against a broken or missing database.

---

## 3. Session and user context

The app uses a global in-memory session object:

- `global.session`

This holds the current logged-in user information.

Helper functions:

- `get_session_user()` returns the active session
- `is_admin_session()` checks whether the current user is admin (`role_id === 1`)
- `is_valid_role()` validates accepted roles

This session is used by routes to decide whether a request is allowed and to attach activity records to the correct user.

---

## 4. Authentication flow

### Registration flow

On first setup, the app expects a super-admin registration through `/register`:

1. GET `/register` shows registration status based on `lock_status`
2. POST `/register` checks:
   - required username/password/full_name/activation_key
   - activation key matches the stored one in `settings`
3. If valid, it inserts a new user in the `users` table with role `1` (admin)
4. It updates `settings.lock_status` to `UNLOCKED`

After registration, the app redirects or directs the user to `/login`.

### Login flow

The login route verifies:

- username exists
- password matches stored value
- the user is active

If valid, it stores the authenticated user to `global.session`.

### Logout flow

The logout route clears the active session by resetting `global.session`.

### Password management

The backend includes:

- `/change-password`
- `/forgot-password`

These routes are for updating the password of the active user or handling password reset/recovery logic in the current app model.

---

## 5. CRUD and business routes

Once the user is authenticated, the app exposes backend endpoints for different modules such as:

- users
- customers
- suppliers
- medicines
- categories
- purchases
- sales
- stock
- returns
- notifications
- activity logs
- tracking and archive queries

Most routes follow a common pattern:

1. Verify session or required permissions
2. Validate request payload
3. Query or modify SQLite tables
4. Write activity logs
5. Return a JSON response

---

## 6. Financial transaction flow

The most critical APIs are the financial ones:

- `/buy`
- `/sell`
- `/purchase_return`
- `/sale_return`

These routes update multiple tables together, including:

- `purchases` or `sales`
- `medicine_batches`
- `medicines`
- `customers` or `suppliers`
- `activity_logs`
- `notifications`

The backend uses SQLite transactions so that a purchase or sale cannot partially succeed if an error occurs mid-process.

### Buy flow

A purchase transaction typically does this:

1. Resolve supplier and medicine information
2. Validate units, price, expiry date, and batch data
3. Insert purchase record
4. Add or update batch inventory in `medicine_batches`
5. Update medicine stock totals
6. Save activity log and notification
7. Commit the transaction

### Sell flow

A sales transaction usually does this:

1. Resolve medicine by name or ID
2. Select the earliest-expiring batch first (`expiry_date ASC`)
3. Allocate stock from available batches
4. Validate sale quantity against inventory
5. Create sales record
6. Decrease batch stock and medicine totals
7. Save customer and activity log if needed
8. Commit the transaction

This ensures stock movement remains consistent and avoids partial sales.

---

## 7. Activity and notifications

The backend includes two shared utility functions:

### `add_activity_log({ ... })`

Stores user actions in `activity_logs`, including:

- user id
- action name
- entity type
- entity id
- details

This provides audit tracking and dashboard data.

### `add_notification({ ... })`

Adds a notification to the `notifications` table for a user, usually after medical or operational events such as:

- stock low
- purchase/sale success
- system warnings

These records support dashboard and user-notification features.

---

## 8. Tracking and reporting flow

The tracking/reporting logic is designed to provide summarised business views.

It pulls information such as:

- monthly sales
- total purchases
- top suppliers
- recent activity
- transaction counts

The backend may read directly from live tables or from archived summary data depending on the request.

### Archive summary generation

The system has a function called `archive_database({ reason })` which:

1. ensures the archive directory exists
2. prepares a month tag such as `2026-10`
3. copies the current database snapshot and WAL/SHM files if present
4. creates a ZIP archive
5. builds a JSON summary file containing business stats
6. stores it under `data_test/archive/`

### Archive search flow

The backend exposes routes such as:

- `/archives` to list archived files
- `/archive/search` to search archives by month or keyword

This lets the system maintain searchable historical snapshots without keeping all data in the live database.

---

## 9. Monthly archive scheduler

The backend includes a scheduler that periodically checks whether a new monthly archive should be created.

Flow:

1. app startup triggers a monthly archive check
2. it compares the current month with the last archive month
3. if a new month is reached, it creates a new archive
4. it prevents creating a fresh archive on every restart

This makes the archive behavior stable and month-based instead of repeated on each app boot.

---

## 10. Graceful shutdown behavior

The backend attaches shutdown handlers for:

- `SIGINT`
- `SIGTERM`
- uncaught exceptions

`graceful_shutdown(signal)` does this:

1. logs the shutdown reason
2. tries to create an archive before closing
3. closes the SQLite connection
4. closes the HTTP server
5. exits the process cleanly

This makes the backend much safer during restarts, crashes, or host shutdowns.

---

## 11. Request lifecycle summary

A typical backend request follows this sequence:

1. Request enters Express
2. JSON body is parsed
3. Global middleware checks DB availability
4. Route handler checks session/authentication when required
5. Business validation occurs
6. Database read/write happens
7. Related tables are updated
8. Activity log or notification is written
9. Response is returned to client

---

## 12. Key system idea

The backend is structured as a SQLite-backed pharmacy management system where:

- requests are handled in Express routes
- the database is the system of record
- sessions are kept in memory for current login state
- business logic is implemented as direct SQL operations with helper functions
- archive logic protects long-term data continuity
- shutdown hooks prevent abrupt data loss

This is a practical server design for a small to medium medicine-management app, where backend logic stays centralized in one file and the database remains the main source of truth.
