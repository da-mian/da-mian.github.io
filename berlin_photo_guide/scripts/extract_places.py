#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from contextlib import contextmanager
from pathlib import Path

HEADINGS = [
    "Location",
    "Coordinates",
    "Accessibility",
    "Hours",
    "Best time to visit",
    "Entry Fee",
    "Gear",
    "Settings",
    "Tripod",
    "Tips & additional information",
]

TWO_COLUMN_HEADINGS = [
    ("Hours", "Gear"),
    ("Best time to visit", "Settings"),
    ("Entry Fee", "Tripod"),
]


def run(cmd):
    subprocess.run(cmd, check=True)


def slugify(value):
    norm = unicodedata.normalize("NFKD", value)
    ascii_str = norm.encode("ascii", "ignore").decode("ascii")
    ascii_str = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_str).strip("_")
    return ascii_str.lower() or "place"


def parse_pages(pdf_path):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as tmp:
        tmp_path = tmp.name
    try:
        run(["pdftotext", "-layout", pdf_path, tmp_path])
        text = Path(tmp_path).read_text(errors="ignore")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return text.split("\f")


def parse_location_page(page_text, pdf_page_number, pdf_page_detail=None):
    lines = [line.rstrip("\n") for line in page_text.splitlines()]
    def is_location_heading(text):
        stripped = text.strip()
        return stripped.startswith("Location") and not stripped.startswith("Location changed")

    if not any(is_location_heading(line) for line in lines):
        return None

    loc_idx = next(i for i, line in enumerate(lines) if is_location_heading(line))
    header_lines = [line.strip() for line in lines[:loc_idx] if line.strip()]

    place_number = None
    if header_lines and re.fullmatch(r"\d+", header_lines[0]):
        place_number = int(header_lines[0])
        header_lines = header_lines[1:]

    title_lines = header_lines
    title = " ".join(title_lines).strip()

    if place_number is None:
        return None

    sections = {h: [] for h in HEADINGS}

    if "Location changed!" in title_lines:
        title_lines = [line for line in title_lines if line != "Location changed!"]
        title = " ".join(title_lines).strip()
        sections["Tips & additional information"].append("Location changed!")
    current_single = None
    left_section = None
    right_section = None

    for raw in lines[loc_idx:]:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue

        # Single-line sections with inline values.
        if stripped.startswith("Location") and not stripped.startswith("Location changed"):
            current_single = "Location"
            left_section = right_section = None
            value = stripped[len("Location"):].strip()
            if value:
                sections["Location"].append(value)
            continue
        if stripped.startswith("Coordinates"):
            current_single = "Coordinates"
            left_section = right_section = None
            value = stripped[len("Coordinates"):].strip()
            if value:
                sections["Coordinates"].append(value)
            continue
        if stripped.startswith("Accessibility"):
            current_single = "Accessibility"
            left_section = right_section = None
            value = stripped[len("Accessibility"):].strip()
            if value:
                sections["Accessibility"].append(value)
            continue

        # Tips section.
        if stripped.startswith("Tips & additional information"):
            current_single = "Tips & additional information"
            left_section = right_section = None
            continue

        # Two-column headings.
        matched_two_col = False
        for left, right in TWO_COLUMN_HEADINGS:
            if left in line and right in line:
                left_section, right_section = left, right
                current_single = None
                matched_two_col = True
                break
        if matched_two_col:
            continue

        # Two-column entries.
        if left_section and right_section:
            parts = re.split(r"\s{2,}", stripped)
            if len(parts) >= 2:
                left_val = parts[0].strip()
                right_val = parts[1].strip()
                if left_val:
                    sections[left_section].append(left_val)
                if right_val:
                    sections[right_section].append(right_val)
            else:
                sections[left_section].append(parts[0].strip())
            continue

        # Single-column continuation.
        if current_single in sections:
            sections[current_single].append(stripped)

    location_lines = [
        line for line in sections["Location"]
        if "Click to open" not in line and "Google Maps" not in line
    ]

    coords_raw = sections["Coordinates"][0] if sections["Coordinates"] else ""
    coords_nums = re.findall(r"[-+]?\d+\.\d+", coords_raw)
    coords = None
    if len(coords_nums) >= 2:
        coords = {"lat": float(coords_nums[0]), "lng": float(coords_nums[1])}

    accessibility = sections["Accessibility"][0] if sections["Accessibility"] else ""

    return {
        "pdf_page": pdf_page_number,
        "pdf_page_detail": pdf_page_detail,
        "place_number": place_number,
        "title": title,
        "title_lines": title_lines,
        "location": ", ".join([line for line in location_lines if line]).strip(),
        "location_lines": location_lines,
        "coordinates": coords,
        "coordinates_raw": coords_raw,
        "accessibility": accessibility,
        "hours": sections["Hours"],
        "best_time_to_visit": sections["Best time to visit"],
        "entry_fee": sections["Entry Fee"],
        "gear": sections["Gear"],
        "settings": sections["Settings"],
        "tripod": sections["Tripod"],
        "tips": sections["Tips & additional information"],
    }


