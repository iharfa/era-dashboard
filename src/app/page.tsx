"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import seedJson from "@/data/seedData.json";
import type { AppData, DataQualityIssue, Project, SimpleRecord, User } from "@/lib/types";
import {
  addAudit,
  average,
  canEditRecord,
  groupCount,
  isDueSoon,
  isOverdue,
  pct,
  projectStatus,
  todayIso,
  workloadForStaff
} from "@/lib/helpers";

const seedData = seedJson as unknown as AppData;

const collectionMap: Record<string, keyof AppData> = {
  projects: "projects",
  screening_applications: "screening_applications",
  dnr_permits: "dnr_permits",
  vegetation_permits: "vegetation_permits",
  monitoring_reports: "monitoring_reports",
  inspections: "inspections",
  documents: "documents",
  monitoring_schedules: "monitoring_schedules",
  data_quality_issues: "data_quality_issues"
};

type Tab = "management" | "workload" | "projects" | "monitoring" | "inspections" | "cleaning" | "entry" | "audit";

export default function Home() {
  const [data, setData] = useState<AppData>(seedData);
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("management");
  const [userId, setUserId] = useState(seedData.users.find((u) => u.name === "ERA Management")?.id || seedData.users[0]?.id || "");
  const [search, setSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(seedData.projects[0]?.id || "");
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  useEffect(() => {
    const saved = window.localStorage.getItem("era-monitoring-dashboard-data");
    const savedUser = window.localStorage.getItem("era-monitoring-dashboard-user");
    if (saved) {
      try {
        setData(JSON.parse(saved) as AppData);
      } catch {
        setData(seedData);
      }
    }
    if (savedUser) setUserId(savedUser);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem("era-monitoring-dashboard-data", JSON.stringify(data));
  }, [data, ready]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem("era-monitoring-dashboard-user", userId);
  }, [userId, ready]);

  const fallbackUser: User = {
    id: "fallback",
    name: "ERA Management",
    email: "management@era.local",
    role: "Admin",
    active_status: "Active"
  };
  const currentUser = data.users.find((u) => u.id === userId) || data.users[0] || fallbackUser;
  const selectedProject = data.projects.find((p) => p.id === selectedProjectId) || data.projects[0] || null;

  const filteredProjects = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return data.projects;
    return data.projects.filter((project) =>
      [project.project_code, project.project_name, project.island, project.atoll, project.proponent, project.project_sector, project.handler, project.support_staff, project.current_status]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [data.projects, search]);

  const metrics = useMemo(() => {
    const pendingReviews = data.projects.filter((p) => !["approved", "completed"].includes(projectStatus(p).toLowerCase())).length;
    const overdueReviews = data.projects.filter((p) => isOverdue(p.final_deadline || p.evaluation_deadline, p.current_status)).length;
    const dueSoon = data.projects.filter((p) => isDueSoon(p.final_deadline || p.evaluation_deadline, p.current_status)).length;
    const approved = data.projects.filter((p) => projectStatus(p) === "Approved").length;
    const dnrIssued = data.dnr_permits.filter((p) => Boolean(p.permit_issued_date)).length;
    const monitoringOverdue = data.monitoring_reports.filter((r) => isOverdue(String(r.deadline || ""), String(r.status || ""))).length;
    const inspectionsPending = data.inspections.filter((r) => !["complete", "completed"].includes(String(r.report_status || "").toLowerCase())).length;
    return {
      totalProjects: data.projects.length,
      activeProjects: pendingReviews,
      pendingReviews,
      overdueReviews,
      dueSoon,
      approved,
      dnrIssued,
      monitoringReports: data.monitoring_reports.length,
      monitoringOverdue,
      inspectionsPending,
      averageCompleteness: Math.round(average(data.projects.map((p) => p.data_completeness_score))),
      openIssues: data.data_quality_issues.filter((issue) => issue.status !== "Resolved").length
    };
  }, [data]);

  const workloads = useMemo(() => workloadForStaff(data), [data]);
  const myWork = useMemo(() => {
    const name = currentUser.name.toLowerCase();
    return {
      handlerProjects: data.projects.filter((p) => p.handler.toLowerCase() === name),
      supportProjects: data.projects.filter((p) => p.support_staff.toLowerCase() === name),
      reviews: data.monitoring_reports.filter((r) => String(r.reviewed_by || "").toLowerCase() === name),
      inspections: data.inspections.filter((r) => String(r.assigned_to || "").toLowerCase().includes(name)),
      issues: data.data_quality_issues.filter((r) => String(r.assigned_to || "").toLowerCase() === name && r.status !== "Resolved")
    };
  }, [data, currentUser]);

  function updateCollectionRecord<T extends SimpleRecord>(
    collection: keyof AppData,
    recordType: string,
    id: string,
    field: string,
    value: unknown,
    reason: string,
    source = "normal update"
  ) {
    setData((prev) => {
      const records = prev[collection];
      if (!Array.isArray(records)) return prev;
      const target = records.find((item) => item.id === id) as T | undefined;
      if (!target || !canEditRecord(currentUser, target)) return prev;
      const withAudit = addAudit(prev, currentUser, recordType, id, field, target[field], value, reason, source);
      const updated = (records as T[]).map((item) => (item.id === id ? { ...item, [field]: value } : item));
      return { ...withAudit, [collection]: updated };
    });
  }

  function resolveIssue(issue: DataQualityIssue) {
    const correction = corrections[issue.id] ?? issue.suggested_value;
    setData((prev) => {
      let next = { ...prev };
      const collection = collectionMap[issue.record_type] || collectionMap.projects;
      const records = next[collection];
      if (Array.isArray(records) && correction !== "") {
        const target = records.find((item) => (item as SimpleRecord).id === issue.record_id) as SimpleRecord | undefined;
        if (target) {
          next = addAudit(next, currentUser, issue.record_type, issue.record_id, issue.field_name, target[issue.field_name], correction, "Data quality correction", "manual correction");
          next = {
            ...next,
            [collection]: (records as SimpleRecord[]).map((item) => (item.id === issue.record_id ? { ...item, [issue.field_name]: correction } : item))
          };
        }
      }
      next = {
        ...next,
        data_quality_issues: next.data_quality_issues.map((item) =>
          item.id === issue.id
            ? { ...item, status: "Resolved", resolved_by: currentUser.name, resolved_at: new Date().toISOString(), suggested_value: correction || item.suggested_value }
            : item
        )
      };
      return addAudit(next, currentUser, "data_quality_issues", issue.id, "status", issue.status, "Resolved", "Issue resolved", "manual correction");
    });
  }

  function resetDemoData() {
    window.localStorage.removeItem("era-monitoring-dashboard-data");
    setData(seedData);
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">ERA internal monitoring system</p>
          <h1>EIA assessment and monitoring dashboard</h1>
          <p className="heroText">
            Seeded from the uploaded workbook. The app tracks applications, permits, monitoring reports, inspections, workload, data quality, and audit history.
          </p>
        </div>
        <div className="loginCard">
          <label>Demo login</label>
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
          <p>
            Current role: <strong>{currentUser.role}</strong>
          </p>
          <button className="ghost" onClick={resetDemoData}>
            Reset local edits
          </button>
        </div>
      </header>

      <section className="metaStrip">
        <span>Source: {data.meta.source_file}</span>
        <span>Generated: {data.meta.generated_at}</span>
        <span>{data.audit_trail.length.toLocaleString()} audit events</span>
        <span>{metrics.openIssues.toLocaleString()} open data issues</span>
      </section>

      <nav className="tabs" aria-label="Dashboard sections">
        {[
          ["management", "Management"],
          ["workload", "My workload"],
          ["projects", "Project register"],
          ["monitoring", "Monitoring"],
          ["inspections", "Inspections"],
          ["cleaning", "Data cleaning"],
          ["entry", "Data entry"],
          ["audit", "Audit trail"]
        ].map(([id, label]) => (
          <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id as Tab)}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "management" && (
        <section className="section">
          <div className="grid kpiGrid">
            <Kpi label="Total projects" value={metrics.totalProjects} detail="EIA app and review records" />
            <Kpi label="Active projects" value={metrics.activeProjects} detail="Not approved or completed" />
            <Kpi label="Overdue reviews" value={metrics.overdueReviews} detail={`${metrics.dueSoon} due in 14 days`} tone={metrics.overdueReviews ? "bad" : "good"} />
            <Kpi label="DNR permits issued" value={metrics.dnrIssued} detail={`${data.dnr_permits.length} DNR permit records`} />
            <Kpi label="Monitoring reports" value={metrics.monitoringReports} detail={`${metrics.monitoringOverdue} overdue by deadline`} />
            <Kpi label="Avg completeness" value={pct(metrics.averageCompleteness)} detail={`${metrics.openIssues} data issues open`} tone={metrics.averageCompleteness < 70 ? "bad" : "good"} />
          </div>

          <div className="grid two">
            <Panel title="Workload by staff" subtitle="Projects, reviews, permits, and inspections">
              <BarList rows={workloads.slice(0, 10).map((item) => ({ label: item.staff, value: item.total, detail: `${item.completeness}% complete` }))} />
            </Panel>
            <Panel title="Projects by atoll" subtitle="Top locations in imported project records">
              <BarList rows={groupCount(data.projects, "atoll").slice(0, 10)} />
            </Panel>
            <Panel title="Projects by sector" subtitle="Imported project location and sector classification">
              <BarList rows={groupCount(data.projects, "project_location").slice(0, 10)} />
            </Panel>
            <Panel title="Data completeness risks" subtitle="Projects below 70 percent completeness">
              <Table
                rows={data.projects.filter((p) => p.data_completeness_score < 70).slice(0, 8)}
                columns={[
                  ["project_code", "Code"],
                  ["project_name", "Project"],
                  ["handler", "Handler"],
                  ["data_completeness_score", "Score"]
                ]}
                onRowClick={(row) => {
                  setSelectedProjectId(row.id);
                  setActiveTab("projects");
                }}
              />
            </Panel>
          </div>
        </section>
      )}

      {activeTab === "workload" && (
        <section className="section">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Logged-in staff view</p>
              <h2>{currentUser.name}</h2>
            </div>
            <span className="pill">{currentUser.role}</span>
          </div>
          <div className="grid kpiGrid">
            <Kpi label="Handler projects" value={myWork.handlerProjects.length} />
            <Kpi label="Support projects" value={myWork.supportProjects.length} />
            <Kpi label="Monitoring reviews" value={myWork.reviews.length} />
            <Kpi label="Inspections assigned" value={myWork.inspections.length} />
            <Kpi label="Open data issues" value={myWork.issues.length} tone={myWork.issues.length ? "bad" : "good"} />
          </div>
          <div className="grid two">
            <Panel title="Assigned projects" subtitle="Records where you are handler or support staff">
              <Table rows={[...myWork.handlerProjects, ...myWork.supportProjects].slice(0, 12)} columns={[["project_code", "Code"], ["project_name", "Project"], ["island", "Island"], ["current_status", "Status"], ["data_completeness_score", "Score"]]} onRowClick={(row) => { setSelectedProjectId(row.id); setActiveTab("projects"); }} />
            </Panel>
            <Panel title="Upcoming deadlines" subtitle="Evaluation and final deadlines in imported project records">
              <Table
                rows={[...myWork.handlerProjects, ...myWork.supportProjects]
                  .filter((p) => p.final_deadline || p.evaluation_deadline)
                  .sort((a, b) => String(a.final_deadline || a.evaluation_deadline).localeCompare(String(b.final_deadline || b.evaluation_deadline)))
                  .slice(0, 12)}
                columns={[["project_code", "Code"], ["project_name", "Project"], ["evaluation_deadline", "Evaluation"], ["final_deadline", "Final"]]}
              />
            </Panel>
          </div>
        </section>
      )}

      {activeTab === "projects" && (
        <section className="section">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Project register</p>
              <h2>All projects are visible. Edits follow role assignment.</h2>
            </div>
            <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, island, atoll, proponent, staff..." />
          </div>
          <div className="grid split">
            <Panel title={`${filteredProjects.length} project records`} subtitle="Click a row to open the detail panel">
              <Table
                rows={filteredProjects.slice(0, 100)}
                columns={[["project_code", "Code"], ["project_name", "Project"], ["island", "Island"], ["atoll", "Atoll"], ["handler", "Handler"], ["current_status", "Status"], ["data_completeness_score", "Score"]]}
                onRowClick={(row) => setSelectedProjectId(row.id)}
              />
            </Panel>
            <ProjectDetail project={selectedProject} data={data} user={currentUser} updateRecord={updateCollectionRecord} />
          </div>
        </section>
      )}

      {activeTab === "monitoring" && (
        <section className="section">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Monitoring reports</p>
              <h2>Submission and review tracking</h2>
            </div>
          </div>
          <div className="grid two">
            <Panel title="Monitoring report submissions" subtitle="Imported from Monitoring 2025-2026">
              <Table rows={data.monitoring_reports.slice(0, 80)} columns={[["report_number", "Report no."], ["date_of_submission", "Submitted"], ["report_name", "Report"], ["proponent", "Proponent"], ["reviewed_by", "Reviewer"], ["status", "Status"]]} />
            </Panel>
            <Panel title="Category 4 review roster" subtitle="Reviewer and support staff assignments">
              <Table rows={data.cat4_reviews} columns={[["report_number", "Report"], ["date", "Date"], ["reviewer_1", "Reviewer 1"], ["reviewer_2", "Reviewer 2"], ["support_staff", "Support"], ["status", "Status"]]} />
            </Panel>
          </div>
        </section>
      )}

      {activeTab === "inspections" && (
        <section className="section">
          <div className="grid two">
            <Panel title="Inspection records" subtitle="Imported post-EIA inspections">
              <Table rows={data.inspections} columns={[["inspection_date_text", "Date"], ["atoll", "Atoll"], ["island", "Island"], ["project_name", "Project"], ["assigned_to", "Assigned"], ["report_status", "Status"]]} />
            </Panel>
            <Panel title="Inspection schedule" subtitle="Tentative staff availability">
              <div className="scheduleList">
                {data.inspection_schedules.map((item) => (
                  <article key={item.id} className="scheduleCard">
                    <h3>{String(item.month)}</h3>
                    <p>{String(item.atoll_or_island || "")}</p>
                    <div className="chips">
                      {(item.staff_slots as Array<{ staff: string; trip: string; availability: string }>).map((slot) => (
                        <span key={`${item.id}-${slot.staff}`} className="chip">
                          {slot.staff}: {slot.trip || slot.availability || "Blank"}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
          </div>
        </section>
      )}

      {activeTab === "cleaning" && (
        <section className="section">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Data cleaning workspace</p>
              <h2>Original imported values stay in the raw import and audit trail.</h2>
            </div>
          </div>
          <Panel title="Open issues" subtitle="Missing fields, invalid numbers, duplicate reports, and unlinked project codes">
            <div className="issueList">
              {data.data_quality_issues.filter((issue) => issue.status !== "Resolved").slice(0, 120).map((issue) => (
                <article key={issue.id} className="issueCard">
                  <div>
                    <span className="pill danger">{issue.issue_type}</span>
                    <h3>{issue.record_type} · {issue.field_name}</h3>
                    <p>Record: {issue.record_id}</p>
                    <p>Original: {issue.original_value || "Blank"}</p>
                  </div>
                  <div className="issueActions">
                    <input value={corrections[issue.id] ?? issue.suggested_value ?? ""} onChange={(event) => setCorrections((prev) => ({ ...prev, [issue.id]: event.target.value }))} placeholder="Corrected value or leave blank" />
                    <button onClick={() => resolveIssue(issue)}>Resolve</button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </section>
      )}

      {activeTab === "entry" && (
        <section className="section">
          <DataEntry data={data} currentUser={currentUser} setData={setData} />
        </section>
      )}

      {activeTab === "audit" && (
        <section className="section">
          <Panel title="Audit trail" subtitle="Every import, correction, and update is listed here">
            <Table rows={data.audit_trail.slice(0, 300)} columns={[["changed_at", "Date"], ["record_type", "Record type"], ["record_id", "Record"], ["field_changed", "Field"], ["old_value", "Old"], ["new_value", "New"], ["changed_by", "By"], ["change_source", "Source"]]} />
          </Panel>
        </section>
      )}
    </main>
  );
}

function Kpi({ label, value, detail, tone }: { label: string; value: string | number; detail?: string; tone?: "good" | "bad" }) {
  return (
    <article className={`kpi ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </article>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="barList">
      {rows.map((row) => (
        <div key={row.label} className="barRow">
          <div className="barText">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
          <div className="barTrack">
            <div style={{ width: `${Math.max(6, (row.value / max) * 100)}%` }} />
          </div>
          {row.detail && <small>{row.detail}</small>}
        </div>
      ))}
    </div>
  );
}

function Table<T extends Record<string, unknown>>({
  rows,
  columns,
  onRowClick
}: {
  rows: T[];
  columns: Array<[keyof T & string, string]>;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || index)} onClick={() => onRowClick?.(row)} className={onRowClick ? "clickable" : ""}>
              {columns.map(([field]) => (
                <td key={field}>{formatCell(row[field])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return <span className="muted">Blank</span>;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function ProjectDetail({
  project,
  data,
  user,
  updateRecord
}: {
  project: Project | null;
  data: AppData;
  user: User;
  updateRecord: <T extends SimpleRecord>(collection: keyof AppData, recordType: string, id: string, field: string, value: unknown, reason: string, source?: string) => void;
}) {
  const [status, setStatus] = useState(project?.current_status || "");
  const [docLink, setDocLink] = useState(project?.document_link || "");

  useEffect(() => {
    setStatus(project?.current_status || "");
    setDocLink(project?.document_link || "");
  }, [project?.id, project?.current_status, project?.document_link]);

  if (!project) return null;
  const dnr = data.dnr_permits.filter((item) => item.project_id === project.id || item.project_code_text === project.project_code);
  const veg = data.vegetation_permits.filter((item) => item.project_id === project.id || item.project_code_text === project.project_code);
  const issues = data.data_quality_issues.filter((item) => item.record_id === project.id && item.status !== "Resolved");
  const audit = data.audit_trail.filter((item) => item.record_id === project.id).slice(0, 12);
  const editable = canEditRecord(user, project);

  return (
    <Panel title={project.project_code || "Project detail"} subtitle={project.project_name || "Unnamed imported record"}>
      <div className="detailBlock">
        <div className="scoreLine">
          <span>Completeness</span>
          <div className="progress"><div style={{ width: `${project.data_completeness_score || 0}%` }} /></div>
          <strong>{pct(project.data_completeness_score)}</strong>
        </div>
        <dl>
          <div><dt>Island</dt><dd>{project.island || "Blank"}</dd></div>
          <div><dt>Atoll</dt><dd>{project.atoll || "Blank"}</dd></div>
          <div><dt>Proponent</dt><dd>{project.proponent || "Blank"}</dd></div>
          <div><dt>Consultant</dt><dd>{project.consultant || "Blank"}</dd></div>
          <div><dt>Handler</dt><dd>{project.handler || "Blank"}</dd></div>
          <div><dt>Support staff</dt><dd>{project.support_staff || "Blank"}</dd></div>
          <div><dt>Evaluation deadline</dt><dd>{project.evaluation_deadline || "Blank"}</dd></div>
          <div><dt>Final deadline</dt><dd>{project.final_deadline || "Blank"}</dd></div>
        </dl>
        <div className="editBox">
          <label>Status</label>
          <select value={status} disabled={!editable} onChange={(event) => setStatus(event.target.value)}>
            {data.lookups.statuses.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button disabled={!editable || status === project.current_status} onClick={() => updateRecord("projects", "projects", project.id, "current_status", status, "Project status update")}>Save status</button>
        </div>
        <div className="editBox">
          <label>Google Drive document link</label>
          <input value={docLink} disabled={!editable} onChange={(event) => setDocLink(event.target.value)} placeholder="https://drive.google.com/..." />
          <button disabled={!editable || docLink === (project.document_link || "")} onClick={() => updateRecord("projects", "projects", project.id, "document_link", docLink, "Document link added")}>Save link</button>
        </div>
        {!editable && <p className="muted">Your current role can view this record, but cannot edit it unless assigned or admin.</p>}
      </div>

      <div className="miniTabs">
        <section>
          <h3>DNR permits</h3>
          <Table rows={dnr} columns={[["permit_code", "Permit"], ["permit_issued_date", "Issued"], ["reclamation_area_sqm", "Area sqm"], ["handler", "Handler"]]} />
        </section>
        <section>
          <h3>Vegetation permits</h3>
          <Table rows={veg} columns={[["permit_code", "Permit"], ["vegetation_clearance_required", "Required"], ["palms_removed", "Palms"], ["trees_removed", "Trees"]]} />
        </section>
        <section>
          <h3>Open data quality issues</h3>
          <Table rows={issues} columns={[["issue_type", "Issue"], ["field_name", "Field"], ["original_value", "Original"], ["assigned_to", "Assigned"]]} />
        </section>
        <section>
          <h3>Audit trail</h3>
          <Table rows={audit} columns={[["changed_at", "Date"], ["field_changed", "Field"], ["old_value", "Old"], ["new_value", "New"], ["changed_by", "By"]]} />
        </section>
      </div>
    </Panel>
  );
}

function DataEntry({ data, currentUser, setData }: { data: AppData; currentUser: User; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [type, setType] = useState("project");
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    if (type === "project") {
      const id = `project-manual-${Date.now()}`;
      const project: Project = {
        id,
        project_code: String(form.get("project_code") || `MANUAL-${Date.now()}`),
        application_type: String(form.get("application_type") || ""),
        date_of_application: String(form.get("date_of_application") || todayIso()),
        project_name: String(form.get("project_name") || ""),
        project_location: String(form.get("project_location") || ""),
        island: String(form.get("island") || ""),
        atoll: String(form.get("atoll") || ""),
        proponent: String(form.get("proponent") || ""),
        proponent_category: "",
        consultant: String(form.get("consultant") || ""),
        project_sector: String(form.get("project_sector") || ""),
        handler: String(form.get("handler") || currentUser.name),
        support_staff: String(form.get("support_staff") || ""),
        current_status: "Pending",
        report_received_date: "",
        category: "",
        date_of_scoping: "",
        tor_issued_date: "",
        tor_number: "",
        tor_expiry_date: "",
        evaluation_deadline: String(form.get("evaluation_deadline") || ""),
        final_deadline: String(form.get("final_deadline") || ""),
        lir_date: "",
        lis_date: "",
        decision_statement_date: "",
        additional_comments: String(form.get("notes") || ""),
        data_completeness_score: 62,
        imported_source_sheet: "Manual entry",
        imported_row_number: 0
      };
      setData((prev) => addAudit({ ...prev, projects: [project, ...prev.projects] }, currentUser, "projects", id, "record", "", "Created", "Manual project entry"));
      setMessage("Project added.");
      event.currentTarget.reset();
      return;
    }

    const id = `${type}-manual-${Date.now()}`;
    const collection = type === "monitoring_report" ? "monitoring_reports" : type === "inspection" ? "inspections" : "documents";
    const record: SimpleRecord = {
      id,
      title: String(form.get("title") || ""),
      project_id: String(form.get("project_id") || ""),
      document_link: String(form.get("document_link") || ""),
      google_drive_url: String(form.get("document_link") || ""),
      status: "Pending",
      added_by: currentUser.name,
      added_at: now,
      imported_source_sheet: "Manual entry",
      imported_row_number: 0
    };
    setData((prev) => {
      const next = { ...prev, [collection]: [record, ...(prev[collection as keyof AppData] as SimpleRecord[])] } as AppData;
      return addAudit(next, currentUser, collection, id, "record", "", "Created", "Manual data entry");
    });
    setMessage("Record added.");
    event.currentTarget.reset();
  }

  return (
    <Panel title="Data entry forms" subtitle="Use this to add new records. Local edits persist in this browser until a database is connected.">
      <form className="entryForm" onSubmit={handleSubmit}>
        <label>
          Record type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="project">New project</option>
            <option value="monitoring_report">Monitoring report</option>
            <option value="inspection">Inspection record</option>
            <option value="document">Document link</option>
          </select>
        </label>
        {type === "project" ? (
          <>
            <label>Project code<input name="project_code" placeholder="PRJ-2026-..." /></label>
            <label>Application type<select name="application_type">{data.lookups.application_types.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Date of application<input name="date_of_application" type="date" /></label>
            <label>Project name<input name="project_name" required /></label>
            <label>Location<input name="project_location" /></label>
            <label>Island<input name="island" list="islands" /></label>
            <label>Atoll<input name="atoll" list="atolls" /></label>
            <label>Proponent<input name="proponent" /></label>
            <label>Consultant<input name="consultant" /></label>
            <label>Sector<input name="project_sector" /></label>
            <label>Handler<select name="handler">{data.lookups.staff.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Support staff<select name="support_staff">{data.lookups.staff.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Evaluation deadline<input name="evaluation_deadline" type="date" /></label>
            <label>Final deadline<input name="final_deadline" type="date" /></label>
            <label className="wide">Notes<textarea name="notes" rows={3} /></label>
          </>
        ) : (
          <>
            <label className="wide">Title<input name="title" required /></label>
            <label className="wide">Linked project<select name="project_id"><option value="">No linked project</option>{data.projects.slice(0, 200).map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.project_name}</option>)}</select></label>
            <label className="wide">Google Drive link<input name="document_link" placeholder="https://drive.google.com/..." /></label>
          </>
        )}
        <datalist id="islands">{data.lookups.islands.map((item) => <option key={item}>{item}</option>)}</datalist>
        <datalist id="atolls">{data.lookups.atolls.map((item) => <option key={item}>{item}</option>)}</datalist>
        <button type="submit">Save record</button>
        {message && <p className="success">{message}</p>}
      </form>
    </Panel>
  );
}
