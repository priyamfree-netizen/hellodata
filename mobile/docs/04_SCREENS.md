# BillSOS Mobile — Screens & Navigation

## Navigation shell

Bottom nav (authenticated + workspace‑ready), with a center **Scan** action:

```
[ Home ]  [ History ]  ( ⦿ Scan )  [ Templates ]  [ Settings ]
```

`go_router` branches:
- Auth stack (unauthenticated): Login, Signup, VerifyEmail, Forgot, Reset, MFA challenge.
- Onboarding stack (`no_workspace`): CreateWorkspace, Invitations.
- App shell (`ready`): the bottom‑nav branches above + pushed detail routes.
- `backend_error`: full‑screen retry (outside shell).

## Screen inventory

### Auth
| Screen | Route | Talks to |
|--------|-------|----------|
| Login | `/login` | `/api/auth/login` |
| MFA challenge | `/login/mfa` | `/api/auth/mfa/challenge/*` |
| Signup | `/signup` | `/api/auth/signup` |
| Verify email (pending + deep link) | `/verify-email` | `/api/auth/verify-email`, `/resend-verification` |
| Forgot password | `/forgot` | `/api/auth/forgot-password` |
| Reset password (deep link) | `/reset` | `/api/auth/reset-password` |

### Onboarding
| Create workspace | `/onboarding` | `create_first_organization` RPC |
| Invitations | `/invitations` | `/api/orgs/*`, `my_pending_invitations` |

### Home
| Dashboard | `/home` | dashboard KPI RPC, `documents`, `extractions` |

### Capture → Extract → Result
| Scan / capture | `/scan` | camera + Storage upload + `documents` insert |
| Configure | `/configure/:documentId` | `document_categories`, `templates`, `template_fields` |
| Processing | `/processing/:jobId` | `processing_jobs` Realtime |
| Output / result | `/output/:extractionId` | `extractions`, `extraction_fields`, signed URL |

### History
| History list | `/history` | `documents` / `processing_jobs` / `extractions` |
| History detail | → routes to Output | |

### Templates
| Templates browse | `/templates` | `document_categories`, `templates` |
| Template detail | `/templates/:id` | `templates`, `template_fields` |

### Settings
| Settings home | `/settings` | `profiles` |
| Edit profile | `/settings/profile` | `profiles` |
| Change password | `/settings/password` | `/api/auth/change-password` |
| Two‑factor auth | `/settings/2fa` | `/api/auth/mfa/*` |
| Active sessions | `/settings/sessions` | sessions query / revoke |
| Billing | `/settings/billing` | `subscriptions`, `credit_grants`, `admin_settings.free_plan` |
| Organization | `/settings/organization` | `organizations`, `organization_members`, `/api/orgs/*` |
| Workspace switcher | (sheet) | `organizations` |
| Notifications prefs | `/settings/notifications` | prefs |
| Support tickets | `/support` | `tickets`, `ticket_replies` |
| Contact | `/contact` | `contact_submissions` |
| About / legal | `/settings/about` | static |

### Global
| Notification inbox | `/notifications` | `notifications` |

## Deep links
- `verify-email?token=…` → Verify screen.
- `reset-password?token=…` → Reset screen.
- `invite?token=…` → Invitations accept.

Register both a custom scheme (`billsos://`) and https app links so email links open the
app when installed, web otherwise.

## Excluded (super‑admin, web only — never build)
`/admin/*` in all forms: users, organizations, plans, templates approval, queue,
analytics, reports, billing admin, feature flags, notifications broadcast, audit,
external‑api, support console, admin‑tools, settings.
