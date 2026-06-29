#!/usr/bin/env python3
"""Extract structured provider data from the PAMI Cartilla Médica PDF.

The PDF is text-based, so the exporter uses `pdftotext -layout` instead of OCR.
It emits a JSON document with:

* source metadata from `pdfinfo`
* a lightweight patient/document header
* a flat `providers` list for easy search by name, specialty, and location
* a section summary with per-specialty counts
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Iterable


BOILERPLATE = {
    "cartilla médica",
    "resultados",
    "toda la cartilla",
    "en ciudad autónoma de buenos aires",
}

PHONEISH_TOKENS = (
    "telefono",
    "teléfono",
    "whatsapp",
    "turnos",
    "linea",
    "mail",
    "gmail",
    "@",
)


def run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd).decode("utf-8", "ignore")


def parse_pdfinfo(pdf_path: Path) -> dict:
    info = {}
    for line in run(["pdfinfo", str(pdf_path)]).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        info[key.strip()] = value.strip()
    return info


def extract_pages(pdf_path: Path) -> list[str]:
    text = run(["pdftotext", "-layout", str(pdf_path), "-"])
    return text.split("\f")


def split_heading(raw: str) -> tuple[str, str | None]:
    parts = re.split(r"\s{2,}", raw.strip())
    if len(parts) >= 2:
        specialty = " ".join(parts[:-1]).strip()
        location = parts[-1].strip() or None
        return specialty, location
    return raw.strip(), None


def looks_like_heading(raw: str) -> bool:
    stripped = raw.strip()
    low = stripped.lower()
    if not stripped or low in BOILERPLATE:
        return False
    if ":" in stripped:
        return False
    if re.search(r"\d", stripped):
        return False
    if any(token in low for token in PHONEISH_TOKENS):
        return False
    return True


def parse_patient_display_name(lines: Iterable[str]) -> str | None:
    for raw in lines:
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped in {"Cartilla médica", "Resultados"}:
            continue
        if ":" not in stripped and not re.search(r"\d", stripped):
            return stripped
    return None


def parse_document(pdf_path: Path) -> dict:
    pages = extract_pages(pdf_path)
    pdf_info = parse_pdfinfo(pdf_path)

    patient_display_name = None
    current_section: tuple[str, str | None] | None = None
    current_record: dict | None = None
    state: str | None = None
    providers: list[dict] = []
    section_counts: Counter[tuple[str, str | None]] = Counter()

    for page_number, page_text in enumerate(pages, start=1):
        lines = [line.rstrip() for line in page_text.splitlines()]

        if page_number == 1:
            preface = []
            post_results = []
            seen_results = False
            for line in lines:
                if line.strip() == "Resultados":
                    seen_results = True
                    continue
                (post_results if seen_results else preface).append(line)

            if patient_display_name is None:
                patient_display_name = parse_patient_display_name(preface)
            lines = post_results

        for raw_line in lines:
            stripped = raw_line.strip()
            if not stripped or stripped.startswith("Pág.") or stripped == "Cartilla médica":
                continue
            if stripped.lower() in BOILERPLATE:
                continue

            if stripped.startswith("Nombre:"):
                current_record = {
                    "specialty": current_section[0] if current_section else None,
                    "location": current_section[1] if current_section else None,
                    "name": stripped.split(":", 1)[1].strip(),
                    "address": "",
                    "phone": "",
                    "source_page": page_number,
                }
                providers.append(current_record)
                if current_record["specialty"] is not None:
                    section_counts[(current_record["specialty"], current_record["location"])] += 1
                state = "address"
                continue

            if current_record is None:
                if looks_like_heading(stripped):
                    current_section = split_heading(stripped)
                continue

            if stripped.startswith("Dirección:"):
                value = stripped.split(":", 1)[1].strip()
                current_record["address"] += (" " if current_record["address"] else "") + value
                state = "address"
                continue

            if stripped.startswith("Teléfono:"):
                value = stripped.split(":", 1)[1].strip()
                current_record["phone"] += (" " if current_record["phone"] else "") + value
                state = "phone"
                continue

            if state == "address":
                current_record["address"] += (" " if current_record["address"] else "") + stripped
                continue

            if state == "phone":
                if looks_like_heading(stripped):
                    current_record = None
                    state = None
                    current_section = split_heading(stripped)
                else:
                    current_record["phone"] += (" " if current_record["phone"] else "") + stripped
                continue

            # Defensive fallback: preserve text rather than drop it.
            current_record["phone"] += (" " if current_record["phone"] else "") + stripped

    sections = [
        {
            "specialty": specialty,
            "location": location,
            "provider_count": count,
        }
        for (specialty, location), count in section_counts.items()
    ]

    return {
        "source": {
            "pdf_path": str(pdf_path),
            "title": pdf_info.get("Title"),
            "subject": pdf_info.get("Subject"),
            "author": pdf_info.get("Author"),
            "creator": pdf_info.get("Creator"),
            "producer": pdf_info.get("Producer"),
            "pages": int(pdf_info["Pages"]) if pdf_info.get("Pages", "").isdigit() else None,
            "creation_date": pdf_info.get("CreationDate"),
            "mod_date": pdf_info.get("ModDate"),
        },
        "patient": {
            "display_name": patient_display_name,
        },
        "record_count": len(providers),
        "section_count": len(sections),
        "sections": sections,
        "providers": providers,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract PAMI cartilla médica providers into JSON.")
    parser.add_argument(
        "pdf",
        nargs="?",
        default="/Users/damian.troncoso/Downloads/Cartilla_Medica.pdf",
        help="Path to Cartilla_Medica.pdf",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output JSON path. Defaults to cartilla_medica/output/cartilla_medica.json next to this script.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if args.output:
        out_path = Path(args.output).expanduser().resolve()
    else:
        out_path = Path(__file__).resolve().parent.parent / "output" / "cartilla_medica.json"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    document = parse_document(pdf_path)
    document["generated_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    out_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"Providers: {document['record_count']}, sections: {document['section_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
