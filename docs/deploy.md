# Deploying to team.hidigital.co.in

The website stays on Hostinger. The app runs on its own small server and is reached at
`team.hidigital.co.in`; `hidigital.co.in/team-login` redirects there.

## 1. Server and database

1. Create a VPS (2 vCPU, 4 GB RAM, Ubuntu 24.04) in Bangalore, for example on DigitalOcean.
2. Create a managed PostgreSQL 16 database in the same region with daily backups and
   point-in-time recovery. Allow connections only from the VPS.
3. On the VPS install Docker, then clone the repository to `/opt/hidigital`.
4. Create `/opt/hidigital/.env` from `.env.example` (`chmod 600 .env`). Set `DATABASE_URL`
   to the managed database URL with `?sslmode=require`, `APP_URL=https://team.hidigital.co.in`,
   `APP_DOMAIN=team.hidigital.co.in` and `ACME_EMAIL`.

## 2. DNS on Hostinger

In Hostinger hPanel, open Domains, hidigital.co.in, DNS / Nameservers, and add:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | team | the VPS IPv4 address | 3600 |

Nothing else in the website's DNS changes.

## 3. The /team-login redirect on the main site

- WordPress: install a redirect plugin (for example "Redirection") and add a 301 from
  `/team-login` to `https://team.hidigital.co.in/login`.
- Otherwise add this line to the site's `.htaccess` in Hostinger's File Manager:

```
Redirect 301 /team-login https://team.hidigital.co.in/login
```

## 4. Start the app

```bash
cd /opt/hidigital
docker compose build
docker compose up -d          # runs migrations, then web, worker and Caddy
docker compose run --rm web npx tsx scripts/create-owner.ts --name "Aarif" --email aarif@hidigital.co.in
```

Caddy requests the HTTPS certificate on first start once the DNS record resolves.
Check `https://team.hidigital.co.in/api/health` returns `{"status":"ok"}`.

## 5. Updating

```bash
git pull && docker compose build && docker compose up -d
```

Migrations run automatically before the new web and worker containers start.
To roll back, check out the previous commit and run the same two commands.

## 6. Backups

- The managed database keeps daily backups with 7-day point-in-time recovery.
- Add a nightly `pg_dump` copied to Cloudflare R2 (30 daily, 12 monthly) once R2 is set up
  in a later phase, and test a restore to staging every month.

## Never put these in the repository

Database URL and password, Google client secret and tokens, the token encryption key,
API keys (DataForSEO, email, R2, Sentry), any `.env` file, any database dump.