def parse_places_from_pages(pages):
    places = []
    index = 0
    while index < len(pages):
        page_text = pages[index]
        has_location = any(
            line.strip().startswith("Location")
            and not line.strip().startswith("Location changed")
            for line in page_text.splitlines()
        )
        if not has_location:
            index += 1
            continue

        merged_text = page_text
        detail_page = None
        if index + 1 < len(pages):
            next_text = pages[index + 1]
            next_has_location = any(
                line.strip().startswith("Location")
                and not line.strip().startswith("Location changed")
                for line in next_text.splitlines()
            )
            if not next_has_location:
                merged_text = f"{page_text}\n{next_text}"
                detail_page = index + 2
                index += 1

        place = parse_location_page(merged_text, index + 1, detail_page)
        if place:
            places.append(place)
        index += 1

    return places


@contextmanager
def extract_images_batch(pdf_path, page_min, page_max):
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "img")
        run(["pdfimages", "-png", "-p", "-f", str(page_min), "-l", str(page_max), pdf_path, prefix])
        files = list(Path(tmpdir).glob("img-*.png"))
        image_files = {}
        for path in files:
            match = re.search(r"img-(\d+)-(\d+)\.png$", path.name)
            if not match:
                continue
            page = int(match.group(1))
            image_files.setdefault(page, []).append(path)
        yield image_files


def choose_largest_image(candidates):
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_size)


def main():
    parser = argparse.ArgumentParser(description="Extract places and images from Berlin Photo Guide PDF.")
    parser.add_argument("pdf", help="Path to PDF")
    parser.add_argument("--out", default="output", help="Output directory")
    parser.add_argument("--page-min", type=int, default=None, help="First PDF page to process (1-based)")
    parser.add_argument("--page-max", type=int, default=None, help="Last PDF page to process (1-based)")
    parser.add_argument("--append", action="store_true", help="Append to existing places.json if present")
    parser.add_argument("--skip-images", action="store_true", help="Skip extracting images")
    args = parser.parse_args()

    pdf_path = args.pdf
    out_dir = Path(args.out)
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    pages = parse_pages(pdf_path)
    if args.page_min or args.page_max:
        page_min = args.page_min or 1
        page_max = args.page_max or len(pages)
        pages_slice = pages[page_min - 1:page_max]
        places = parse_places_from_pages(pages_slice)
        # Adjust page numbers when slicing.
        for place in places:
            place["pdf_page"] = (place["pdf_page"] or 0) + (page_min - 1)
            if place.get("pdf_page_detail"):
                place["pdf_page_detail"] = place["pdf_page_detail"] + (page_min - 1)
    else:
        places = parse_places_from_pages(pages)

    page_to_place = {place["pdf_page"]: place for place in places if place.get("pdf_page")}

    if places and not args.skip_images:
        pages_with_places = sorted(page_to_place.keys())
        page_min, page_max = pages_with_places[0], pages_with_places[-1]

        with extract_images_batch(pdf_path, page_min, page_max) as image_files:
            for page_num, place in page_to_place.items():
                slug = slugify(place["title"] or f"page_{page_num}")
                candidates = image_files.get(page_num, [])
                chosen = choose_largest_image(candidates)
                if not chosen:
                    place["image"] = None
                    place["image_path"] = None
                    continue
                dest_name = f"{page_num:03d}_{slug}{chosen.suffix}"
                dest_path = images_dir / dest_name
                shutil.copy2(chosen, dest_path)
                place["image"] = dest_name
                place["image_path"] = str(Path("images") / dest_name)

    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / "places.json"
    if args.append and output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))
        existing_pages = {p.get("pdf_page") for p in existing if isinstance(p, dict)}
        merged = existing + [p for p in places if p.get("pdf_page") not in existing_pages]
    else:
        merged = places
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(merged)} places to {output_path}")


if __name__ == "__main__":
    main()
