# Mokap Backend (Laravel)

This directory contains the Laravel backend for Mokap.

## Requirements

- PHP **8.3+** (this project currently requires PHP 8.3+ via `composer.json`)
- [Composer](https://getcomposer.org/)
- Optional database (SQLite, MySQL, MariaDB, or PostgreSQL)

## Local setup

From the repository root:

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

The API/backend will then be available at `http://127.0.0.1:8000`.

> The `touch database/database.sqlite` step is only needed when using the default SQLite setup from `.env.example`. If you prefer MySQL/PostgreSQL, update your `.env` database settings first.

## Frontend + backend integration (local)

The existing frontend in this repository is still a static app.

1. Run the frontend on a static server from the repo root (example):
   ```bash
   python3 -m http.server 8080
   ```
2. Run Laravel from `backend/` on port `8000`:
   ```bash
   php artisan serve --host=127.0.0.1 --port=8000
   ```
3. Use `http://127.0.0.1:8000` as the backend/API base URL from the frontend.
