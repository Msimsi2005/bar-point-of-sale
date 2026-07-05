# Monitoring, SLA, and UAT Sign-Off

## 1) Monitoring and Alerting

Set these monitors before full launch:

1. Uptime monitor: `GET /server/health` every 60s.
2. Error-rate monitor: edge function HTTP 5xx threshold alert.
3. Auth abuse monitor: repeated 401/429 spikes.
4. Database capacity monitor: storage and connection saturation.
5. Log retention check: verify retention policy and export destination.

## 2) SLA Baseline

- Availability target: 99.9%
- P1 response target: 15 minutes
- P1 workaround target: 2 hours
- Incident postmortem target: 48 hours

## 3) UAT Checklist (All Roles)

### Owner
- [ ] Login and PIN access
- [ ] Open, edit, and charge tab
- [ ] Receipt template edits via superadmin are reflected
- [ ] View sales dashboard and totals
- [ ] Manage staff and permissions

### Manager
- [ ] Login and PIN access
- [ ] Open and charge tabs
- [ ] View sales allowed by permissions
- [ ] Stock receive flow and audit record

### Bartender
- [ ] Login and PIN access
- [ ] Open and edit tabs
- [ ] Charge with enabled methods only
- [ ] Cannot access restricted admin sections

### Superadmin
- [ ] Create business
- [ ] Pause/resume business
- [ ] Reset business password
- [ ] Update receipt template per tenant
- [ ] Verify template persistence and restore

## 4) UAT Sign-Off Record

- UAT date:
- Environment:
- Owner sign-off:
- Manager sign-off:
- Superadmin sign-off:
- Open defects (if any):
