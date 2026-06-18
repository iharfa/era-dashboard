import json
import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / ".cache" / "02-2026_Assessment-and-Monitoring-Updates_NEW_FINAL-2-1-.xlsx"
OUTPUT = ROOT / "src" / "data" / "seedData.json"


def is_blank(value):
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def clean_text(value):
    if is_blank(value):
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if float(value).is_integer():
            return str(int(value))
        return str(value)
    return re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()


def raw_text(value):
    if is_blank(value):
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    return str(value)


def parse_date(value):
    if is_blank(value):
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = clean_text(value)
    if not text or text.lower() in {"dd-mmm-yyyy", "date", "nan"}:
        return ""
    try:
        parsed = pd.to_datetime(text, errors="coerce", dayfirst=True)
        if pd.isna(parsed):
            return ""
        return parsed.date().isoformat()
    except Exception:
        return ""


def parse_bool(value):
    if isinstance(value, bool):
        return value
    text = clean_text(value).lower()
    if text in {"yes", "y", "true", "required", "1"}:
        return True
    if text in {"no", "n", "false", "not required", "0"}:
        return False
    return None


def parse_number(value):
    original = clean_text(value)
    if not original or original in {"-", "—"}:
        return None, original, "Missing or placeholder number" if original else ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value), original, ""
    text = original.lower().replace(",", "")
    multiplier = 1
    if "million" in text:
        multiplier = 1_000_000
        text = text.replace("million", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None, original, "Invalid number"
    number = float(match.group(0)) * multiplier
    issue = ""
    if "ha" in text or "hectare" in text:
        number = number * 10000
        issue = "Converted hectare value to square meters"
    elif re.search(r"[a-zA-Z]", text):
        issue = "Number has unit text and needs review"
    return number, original, issue


STAFF_ALIASES = {
    "safa": "Sofa",
    "sofa": "Sofa",
    "hashim": "Hashim",
    "shaiha": "Shaiha",
    "shaikha": "Shaiha",
    "shai": "Shaiha",
    "shaii": "Shaiha",
    "farhana": "Farhana",
    "faroo": "Faroo",
    "farooo": "Faroo",
    "faroooo": "Faroo",
    "hazum": "Hazum",
    "nashwa": "Nashwa",
    "nisreen": "Nisreen",
    "nisry": "Nisreen",
    "nisryn": "Nisreen",
    "nisrin": "Nisreen",
    "isha": "Ishaanee",
    "ishaa": "Ishaanee",
    "ishaanee": "Ishaanee",
    "ishany": "Ishaanee",
    "ishaanee ": "Ishaanee",
    "shiman": "Shiman",
    "siman": "Shiman",
    "shiman/siman": "Shiman",
    "rifath": "Rifath",
}

# Values that show up in name columns but are not real staff names.
STAFF_JUNK = {
    "00:00:00",
    "staff name",
    "lead staff information",
    "support staff information",
    "report was externally reviewed",
}


def staff_name(value):
    text = clean_text(value)
    if not text:
        return ""
    parts = re.split(r"/|,|&|\band\b", text, flags=re.I)
    first = parts[0].strip()
    key = first.lower()
    if key in STAFF_JUNK:
        return ""
    return STAFF_ALIASES.get(key, first)


def record_id(prefix, source, row_number, value):
    safe = clean_text(value).replace("/", "-").replace(" ", "-")
    safe = re.sub(r"[^A-Za-z0-9._-]", "", safe)
    if safe:
        return f"{prefix}-{safe}"
    return f"{prefix}-row-{row_number}"


def completeness(record, fields):
    total = len(fields)
    if total == 0:
        return 100
    done = 0
    for field in fields:
        value = record.get(field)
        if value is not None and value != "":
            done += 1
    return round(done / total * 100)


def row_raw(row):
    return {f"c{i + 1}": raw_text(v) for i, v in enumerate(row.tolist()) if not is_blank(v)}


def add_issue(issues, record_type, record_id_value, field_name, issue_type, original_value="", suggested_value="", assigned_to=""):
    issues.append(
        {
            "id": f"dq-{len(issues) + 1:05d}",
            "record_type": record_type,
            "record_id": record_id_value,
            "field_name": field_name,
            "issue_type": issue_type,
            "original_value": clean_text(original_value),
            "suggested_value": clean_text(suggested_value),
            "status": "Open",
            "assigned_to": assigned_to,
            "resolved_by": "",
            "resolved_at": "",
            "notes": "",
        }
    )


def add_missing_issues(issues, record_type, record, required_fields, assignee=""):
    for field in required_fields:
        if record.get(field) in ("", None):
            add_issue(issues, record_type, record["id"], field, "Missing required field", "", "", assignee)


def read_sheet(xl, name):
    return pd.read_excel(xl, sheet_name=name, header=None)


def main():
    xl = pd.ExcelFile(SOURCE)
    issues = []
    raw_imports = []
    projects = []
    screening = []
    dnr = []
    vegetation = []
    monitoring_reports = []
    inspections = []
    cat4_reviews = []
    inspection_schedules = []
    documents = []
    staff_values = Counter()

    # Screening 2026
    df = read_sheet(xl, "Screening 2026")
    for idx in range(2, len(df)):
        row = df.iloc[idx]
        code = clean_text(row.iloc[0])
        if not code or "Code" in code:
            continue
        rec = {
            "id": record_id("screening", "Screening 2026", idx + 1, code),
            "screening_code": code,
            "project_id": "",
            "date_of_application": parse_date(row.iloc[1]),
            "handler": staff_name(row.iloc[2]),
            "support_staff": staff_name(row.iloc[3]),
            "project_name": clean_text(row.iloc[4]),
            "project_location": clean_text(row.iloc[5]),
            "island": clean_text(row.iloc[6]),
            "atoll": clean_text(row.iloc[7]),
            "proponent": clean_text(row.iloc[8]),
            "ds_issued_date": parse_date(row.iloc[9]),
            "outcome": clean_text(row.iloc[10]),
            "comments": clean_text(row.iloc[11]),
            "imported_source_sheet": "Screening 2026",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["screening_code", "date_of_application", "handler", "support_staff", "project_name", "project_location", "island", "atoll", "proponent", "outcome"])
        screening.append(rec)
        staff_values.update([rec["handler"], rec["support_staff"]])
        raw_imports.append({"record_type": "screening_applications", "record_id": rec["id"], "source_sheet": "Screening 2026", "row_number": idx + 1, "raw": rec["raw"]})
        add_missing_issues(issues, "screening_applications", rec, ["date_of_application", "project_name", "island", "atoll", "proponent", "outcome"], rec["handler"])

    # EIA App & Review 2026
    df = read_sheet(xl, "EIA App & Review 2026")
    for idx in range(3, len(df)):
        row = df.iloc[idx]
        code = clean_text(row.iloc[0])
        if not re.match(r"PRJ-\d{4}-", code):
            continue
        rec = {
            "id": record_id("project", "EIA App & Review 2026", idx + 1, code),
            "project_code": code,
            "application_type": clean_text(row.iloc[1]),
            "date_of_application": parse_date(row.iloc[2]),
            "project_name": clean_text(row.iloc[3]),
            "project_location": clean_text(row.iloc[4]),
            "island": clean_text(row.iloc[5]),
            "atoll": clean_text(row.iloc[6]),
            "proponent": clean_text(row.iloc[7]),
            "proponent_category": clean_text(row.iloc[8]),
            "consultant": clean_text(row.iloc[9]),
            "handler": staff_name(row.iloc[10]),
            "support_staff": staff_name(row.iloc[11]),
            "project_sector": clean_text(row.iloc[12]),
            "date_of_scoping": parse_date(row.iloc[13]),
            "tor_issued_date": parse_date(row.iloc[14]),
            "tor_number": clean_text(row.iloc[15]),
            "tor_expiry_date": parse_date(row.iloc[16]),
            "report_submitted": parse_bool(row.iloc[17]),
            "report_received_date": parse_date(row.iloc[18]),
            "category": clean_text(row.iloc[19]),
            "current_status": clean_text(row.iloc[20]) or "Imported",
            "reviewed_by": staff_name(row.iloc[21]),
            "evaluation_deadline": parse_date(row.iloc[22]),
            "final_deadline": parse_date(row.iloc[23]),
            "lir_date": parse_date(row.iloc[24]),
            "lis_date": parse_date(row.iloc[25]),
            "decision_statement_date": parse_date(row.iloc[26]),
            "dnr_required": parse_bool(row.iloc[27]),
            "shapefiles_submitted": parse_bool(row.iloc[28]),
            "additional_comments": clean_text(row.iloc[29]),
            "document_link": "",
            "monitoring_status": "Not scheduled",
            "imported_source_sheet": "EIA App & Review 2026",
            "imported_row_number": idx + 1,
            "created_at": "",
            "updated_at": "",
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["project_code", "application_type", "date_of_application", "project_name", "project_location", "island", "atoll", "proponent", "proponent_category", "consultant", "project_sector", "handler", "support_staff", "current_status", "dnr_required", "shapefiles_submitted"])
        projects.append(rec)
        staff_values.update([rec["handler"], rec["support_staff"], rec["reviewed_by"]])
        raw_imports.append({"record_type": "projects", "record_id": rec["id"], "source_sheet": "EIA App & Review 2026", "row_number": idx + 1, "raw": rec["raw"]})
        add_missing_issues(issues, "projects", rec, ["application_type", "date_of_application", "project_name", "island", "atoll", "proponent", "consultant", "handler", "support_staff"], rec["handler"])
        if rec["tor_issued_date"] and rec["tor_expiry_date"] and rec["tor_expiry_date"] < rec["tor_issued_date"]:
            add_issue(issues, "projects", rec["id"], "tor_expiry_date", "Invalid date", rec["tor_expiry_date"], "", rec["handler"])
        if rec["report_received_date"] and rec["final_deadline"] and rec["final_deadline"] < rec["report_received_date"]:
            add_issue(issues, "projects", rec["id"], "final_deadline", "Invalid date", rec["final_deadline"], "", rec["handler"])

    project_by_code = {p["project_code"]: p["id"] for p in projects}

    # DNR Permits
    df = read_sheet(xl, "DNR Permits 2026")
    for idx in range(2, len(df)):
        row = df.iloc[idx]
        code = clean_text(row.iloc[0])
        if not code or code == "#":
            continue
        project_code = clean_text(row.iloc[1])
        dredge, dredge_raw, dredge_issue = parse_number(row.iloc[12] if len(row) > 12 else "")
        volume, volume_raw, volume_issue = parse_number(row.iloc[13] if len(row) > 13 else "")
        area, area_raw, area_issue = parse_number(row.iloc[14] if len(row) > 14 else "")
        rec = {
            "id": record_id("dnr", "DNR Permits 2026", idx + 1, code),
            "permit_code": code,
            "project_id": project_by_code.get(project_code, ""),
            "project_code_text": project_code,
            "date_of_application": parse_date(row.iloc[2]),
            "project_name": clean_text(row.iloc[3]),
            "project_location": clean_text(row.iloc[4]),
            "island": clean_text(row.iloc[5]),
            "atoll": clean_text(row.iloc[6]),
            "proponent": clean_text(row.iloc[7]),
            "consultant": clean_text(row.iloc[8]),
            "handler": staff_name(row.iloc[9]),
            "support_staff": staff_name(row.iloc[10]),
            "permit_issued_date": parse_date(row.iloc[11]),
            "dredge_material_cbm": dredge,
            "reclamation_volume_cbm": volume,
            "reclamation_area_sqm": area,
            "original_dredge_material_text": dredge_raw,
            "original_reclamation_volume_text": volume_raw,
            "original_reclamation_area_text": area_raw,
            "comments": clean_text(row.iloc[15] if len(row) > 15 else ""),
            "imported_source_sheet": "DNR Permits 2026",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["permit_code", "project_code_text", "date_of_application", "project_name", "island", "atoll", "proponent", "consultant", "handler", "support_staff", "permit_issued_date"])
        dnr.append(rec)
        staff_values.update([rec["handler"], rec["support_staff"]])
        raw_imports.append({"record_type": "dnr_permits", "record_id": rec["id"], "source_sheet": "DNR Permits 2026", "row_number": idx + 1, "raw": rec["raw"]})
        add_missing_issues(issues, "dnr_permits", rec, ["date_of_application", "project_name", "island", "atoll", "proponent"], rec["handler"])
        if project_code and project_code not in project_by_code and project_code.startswith("PRJ-"):
            add_issue(issues, "dnr_permits", rec["id"], "project_code_text", "Unlinked project code", project_code, "", rec["handler"])
        for field, issue, raw in [("dredge_material_cbm", dredge_issue, dredge_raw), ("reclamation_volume_cbm", volume_issue, volume_raw), ("reclamation_area_sqm", area_issue, area_raw)]:
            if issue:
                add_issue(issues, "dnr_permits", rec["id"], field, "Invalid number" if "Invalid" in issue else "Number and unit review", raw, rec.get(field), rec["handler"])

    # Vegetation permits
    df = read_sheet(xl, "EIA-EMP VEg Permits 2026")
    for idx in range(2, len(df)):
        row = df.iloc[idx]
        code = clean_text(row.iloc[0])
        if not re.match(r"\d{4}-\d{3}", code):
            continue
        project_code = clean_text(row.iloc[1])
        rec = {
            "id": record_id("veg", "EIA-EMP VEg Permits 2026", idx + 1, code),
            "permit_code": code,
            "project_id": project_by_code.get(project_code, ""),
            "project_code_text": project_code,
            "date_of_application": parse_date(row.iloc[2]),
            "project_name": clean_text(row.iloc[3]),
            "project_location": clean_text(row.iloc[4]),
            "island": clean_text(row.iloc[5]),
            "atoll": clean_text(row.iloc[6]),
            "proponent": clean_text(row.iloc[7]),
            "consultant": clean_text(row.iloc[8]),
            "handler": staff_name(row.iloc[9]),
            "support_staff": staff_name(row.iloc[10]),
            "vegetation_clearance_required": parse_bool(row.iloc[11]),
            "relocation_or_transfer": parse_bool(row.iloc[12]),
            "relocation_location": clean_text(row.iloc[13]),
            "palms_removed": clean_text(row.iloc[14]),
            "trees_removed": clean_text(row.iloc[15]),
            "additional_comments": clean_text(row.iloc[16]),
            "imported_source_sheet": "EIA-EMP VEg Permits 2026",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["permit_code", "project_code_text", "date_of_application", "project_name", "island", "atoll", "proponent", "consultant", "handler", "support_staff"])
        vegetation.append(rec)
        staff_values.update([rec["handler"], rec["support_staff"]])
        raw_imports.append({"record_type": "vegetation_permits", "record_id": rec["id"], "source_sheet": "EIA-EMP VEg Permits 2026", "row_number": idx + 1, "raw": rec["raw"]})
        if project_code and project_code not in project_by_code and project_code.startswith("PRJ-"):
            add_issue(issues, "vegetation_permits", rec["id"], "project_code_text", "Unlinked project code", project_code, "", rec["handler"])

    # Monitoring reports
    df = read_sheet(xl, "Monitoring 2025-2026")
    for idx in range(3, len(df)):
        row = df.iloc[idx]
        report_no = clean_text(row.iloc[0])
        if not report_no or "Report" in report_no:
            continue
        rec = {
            "id": record_id("mon", "Monitoring 2025-2026", idx + 1, report_no),
            "report_number": report_no,
            "project_id": "",
            "monitoring_due_item_id": "",
            "date_of_submission": parse_date(row.iloc[1]),
            "deadline": parse_date(row.iloc[2]),
            "report_name": clean_text(row.iloc[3]),
            "consultant_or_author": clean_text(row.iloc[4]),
            "proponent": clean_text(row.iloc[5]),
            "reviewed_by": staff_name(row.iloc[6]),
            "status": clean_text(row.iloc[7]) or "Imported",
            "review_completed_date": parse_date(row.iloc[8]),
            "comments_or_issues": clean_text(row.iloc[9]),
            "communication_date": parse_date(row.iloc[10]),
            "letter_number": clean_text(row.iloc[11]),
            "proponent_response_deadline": parse_date(row.iloc[12]),
            "document_link": "",
            "imported_source_sheet": "Monitoring 2025-2026",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["report_number", "date_of_submission", "report_name", "consultant_or_author", "proponent", "reviewed_by", "status"])
        monitoring_reports.append(rec)
        staff_values.update([rec["reviewed_by"]])
        raw_imports.append({"record_type": "monitoring_reports", "record_id": rec["id"], "source_sheet": "Monitoring 2025-2026", "row_number": idx + 1, "raw": rec["raw"]})
        add_missing_issues(issues, "monitoring_reports", rec, ["date_of_submission", "report_name", "proponent", "reviewed_by"], rec["reviewed_by"])

    duplicates = [key for key, count in Counter(r["report_number"] for r in monitoring_reports).items() if key and count > 1]
    for rec in monitoring_reports:
        if rec["report_number"] in duplicates:
            add_issue(issues, "monitoring_reports", rec["id"], "report_number", "Duplicate report number", rec["report_number"], "", rec["reviewed_by"])

    # Category 4 review roster
    df = read_sheet(xl, "Cat4 Roster")
    for idx in range(7, len(df)):
        row = df.iloc[idx]
        report_no = clean_text(row.iloc[0])
        if not report_no:
            continue
        rec = {
            "id": record_id("cat4", "Cat4 Roster", idx + 1, report_no),
            "report_number": report_no,
            "date": parse_date(row.iloc[1]),
            "note_number": clean_text(row.iloc[2]),
            "report_name": clean_text(row.iloc[3]),
            "reviewer_1": staff_name(row.iloc[4]),
            "reviewer_2": staff_name(row.iloc[5]),
            "support_staff": staff_name(row.iloc[6]),
            "status": clean_text(row.iloc[7]) or "Pending",
            "remarks": clean_text(row.iloc[8]),
            "imported_source_sheet": "Cat4 Roster",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        cat4_reviews.append(rec)
        staff_values.update([rec["reviewer_1"], rec["reviewer_2"], rec["support_staff"]])
        raw_imports.append({"record_type": "cat4_reviews", "record_id": rec["id"], "source_sheet": "Cat4 Roster", "row_number": idx + 1, "raw": rec["raw"]})

    # Inspection schedules
    df = read_sheet(xl, "EIA Inspection Schedule")
    for idx in range(3, len(df)):
        row = df.iloc[idx]
        month = clean_text(row.iloc[0])
        if not month or "Month" in month:
            continue
        rec = {
            "id": record_id("schedule", "EIA Inspection Schedule", idx + 1, month),
            "month": month,
            "atoll_or_island": clean_text(row.iloc[1]),
            "staff_slots": [
                {"staff": "Sofa", "trip": clean_text(row.iloc[2]), "availability": clean_text(row.iloc[3])},
                {"staff": "Hashim", "trip": clean_text(row.iloc[5]), "availability": clean_text(row.iloc[6])},
                {"staff": "Shaiha", "trip": clean_text(row.iloc[8]), "availability": clean_text(row.iloc[9])},
                {"staff": "Farhana", "trip": clean_text(row.iloc[11]), "availability": clean_text(row.iloc[12])},
                {"staff": "Ishaanee", "trip": clean_text(row.iloc[14]), "availability": clean_text(row.iloc[15])},
                {"staff": "Shiman", "trip": clean_text(row.iloc[16]), "availability": clean_text(row.iloc[17])},
            ],
            "imported_source_sheet": "EIA Inspection Schedule",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        inspection_schedules.append(rec)
        raw_imports.append({"record_type": "inspection_schedules", "record_id": rec["id"], "source_sheet": "EIA Inspection Schedule", "row_number": idx + 1, "raw": rec["raw"]})

    # Inspections
    df = read_sheet(xl, "EIA Inspection 2025-2026")
    current_atoll = ""
    current_date = ""
    for idx in range(3, len(df)):
        row = df.iloc[idx]
        first = clean_text(row.iloc[0])
        second = clean_text(row.iloc[1])
        island = clean_text(row.iloc[2])
        project_name = clean_text(row.iloc[3])
        if first and "Atoll" in first:
            current_atoll = first
        if second:
            current_date = second
        if not project_name or "EIA INSPECTIONS" in first:
            continue
        rec = {
            "id": record_id("inspection", "EIA Inspection 2025-2026", idx + 1, f"{island}-{idx + 1}"),
            "project_id": "",
            "atoll": current_atoll if "Atoll" in current_atoll else first,
            "island": island or first,
            "inspection_date_text": current_date,
            "inspection_date_start": parse_date(current_date),
            "inspection_date_end": "",
            "project_name": project_name,
            "assigned_to": clean_text(row.iloc[4]),
            "report_status": clean_text(row.iloc[5]) or "Imported",
            "post_eia_letter_deadline": parse_date(row.iloc[6]),
            "inspection_report_deadline": parse_date(row.iloc[7]),
            "inspection_report_completion_date": parse_date(row.iloc[8]),
            "post_eia_letter_date": parse_date(row.iloc[9]),
            "post_eia_letter_number": clean_text(row.iloc[10]),
            "proponent_response_date": parse_date(row.iloc[11]),
            "proponent_response_letter_number": clean_text(row.iloc[12]),
            "problems_identified": clean_text(row.iloc[13]),
            "actions_taken": clean_text(row.iloc[14]),
            "document_link": "",
            "imported_source_sheet": "EIA Inspection 2025-2026",
            "imported_row_number": idx + 1,
            "raw": row_raw(row),
        }
        rec["data_completeness_score"] = completeness(rec, ["atoll", "island", "inspection_date_text", "project_name", "assigned_to", "report_status", "inspection_report_deadline"])
        inspections.append(rec)
        for name in re.split(r"/|,|&|\band\b", rec["assigned_to"], flags=re.I):
            std = staff_name(name)
            if std:
                staff_values.update([std])
        raw_imports.append({"record_type": "inspections", "record_id": rec["id"], "source_sheet": "EIA Inspection 2025-2026", "row_number": idx + 1, "raw": rec["raw"]})
        add_missing_issues(issues, "inspections", rec, ["island", "project_name", "assigned_to", "report_status"], staff_name(rec["assigned_to"]))

    staff_names = sorted({name for name in staff_values if name})
    staff_profiles = []
    users = []
    roles = ["Admin", "EIA Team", "Reviewer", "Data Entry"]
    for i, name in enumerate(staff_names):
        role = "Admin" if i == 0 else ("Reviewer" if i % 3 == 0 else "EIA Team")
        user = {
            "id": f"user-{i + 1:03d}",
            "name": name,
            "email": f"{name.lower().replace(' ', '.')}@era.local",
            "role": role,
            "active_status": "Active",
        }
        users.append(user)
        staff_profiles.append(
            {
                "id": f"staff-{i + 1:03d}",
                "user_id": user["id"],
                "staff_name": name,
                "standardized_name": name,
                "team": "EIA Review",
                "active_status": "Active",
            }
        )
    users.append({"id": "user-data-entry", "name": "Data Entry Officer", "email": "data.entry@era.local", "role": "Data Entry", "active_status": "Active"})
    users.append({"id": "user-management", "name": "ERA Management", "email": "management@era.local", "role": "Admin", "active_status": "Active"})

    staff_names = sorted(staff_names)
    atolls = sorted({r.get("atoll", "") for r in projects + screening + dnr + vegetation + inspections if r.get("atoll")})
    islands = sorted({r.get("island", "") for r in projects + screening + dnr + vegetation + inspections if r.get("island")})

    # Link obvious DNR and vegetation records back into project metadata.
    linked_dnr = defaultdict(list)
    for item in dnr:
        if item["project_id"]:
            linked_dnr[item["project_id"]].append(item["id"])
    linked_veg = defaultdict(list)
    for item in vegetation:
        if item["project_id"]:
            linked_veg[item["project_id"]].append(item["id"])
    for project in projects:
        project["dnr_permit_ids"] = linked_dnr.get(project["id"], [])
        project["vegetation_permit_ids"] = linked_veg.get(project["id"], [])

    audit_trail = [
        {
            "id": f"audit-{i + 1:05d}",
            "record_type": item["record_type"],
            "record_id": item["record_id"],
            "field_changed": "import",
            "old_value": "",
            "new_value": f"Imported from {item['source_sheet']} row {item['row_number']}",
            "changed_by": "Excel import",
            "user_role": "System",
            "changed_at": datetime.now().isoformat(timespec="seconds"),
            "reason": "Initial workbook import",
            "change_source": "import",
        }
        for i, item in enumerate(raw_imports)
    ]

    seed = {
        "meta": {
            "source_file": SOURCE.name,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "counts": {
                "projects": len(projects),
                "screening_applications": len(screening),
                "dnr_permits": len(dnr),
                "vegetation_permits": len(vegetation),
                "monitoring_reports": len(monitoring_reports),
                "cat4_reviews": len(cat4_reviews),
                "inspection_schedules": len(inspection_schedules),
                "inspections": len(inspections),
                "data_quality_issues": len(issues),
            },
        },
        "lookups": {
            "roles": roles,
            "staff": staff_names,
            "atolls": atolls,
            "islands": islands,
            "application_types": sorted({p["application_type"] for p in projects if p["application_type"]}),
            "project_sectors": sorted({p["project_sector"] for p in projects if p["project_sector"]}),
            "proponent_categories": sorted({p["proponent_category"] for p in projects if p["proponent_category"]}),
            "statuses": ["Imported", "Pending", "In Review", "Completed", "Approved", "Returned for Correction", "Overdue", "Waived", "Not Applicable"],
            "monitoring_frequency": ["Initial", "Monthly", "Quarterly", "Biannual", "Annual", "One-off", "Custom"],
            "document_types": ["EIA Report", "EMP", "IEE", "Addendum", "ToR", "Decision Statement", "DNR Permit", "Vegetation Permit", "Monitoring Report", "Inspection Report", "Letter", "Proponent Response", "Other"],
        },
        "users": users,
        "staff_profiles": staff_profiles,
        "projects": projects,
        "screening_applications": screening,
        "dnr_permits": dnr,
        "vegetation_permits": vegetation,
        "monitoring_schedules": [],
        "monitoring_due_items": [],
        "monitoring_reports": monitoring_reports,
        "inspections": inspections,
        "inspection_schedules": inspection_schedules,
        "cat4_reviews": cat4_reviews,
        "documents": documents,
        "data_quality_issues": issues,
        "audit_trail": audit_trail,
        "raw_imports": raw_imports,
    }
    OUTPUT.write_text(json.dumps(seed, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(seed["meta"], indent=2))


if __name__ == "__main__":
    main()
