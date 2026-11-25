#!/usr/bin/env python3
"""One-time migration: convert the old earnings spreadsheet (.xlsx) into a
ChaChing JSON backup that can be restored from Settings -> Restore.

Usage:  python3 scripts/sheet_to_backup.py "path/to/sheet.xlsx" private/backup.json [year]

Only the standard library is used. Monthly sheets must have the header row:
Work period | Contract | Hours | Rate / hr | Earned (USD) | Status | Payout date | Sent / release | Work date*
The output contains personal financial data: keep it out of git (private/ is ignored).
"""
import datetime as dt
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def serial_to_iso(v):
    if v in (None, ""):
        return None
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(v)))).isoformat()


def read_sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for s in wb.find("m:sheets", NS):
        rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        xml = ET.fromstring(z.read("xl/" + target[rid].lstrip("/").replace("xl/", "")))
        rows = []
        for row in xml.iter("{%s}row" % NS["m"]):
            cells = {}
            for c in row.findall("m:c", NS):
                col = re.match(r"[A-Z]+", c.get("r")).group(0)
                v = c.find("m:v", NS)
                if v is None:
                    continue
                cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
            rows.append(cells)
        out[s.get("name")] = rows
    return out


def parse_period(text, year):
    """'Oct 24–30' | 'Nov 1–6' | 'Oct 31' | 'Incentive · Oct 21' | 'Work Trial · Nov 8'"""
    t = text.replace("–", "-").replace("—", "-")
    kind = None
    if "·" in t:
        label, t = [x.strip() for x in t.split("·", 1)]
        kind = "work_trial" if "trial" in label.lower() else "incentive" if "incentive" in label.lower() else "other"
    m = re.match(r"([A-Za-z]{3})\w*\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3})\w*\s+)?(\d{1,2}))?", t)
    if not m:
        raise ValueError("Cannot parse work period: %r" % text)
    m1 = MONTHS[m.group(1).lower()]
    d1 = int(m.group(2))
    m2 = MONTHS[m.group(3).lower()] if m.group(3) else m1
    d2 = int(m.group(4)) if m.group(4) else d1
    y2 = year + 1 if m2 < m1 else year
    return kind, dt.date(year, m1, d1).isoformat(), dt.date(y2, m2, d2).isoformat()


def main():
    src, dst = sys.argv[1], sys.argv[2]
    sheets = read_sheets(src)
    now = int(time.time() * 1000)
    payments = []
    for name, rows in sheets.items():
        ym = re.match(r"([A-Za-z]+)\s+(\d{4})", name)
        if not ym:
            continue
        year = int(sys.argv[3]) if len(sys.argv) > 3 else int(ym.group(2))
        header_idx = next((i for i, r in enumerate(rows) if r.get("A") == "Work period"), None)
        if header_idx is None:
            continue
        for r in rows[header_idx + 1:]:
            a = (r.get("A") or "").strip()
            if not a or a.upper() == "TOTAL" or "E" not in r:
                if a.upper() == "TOTAL":
                    break
                continue
            kind, ws, we = parse_period(a, year)
            ptype = kind or "hourly"
            cents = int(round(float(r["E"]) * 100))
            hours = float(r["C"]) if r.get("C") not in (None, "") else None
            rate = int(round(float(r["D"]) * 100)) if r.get("D") not in (None, "") and ptype == "hourly" else None
            status_raw = (r.get("F") or "").strip()
            status = "paid" if status_raw.lower() == "paid" else "pending"
            release = serial_to_iso(r.get("H"))
            payments.append({
                "id": "sheet-%03d" % (len(payments) + 1),
                "contract": r.get("B", "Unknown").strip(),
                "type": ptype,
                "typeLabel": {"hourly": "Hourly", "incentive": "Incentive", "work_trial": "Work trial"}.get(ptype, "Other"),
                "workStart": ws,
                "workEnd": we,
                "payoutDate": serial_to_iso(r.get("G")),
                "hours": hours if ptype == "hourly" else None,
                "earningsCents": cents,
                "rateCents": rate,
                "rateInferred": False,
                "status": status,
                "statusLabel": status_raw or ("Paid" if status == "paid" else "Pending"),
                "releaseDate": release,
                "releaseKind": "actual" if status == "paid" and release else ("expected" if release else None),
                "notes": "Migrated from spreadsheet",
                "source": "manual",
                "createdAt": now,
                "updatedAt": now,
            })
    backup = {
        "app": "chaching",
        "version": 1,
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "settings": {"hourlyRates": [65, 85], "cycleStartDay": 21, "rateTolerancePct": 3},
        "payments": payments,
    }
    with open(dst, "w") as f:
        json.dump(backup, f, indent=2)
    total = sum(p["earningsCents"] for p in payments)
    print("Wrote %d payments, total $%.2f -> %s" % (len(payments), total / 100, dst))


if __name__ == "__main__":
    main()
