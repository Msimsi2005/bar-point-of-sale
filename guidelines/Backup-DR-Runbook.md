# Backup and Disaster Recovery Runbook

## Scope

This runbook validates that tenant and sales data can be backed up and restored.

## 1) Backup Procedure (Weekly)

1. Create a timestamped backup folder.
2. Run Supabase DB dump.
3. Store encrypted backup in two locations.

Example commands:

```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -ItemType Directory -Path ".\\backups\\$ts" -Force | Out-Null
supabase db dump --project-ref zqxxiyutriuqjovdknoi -f ".\\backups\\$ts\\schema_and_data.sql"
```

## 2) Restore Drill (Monthly)

1. Restore dump into a non-production verification database.
2. Validate row counts and recent transactions.
3. Validate login and sales query endpoints against restored instance.

Validation SQL examples:

```sql
select count(*) as tenants_count from tenants;
select count(*) as sales_count from sales;
select max(saved_at) as latest_sale from sales;
```

## 3) Recovery Objectives

- Target RPO: 24 hours
- Target RTO: 4 hours

## 4) DR Checklist

- [ ] Latest backup exists and is readable
- [ ] Restore drill completed in last 30 days
- [ ] Tenant login verified after restore
- [ ] Sales data integrity spot-check passed
- [ ] Drill evidence captured (date, owner, duration)
