export type Role = "Admin" | "EIA Team" | "Reviewer" | "Data Entry";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active_status: string;
};

export type Project = {
  id: string;
  project_code: string;
  application_type: string;
  date_of_application: string;
  project_name: string;
  project_location: string;
  island: string;
  atoll: string;
  proponent: string;
  proponent_category: string;
  consultant: string;
  project_sector: string;
  handler: string;
  support_staff: string;
  reviewed_by?: string;
  current_status: string;
  report_submitted?: boolean | null;
  report_received_date: string;
  category: string;
  date_of_scoping: string;
  tor_issued_date: string;
  tor_number: string;
  tor_expiry_date: string;
  evaluation_deadline: string;
  final_deadline: string;
  lir_date: string;
  lis_date: string;
  decision_statement_date: string;
  dnr_required?: boolean | null;
  shapefiles_submitted?: boolean | null;
  additional_comments: string;
  document_link?: string;
  monitoring_status?: string;
  data_completeness_score: number;
  imported_source_sheet: string;
  imported_row_number: number;
  dnr_permit_ids?: string[];
  vegetation_permit_ids?: string[];
  raw?: Record<string, unknown>;
};

export type SimpleRecord = Record<string, unknown> & {
  id: string;
  data_completeness_score?: number;
  imported_source_sheet?: string;
  imported_row_number?: number;
};

export type DataQualityIssue = {
  id: string;
  record_type: string;
  record_id: string;
  field_name: string;
  issue_type: string;
  original_value: string;
  suggested_value: string;
  status: string;
  assigned_to: string;
  resolved_by: string;
  resolved_at: string;
  notes: string;
};

export type AuditEvent = {
  id: string;
  record_type: string;
  record_id: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  changed_by: string;
  user_role: string;
  changed_at: string;
  reason: string;
  change_source: string;
};

export type SeedData = {
  meta: {
    source_file: string;
    generated_at: string;
    counts: Record<string, number>;
  };
  lookups: {
    roles: string[];
    staff: string[];
    atolls: string[];
    islands: string[];
    application_types: string[];
    project_sectors: string[];
    proponent_categories: string[];
    statuses: string[];
    monitoring_frequency: string[];
    document_types: string[];
  };
  users: User[];
  projects: Project[];
  screening_applications: SimpleRecord[];
  dnr_permits: SimpleRecord[];
  vegetation_permits: SimpleRecord[];
  monitoring_schedules: SimpleRecord[];
  monitoring_due_items: SimpleRecord[];
  monitoring_reports: SimpleRecord[];
  inspections: SimpleRecord[];
  inspection_schedules: SimpleRecord[];
  cat4_reviews: SimpleRecord[];
  documents: SimpleRecord[];
  data_quality_issues: DataQualityIssue[];
  audit_trail: AuditEvent[];
  raw_imports: SimpleRecord[];
};

export type AppData = SeedData;
