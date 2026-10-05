# Free preview hosting (Vercel + Neon)

A quick way to see the dashboard live before the production server
(see `deploy.md`) is set up. Both services have free plans.

## One-time setup

1. Sign in at vercel.com with GitHub and import the `OggyRF/dashboard`
   repository. Leave every build setting as it is.
2. In the Vercel project, open **Storage → Create Database → Neon**, pick the
   Singapore region, and connect it to the project. This adds `DATABASE_URL`
   and `DATABASE_URL_UNPOOLED` automatically.
3. In **Settings → Environment Variables**, add `CRON_SECRET` with any long
   random text (it lets Vercel run the nightly job).
4. **Deployments → Redeploy.** The build runs the database migrations
   (`vercel-build` in package.json) before building the app.
5. Open the site. With an empty database it shows **First-time setup**,
   where the first owner creates their own account. That screen closes for
   good once any account exists; everyone else is added from the Team page.

## How it differs from the production server

- No separate worker. `vercel.json` schedules `/api/cron/daily` once a day at
  about 01:00 India time; it closes the previous day's open attendance as of
  23:59 and removes expired sessions.
- Every push to `main` redeploys automatically.
- Later phases that need the worker (Google syncs, report PDFs) will need the
  production setup in `deploy.md`.
