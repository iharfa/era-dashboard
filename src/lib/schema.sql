create table users (
  id text primary key,
  name text not null,
  email text unique not null,
  role text not null check (role in ('Admin', 'EIA Team', 'Reviewer', 'Data Entry')),
  active_status text not null default 'Active'
);

create table staff_profiles (
  id text primary key,
  user_id text references users(id),
  staff_name text not null,
  standardized_name text not null,
  team text,
  active_status text not null default 'Active'
);

create table projects (
  id text primary key,
  project_code text unique,
  application_type text,
  date_of_application date,
  project_name text,
  project_location text,
  island text,
  atoll text,
  proponent text,
  proponent_category text,
  consultant text,
  project_sector text,
  handler_id text references staff_profiles(id),
  support_staff_id text references staff_profiles(id),
  current_status text,
  report_submitted boolean,
  report_received_date date,
  category text,
  date_of_scoping date,
  tor_issued_date date,
  tor_number text,
  tor_expiry_date date,
  evaluation_deadline date,
  final_deadline date,
  lir_date date,
  lis_date date,
  decision_statement_date date,
  dnr_required boolean,
  shapefiles_submitted boolean,
  additional_comments text,
  data_completeness_score numeric,
  imported_source_sheet text,
  imported_row_number integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table audit_trail (
  id text primary key,
  record_type text not null,
  record_id text not null,
  field_changed text not null,
  old_value text,
  new_value text,
  changed_by text not null,
  user_role text not null,
  changed_at timestamptz not null default now(),
  reason text,
  change_source text not null check (change_source in ('import', 'manual correction', 'normal update'))
);

create table data_quality_issues (
  id text primary key,
  record_type text not null,
  record_id text not null,
  field_name text not null,
  issue_type text not null,
  original_value text,
  suggested_value text,
  status text not null default 'Open',
  assigned_to text,
  resolved_by text,
  resolved_at timestamptz,
  notes text
);
