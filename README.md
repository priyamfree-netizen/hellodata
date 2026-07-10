# BillSOS

AI-powered financial document automation. React + TanStack Start frontend,
Supabase (Postgres + Auth + Storage) backend, Cloudflare Workers deploy target.

## Quick start

```bash
npm install
cp .env.example .env.local
# fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

Open <http://localhost:5173>. Sign up at `/signup`. After signing up, in the
Supabase SQL editor:

```sql
update profiles
   set is_super_admin = true
 where email = 'you@example.com';
```

…to unlock `/admin`.

## Project layout

```
src/
├─ routes/                 # TanStack file-based router
│  ├─ admin/               # Super-admin console (operations, billing, users…)
│  ├─ settings/            # User+org settings
│  └─ *.tsx                # User-facing app (dashboard, upload, history…)
├─ components/             # UI components (shadcn-style + custom)
├─ lib/
│  ├─ supabase/
│  │   ├─ client.ts        # browser Supabase client (anon key)
│  │   ├─ server.ts        # server-only client (service role)
│  │   ├─ types.ts         # row type definitions
│  │   └─ auth.tsx         # <AuthProvider> + useAuth() hook
│  ├─ queries/index.ts     # ALL data access. One hook per domain.
│  ├─ format.ts            # display formatters (INR, bytes, relative time…)
│  └─ admin-data.ts        # display adapters: DB row → legacy UI shape
└─ server.ts               # SSR error wrapper (Cloudflare entry)

supabase/
├─ migrations/             # ordered SQL migrations (extensions, tables, RLS…)
├─ seed.sql                # dev-only sample data (supabase db reset)
└─ README.md               # backend setup walkthrough
```

## Architecture rules

- **No code in `src/` ever fabricates data.** Every list is read from a
  database table via a hook in `src/lib/queries/index.ts`.
- **One Supabase client** (`@/lib/supabase/client`) — never call
  `createClient` directly.
- **All routes consume hooks**, not raw `.from()` calls.
- **Display adapters** in `src/lib/admin-data.ts` map DB rows into the legacy
  UI shape so the admin pages didn't have to be rewritten.
- **RLS is on for every table** (see
  `supabase/migrations/…700_rls_policies.sql`). The browser client always
  goes through it; the service-role client (server-only) bypasses it for
  background workers.

## Backend setup

See [`supabase/README.md`](supabase/README.md) for the full walkthrough,
including how to apply migrations to a hosted project, run a local stack,
make a super admin, and regenerate types.

## Scripts

```bash
npm run dev              # vite dev server
npm run build            # production build
npm run build:dev        # build with development optimisations
npm run preview          # serve the built output
npm run lint             # eslint
npm run format           # prettier
```

## Deployment

The repo ships with `@cloudflare/vite-plugin` configured. Deploy with:

```bash
npx wrangler deploy
wrangler secret put VITE_SUPABASE_URL
wrangler secret put VITE_SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Verification checklist

- [ ] `npm run build` exits 0 with placeholder env vars
- [ ] `supabase db push` against a real Supabase project succeeds
- [ ] Sign up at `/signup` creates a row in `auth.users` and `profiles`
- [ ] Upload a PDF at `/upload`; row appears in `documents`, file appears in
      the `documents` storage bucket
- [ ] `/api-keys` create + reveal once + revoke flow works end-to-end
- [ ] After `update profiles set is_super_admin = true`, `/admin` renders
      with real KPIs / orgs / queue / vendor APIs
