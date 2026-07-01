
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

  - `src/lib/001_pourpos_schema.sql`

  This script creates and upgrades the `tenants` and `sales` tables and includes legacy migration handling.

  ### 3) Deploy edge function

  Run from project root:

  - `npx supabase login`
  - `npx supabase functions deploy server --project-ref zqxxiyutriuqjovdknoi`

  ### 4) Verify backend is online

  Open this URL in browser:

  - `https://zqxxiyutriuqjovdknoi.supabase.co/functions/v1/server/health`

  Expected response: JSON containing `status: "ok"`.

  ### 5) Deploy frontend

  Push to GitHub and redeploy Vercel.

  Note: `vercel.json` is configured with filesystem handling before SPA fallback so JS assets are served correctly.
  