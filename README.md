# ERA Monitoring Dashboard

Role-based internal monitoring dashboard for ERA EIA applications, reviews, DNR permits, vegetation permits, monitoring reports, inspections, workload, data completeness, data cleaning, and audit history.

## What is included

- Next.js app ready for Vercel.
- Seed data generated from the uploaded Excel workbook.
- Demo login with these roles:
  - Admin
  - EIA Team
  - Reviewer
  - Data Entry
- Management dashboard.
- Staff workload dashboard.
- Searchable project register.
- Project detail view with EIA, DNR, vegetation, data quality, documents, and audit panels.
- Monitoring report and Category 4 review views.
- Inspection records and inspection schedule.
- Data entry forms.
- Data cleaning workspace.
- Audit trail for imports, manual updates, and corrections.

## Current storage model

The app ships with seeded JSON data and browser localStorage persistence. This lets you host it on Vercel and test the workflow immediately.

For real multi-user production use, connect a database such as Supabase, Neon Postgres, or Vercel Postgres. Vercel alone does not persist shared edits across users.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Next.js.

## Build for Vercel

```bash
npm install
npm run build
```

Then push this folder to GitHub and import the repository into Vercel.

## Regenerate seed data from the Excel workbook

The importer reads the workbook from:

```text
/workspace/.cache/02-2026_Assessment-and-Monitoring-Updates_NEW_FINAL-2-1-.xlsx
```

Run:

```bash
npm run seed
```

This writes:

```text
src/data/seedData.json
```

## Production database upgrade path

Move the current JSON collections into real tables:

- users
- staff_profiles
- projects
- screening_applications
- dnr_permits
- vegetation_permits
- monitoring_schedules
- monitoring_due_items
- monitoring_reports
- inspections
- documents
- data_quality_issues
- audit_trail

Keep the audit trail insert on every create, update, correction, and import.
