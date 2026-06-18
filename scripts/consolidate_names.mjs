// Consolidate similar staff names into one canonical name across the seed
// dataset and rebuild the derived staff roster (users, staff_profiles,
// lookups.staff). Run with: node scripts/consolidate_names.mjs
//
// Keep the ALIASES/JUNK tables here in sync with STAFF_ALIASES in
// scripts/extract_workbook.py so a fresh Excel import matches this output.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "src", "data", "seedData.json");

// lowercased variant -> canonical name
const ALIASES = {
  faroo: "Faroo", farooo: "Faroo", faroooo: "Faroo",
  ishaanee: "Ishaanee", ishaa: "Ishaanee", isha: "Ishaanee", ishany: "Ishaanee",
  nisreen: "Nisreen", nisry: "Nisreen", nisryn: "Nisreen", nisrin: "Nisreen",
  shaiha: "Shaiha", shaii: "Shaiha", shaikha: "Shaiha", shai: "Shaiha",
  sofa: "Sofa", safa: "Sofa",
  hashim: "Hashim", hazum: "Hazum", farhana: "Farhana",
  nashwa: "Nashwa", shiman: "Shiman", siman: "Shiman", rifath: "Rifath",
};

// lowercased values that are not real staff names -> dropped
const JUNK = new Set([
  "00:00:00", "staff name", "lead staff information",
  "support staff information", "report was externally reviewed",
]);

// Normalize a single name token.
function one(name) {
  const t = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const key = t.toLowerCase();
  if (JUNK.has(key)) return "";
  return ALIASES[key] ?? t;
}

// Normalize a field that may hold one or several names separated by / , & and.
function many(value) {
  const t = String(value ?? "").trim();
  if (!t) return "";
  const out = [];
  for (const part of t.split(/\/|,|&|\band\b/i)) {
    const n = one(part);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.join(", ");
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const used = new Set();
const track = (v) => { for (const n of String(v).split(", ")) if (n) used.add(n); };

const apply = (rows, field, multi = false) => {
  for (const r of rows ?? []) {
    if (r[field] == null) continue;
    r[field] = multi ? many(r[field]) : one(r[field]);
    if (field !== "assigned_to" || multi) track(r[field]);
  }
};

apply(data.projects, "handler"); apply(data.projects, "support_staff"); apply(data.projects, "reviewed_by");
apply(data.screening_applications, "handler"); apply(data.screening_applications, "support_staff");
apply(data.dnr_permits, "handler"); apply(data.dnr_permits, "support_staff");
apply(data.vegetation_permits, "handler"); apply(data.vegetation_permits, "support_staff");
apply(data.monitoring_reports, "reviewed_by");
apply(data.cat4_reviews, "reviewer_1"); apply(data.cat4_reviews, "reviewer_2"); apply(data.cat4_reviews, "support_staff");
apply(data.inspections, "assigned_to", true);
apply(data.data_quality_issues, "assigned_to");

for (const s of data.inspection_schedules ?? []) {
  for (const slot of s.staff_slots ?? []) { slot.staff = one(slot.staff); track(slot.staff); }
}

// Rebuild the staff roster exactly like extract_workbook.py.
const staffNames = [...used].filter(Boolean).sort((a, b) => a.localeCompare(b));
const users = [];
const staffProfiles = [];
staffNames.forEach((name, i) => {
  const role = i === 0 ? "Admin" : (i % 3 === 0 ? "Reviewer" : "EIA Team");
  const id = `user-${String(i + 1).padStart(3, "0")}`;
  users.push({ id, name, email: `${name.toLowerCase().replace(/ /g, ".")}@era.local`, role, active_status: "Active" });
  staffProfiles.push({ id: `staff-${String(i + 1).padStart(3, "0")}`, user_id: id, staff_name: name, standardized_name: name, team: "EIA Review", active_status: "Active" });
});
users.push({ id: "user-data-entry", name: "Data Entry Officer", email: "data.entry@era.local", role: "Data Entry", active_status: "Active" });
users.push({ id: "user-management", name: "ERA Management", email: "management@era.local", role: "Admin", active_status: "Active" });

data.users = users;
data.staff_profiles = staffProfiles;
data.lookups.staff = staffNames;
// Bump the seed version so the app invalidates stale browser caches.
if (data.meta) data.meta.generated_at = new Date().toISOString().slice(0, 19);

writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Consolidated staff roster (" + staffNames.length + "):");
console.log("  " + staffNames.join(", "));
