# BillSOS Mobile — Overview

> **Status:** Planning + Phase 0 build in progress
> **Platform:** Flutter (iOS + Android)
> **Scope:** End‑user side only. **No super‑admin.** All administration stays on the existing web app.

---

## 1. What this is

BillSOS is a **data‑entry automation SaaS**. Users upload documents (invoices, bills,
bank statements, receipts, etc.), the platform runs OCR + AI field extraction against a
chosen **template**, and returns structured data that can be reviewed, edited and
exported (CSV / Excel).

The existing product is a **web app** built with TanStack Start (React) + Supabase +
Cloudflare Workers. This project adds a **Flutter mobile app** that reuses the exact
same backend (Supabase + the Cloudflare Worker `/api/*` endpoints). No new backend is
being built — the mobile app is a second client on the same API.

## 2. Why mobile

The natural mobile advantage is **capture at the source**: point the phone camera at a
paper invoice or receipt, auto‑crop it, upload, and get structured data back in seconds.
Desktop users have to scan/photograph first and then upload — mobile collapses that into
one step. So the mobile app is not a shrunk‑down web app; its center of gravity is the
**Scan → Extract → Review → Export** loop.

## 3. Scope boundary — user side only

**In scope (mirrors the web user routes):**

| Area | Web routes it corresponds to |
|------|------------------------------|
| Auth (login, signup, verify email, forgot/reset password, **MFA**) | `login`, `signup`, `verify-email`, `forgot-password`, `reset-password` |
| Onboarding / workspace creation | `onboarding` |
| Dashboard / KPIs | `dashboard` |
| Document capture & upload | `upload` |
| Configure extraction (template/category) | `configure`, `categories`, `templates` |
| Processing (realtime job status) | `processing` |
| Output / results / export | `output` |
| History | `history` |
| Settings: profile, billing (view), organization, 2FA, sessions | `settings/*` |
| Support tickets + contact | `support`, `contact` |
| Pricing / plans (view) | `pricing` |
| Notifications inbox + push | (bell inbox in app shell) |

**Explicitly OUT of scope (web super‑admin only — never built in mobile):**

- Everything under `routes/admin/*`: user management, org management, plans editor,
  templates approval, queue, analytics, reports, billing admin, feature flags,
  notifications broadcast, audit log browser, external‑api config, support console,
  admin tools.
- Any screen gated by `is_super_admin` or `requireSuperAdmin`.

The mobile app must **never** request or render super‑admin data, even if a user's token
carries `is_super_admin: true`. Admin stays exclusively on web.

## 4. Guiding principles

1. **Reuse the backend as‑is.** Prefer no backend changes. Where a change is genuinely
   needed for mobile (see the one refresh‑token note in `02_BACKEND_INTEGRATION.md`),
   flag it explicitly and keep it additive — never break the web client.
2. **Same auth model.** The access token is a Supabase‑compatible JWT signed with
   `SUPABASE_JWT_SECRET`; it works directly against Supabase PostgREST + Storage with RLS.
   The mobile app injects it exactly like the web client does.
3. **Camera‑first.** The capture flow is the product's mobile identity — invest there.
4. **Offline‑tolerant, not offline‑first.** Cache reads, queue uploads when possible,
   but the source of truth is always the backend.
5. **One deliverable per phase.** Each phase in `03_PHASE_PLAN.md` ends with something
   demoable and testable.

## 5. Documents in this folder

- `00_OVERVIEW.md` — this file.
- `01_ARCHITECTURE.md` — tech stack, app layering, state management, folder layout.
- `02_BACKEND_INTEGRATION.md` — auth flow, API endpoints, Supabase tables/storage the
  app consumes, and the mobile‑specific token/refresh decisions.
- `03_PHASE_PLAN.md` — the phased build roadmap (the master checklist).
- `04_SCREENS.md` — screen inventory + navigation map.
- `05_DEV_SETUP.md` — how to configure and run the Flutter app.
