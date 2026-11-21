"""Portable representations of saved visibility observations."""

import csv
import io
import json
from datetime import datetime, timezone
from html import escape

SURFACES = {
    "suggestions": "Account suggestions",
    "search": "Post search",
    "thread": "Reply presence",
    "placement": "Reply placement",
}
SOURCES = {"guided": "Guided observation", "api": "X API"}
LIMITS = (
    "These observations do not establish an official X moderation decision.",
    "Visibility can vary by viewer and time. Unmeasured surfaces are excluded from the visibility score.",
)
SOURCE_LIMITS = {
    "guided": "Guided results reflect manually recorded observations.",
    "api": "X API monitoring samples post search only and depends on operator credentials and budget.",
}
OUTCOMES = {"visible": "Visible", "missing": "Missing from view", "unknown": "Unmeasured"}


def report_data(row):
    results = json.loads(row["results"])
    measured = sum(result["status"] != "unknown" for result in results.values())
    visible = sum(result["status"] == "visible" for result in results.values())
    source = row["source"]
    return {
        "schema_version": 1,
        "report_id": row["id"],
        "platform": "X",
        "handle": row["handle"],
        "captured_at_utc": datetime.fromtimestamp(row["checked"], timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
        "evidence_source": {"id": source, "label": SOURCES[source]},
        "coverage": {
            "total_surfaces": len(SURFACES),
            "measured_surfaces": measured,
            "visible_surfaces": visible,
            "unmeasured_surfaces": len(SURFACES) - measured,
            "visibility_percent": round(100 * visible / measured) if measured else None,
        },
        "observations": [
            {
                "surface": key,
                "label": label,
                "outcome": results[key]["status"],
                "outcome_label": (
                    "Different placement" if key == "placement" and results[key]["status"] == "missing"
                    else OUTCOMES[results[key]["status"]]
                ),
                "evidence": results[key]["detail"],
            }
            for key, label in SURFACES.items()
        ],
        "limitations": [*LIMITS, SOURCE_LIMITS[source]],
    }


def spreadsheet_cell(value):
    if isinstance(value, str) and (
        value.startswith(("\t", "\r", "\n"))
        or value.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))
    ):
        return "'" + value
    return value


def history_csv(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    coverage_fields = (
        "total_surfaces", "measured_surfaces", "visible_surfaces",
        "unmeasured_surfaces", "visibility_percent",
    )
    writer.writerow([
        "report_id", "handle", "captured_at_utc", "evidence_source", *coverage_fields,
        *(f"{surface}_{field}" for surface in SURFACES for field in ("outcome", "evidence")),
        "limitations",
    ])
    for row in rows:
        report = report_data(row)
        coverage = report["coverage"]
        values = [
            report["report_id"], report["handle"], report["captured_at_utc"],
            report["evidence_source"]["id"], *(coverage[field] for field in coverage_fields),
            *(item[field] for item in report["observations"] for field in ("outcome_label", "evidence")),
            " ".join(report["limitations"]),
        ]
        writer.writerow(map(spreadsheet_cell, values))
    return output.getvalue().encode("utf-8")


def print_html(report, template):
    coverage = report["coverage"]
    score = coverage["visibility_percent"]
    observations = "".join(
        f'<article class="card"><h2>{escape(item["label"])}</h2>'
        f'<p><span class="badge {escape(item["outcome"])}">{escape(item["outcome_label"])}</span></p>'
        f'<p>{escape(item["evidence"])}</p></article>'
        for item in report["observations"]
    )
    limitations = "".join(f"<li>{escape(limit)}</li>" for limit in report["limitations"])
    return template.substitute(
        handle=escape(report["handle"]),
        timestamp=escape(report["captured_at_utc"]),
        date=escape(report["captured_at_utc"].replace("T", " ").replace("Z", " UTC")),
        source=escape(report["evidence_source"]["label"]),
        measured=coverage["measured_surfaces"],
        total=coverage["total_surfaces"],
        score=(
            f'{score}% · {coverage["visible_surfaces"]} of {coverage["measured_surfaces"]} measured surfaces visible'
            if score is not None else "Unmeasured"
        ),
        observations=observations,
        limitations=limitations,
    ).encode("utf-8")
