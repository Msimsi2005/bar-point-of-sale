# Security Hardening (MISTYPOS)

This checklist is required before full production go-live.

## 1) Required Edge Function Environment Variables

Set these in Supabase Edge Function secrets:

- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORDS` (comma-separated for safe rotation, example: `new-pass,old-pass`)
- `RATE_LIMIT_GLOBAL_PER_MINUTE` (default: `240`)
- `RATE_LIMIT_LOGIN_PER_MINUTE` (default: `15`)
- `AUTH_MAX_FAILURES` (default: `5`)
- `AUTH_LOCK_MINUTES` (default: `15`)
- `TENANT_TOKEN_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

## 2) Secret Rotation Procedure

1. Generate a new strong superadmin password.
2. Set `SUPERADMIN_PASSWORDS` to `newPassword,oldPassword`.
3. Deploy edge function.
4. Verify superadmin login with `newPassword`.
5. Remove old password so `SUPERADMIN_PASSWORDS` only contains `newPassword`.
6. Deploy edge function again.

## 3) Brute-Force and Rate-Limit Verification

Run quick checks:

1. Send more than `RATE_LIMIT_LOGIN_PER_MINUTE` login calls in 1 minute.
2. Confirm login endpoints return HTTP `429`.
3. Trigger invalid login attempts over `AUTH_MAX_FAILURES`.
4. Confirm account lock returns HTTP `429` and `Retry-After` header.

## 4) Audit Trail Verification

The edge function emits structured audit events to logs:

- `admin.login`
- `tenant.login`
- `tenant.auth`
- `rate_limit.global`

Verify logs in Supabase Function logs and configure retention/export in your monitoring stack.

## 5) Security Sign-Off

- [ ] Env vars configured in Supabase secrets
- [ ] Secret rotation completed and tested
- [ ] Brute-force lockout test passed
- [ ] Rate limit test passed
- [ ] Audit events visible in logs
