import type { AppData, AuditEvent, Project, User } from "./types";

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const valueText = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "Blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

export const pct = (value: number | undefined) => `${Math.round(value || 0)}%`;

export const daysBetween = (date: string) => {
  if (!date) return null;
  const left = new Date(date + "T00:00:00").getTime();
  if (Number.isNaN(left)) return null;
  const now = new Date(todayIso() + "T00:00:00").getTime();
  return Math.round((left - now) / 86400000);
};

export const isOverdue = (date: string, status?: string) => {
  const days = daysBetween(date);
  const closed = ["completed", "approved", "waived", "not applicable"].includes((status || "").toLowerCase());
  return days !== null && days < 0 && !closed;
};

export const isDueSoon = (date: string, status?: string) => {
  const days = daysBetween(date);
  const closed = ["completed", "approved", "waived", "not applicable"].includes((status || "").toLowerCase());
  return days !== null && days >= 0 && days <= 14 && !closed;
};

export const canEditRecord = (user: User, record: Record<string, unknown>) => {
  if (user.role === "Admin") return true;
  const assigned = [record.handler, record.support_staff, record.reviewed_by, record.assigned_to, record.assigned_to_name]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  if (user.role === "Data Entry") return true;
  if (user.role === "Reviewer") {
    return assigned.includes(user.name.toLowerCase());
  }
  if (user.role === "EIA Team") {
    return assigned.includes(user.name.toLowerCase());
  }
  return false;
};

export const addAudit = (
  data: AppData,
  user: User,
  recordType: string,
  recordId: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
  source = "normal update"
) => {
  const event: AuditEvent = {
    id: `audit-local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    record_type: recordType,
    record_id: recordId,
    field_changed: field,
    old_value: valueText(oldValue),
    new_value: valueText(newValue),
    changed_by: user.name,
    user_role: user.role,
    changed_at: new Date().toISOString(),
    reason,
    change_source: source
  };
  return { ...data, audit_trail: [event, ...data.audit_trail] };
};

export const average = (items: number[]) => {
  const clean = items.filter((item) => Number.isFinite(item));
  if (!clean.length) return 0;
  return clean.reduce((sum, item) => sum + item, 0) / clean.length;
};

export const groupCount = <T extends Record<string, unknown>>(items: T[], field: keyof T) => {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = valueText(item[field]);
    if (key === "Blank") continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

export const workloadForStaff = (data: AppData) => {
  return data.lookups.staff.map((staff) => {
    const projectsAsHandler = data.projects.filter((p) => p.handler === staff).length;
    const projectsAsSupport = data.projects.filter((p) => p.support_staff === staff).length;
    const reviews = data.monitoring_reports.filter((r) => r.reviewed_by === staff).length;
    const dnr = data.dnr_permits.filter((r) => r.handler === staff || r.support_staff === staff).length;
    const inspections = data.inspections.filter((r) => String(r.assigned_to || "").toLowerCase().includes(staff.toLowerCase())).length;
    const completeness = average(
      data.projects
        .filter((p) => p.handler === staff || p.support_staff === staff)
        .map((p) => p.data_completeness_score)
    );
    return {
      staff,
      total: projectsAsHandler + projectsAsSupport + reviews + dnr + inspections,
      projectsAsHandler,
      projectsAsSupport,
      reviews,
      dnr,
      inspections,
      completeness: Math.round(completeness)
    };
  }).sort((a, b) => b.total - a.total);
};

export const projectStatus = (project: Project) => {
  if (project.decision_statement_date) return "Approved";
  if (project.final_deadline && isOverdue(project.final_deadline, project.current_status)) return "Overdue";
  if (project.report_received_date) return "In Review";
  if (project.tor_issued_date) return "ToR issued";
  return project.current_status || "Imported";
};
