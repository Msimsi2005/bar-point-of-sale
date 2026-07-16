
  # Bar Point of Sale

  This is a code bundle for Bar Point of Sale. The original project is available at https://www.figma.com/design/Pvip7q7z3us5s9YPp4825B/Bar-Point-of-Sale.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Production Setup (Supabase + Vercel)

  This app is configured to use Supabase online storage only.

  ### 1) Required frontend environment variables

  Set these in `.env` locally and in Vercel Project Settings -> Environment Variables:

  - `VITE_SUPABASE_URL=https://zqxxiyutriuqjovdknoi.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<your-anon-key>`
  - `VITE_API_BASE=https://zqxxiyutriuqjovdknoi.supabase.co/functions/v1/server`

  ### 2) Create/upgrade database tables

  In Supabase SQL Editor, run:

  - `src/lib/001_mistypos_schema.sql`

  This script creates and upgrades the `tenants` and `sales` tables and includes legacy migration handling.

  ### 3) Deploy edge function

  Run from project root:

  - `npx supabase login`
  - `npx supabase functions deploy server --project-ref zqxxiyutriuqjovdknoi`

  ### 3.1) Security secrets for edge function

  Configure these Supabase edge secrets before production launch:

  - `SUPERADMIN_EMAIL`
  - `SUPERADMIN_PASSWORDS` (comma-separated for rotation, for example `new-pass,old-pass`)
  - `RATE_LIMIT_GLOBAL_PER_MINUTE`
  - `RATE_LIMIT_LOGIN_PER_MINUTE`
  - `AUTH_MAX_FAILURES`
  - `AUTH_LOCK_MINUTES`
  - `TENANT_TOKEN_SECRET`

  ### 4) Verify backend is online

  Open this URL in browser:

  - `https://zqxxiyutriuqjovdknoi.supabase.co/functions/v1/server/health`

  Expected response: JSON containing `status: "ok"`.

  ### 5) Deploy frontend

  Push to GitHub and redeploy Vercel.

  ### 6) Keep Supabase + Vercel warm (avoid sleeping/cold starts)

  This repo includes [.github/workflows/keepalive.yml](.github/workflows/keepalive.yml), which runs every 30 minutes and pings your deployed endpoints.

  In GitHub -> Settings -> Secrets and variables -> Actions, add:

  - `KEEPALIVE_VERCEL_URL` = your production Vercel URL (for example `https://your-app.vercel.app`)
  - `KEEPALIVE_SUPABASE_HEALTH_URL` = your Supabase function health URL (for example `https://zqxxiyutriuqjovdknoi.supabase.co/functions/v1/server/health`)

  Notes:

  - Vercel static hosting does not truly "sleep", but this helps keep route/function paths warm.
  - Supabase free projects can pause after inactivity; regular health pings help prevent that.
  - For guaranteed no-pause behavior, use paid plans.

  ## Go-Live Operations Docs

  - `guidelines/Security-Hardening.md`
  - `guidelines/Backup-DR-Runbook.md`
  - `guidelines/Monitoring-SLA-UAT.md`

  Note: `vercel.json` is configured with filesystem handling before SPA fallback so JS assets are served correctly.
  