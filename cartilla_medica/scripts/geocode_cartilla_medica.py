#!/usr/bin/env python3
"""Geocode Cartilla Médica addresses with OpenStreetMap Nominatim.

This script enriches the extracted JSON with coordinates using a cached,
single-threaded lookup flow that respects the public Nominatim usage policy.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
import re
from pathlib import Path


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "cartilla-medica-geocoder/1.0 (local-batch-geocoding)"


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.replace("\u00a0", " ").split())


def normalize_address(value: str | None) -> str:
    text = normalize_text(value)
    if not text:
        return ""

    text = re.sub(r"\bPiso-Depto\.?:\s*[^-]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPiso-Depto\.?\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bDepto\.?:\s*[^-]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPta\.?\s*Baja\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*-\s*Ciudad Autónoma De Buenos Aires\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*-\s*Ciudad De Buenos Aires\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*-\s*CABA\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bDirec\b\.?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bDepto\b\.?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPb\b\.?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPb\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b1°\b", "1", text)
    text = re.sub(r"\b2º\b", "2", text)
    text = re.sub(r"\b3º\b", "3", text)
    text = re.sub(r"\b4º\b", "4", text)
    text = re.sub(r"\b5°\b", "5", text)
    text = re.sub(r"\b1834\s+1834\b", "1834", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;-")

    regex_rules = [
        (r"\bPeron\s*,\s*Pte\.?\b", "Teniente General Juan Domingo Peron"),
        (r"\bPte\.?\s+Peron\b", "Teniente General Juan Domingo Peron"),
        (r"\bTte\.?\s+Gral\.?\s+Juan\s+Domingo\s+Peron\b", "Teniente General Juan Domingo Peron"),
        (r"\bTte\.?\s+Gral\.?\s+J\.?\s*D\.?\s+Peron\b", "Teniente General Juan Domingo Peron"),
        (r"\bTte\.?\s+G\.?\s+Peron\b", "Teniente General Juan Domingo Peron"),
        (r"\bTte\.?\s+Gral\b\.?", "Teniente General"),
        (r"\bTte\.?\b", "Teniente"),
        (r"\bAvda\.?\b", "Avenida"),
        (r"\bAv\.?\b", "Avenida"),
        (r"\bGral\.?\b", "General"),
        (r"\bDr\.?\b", "Doctor"),
        (r"\bDra\.?\b", "Doctora"),
        (r"\bCnel\.?\b", "Coronel"),
        (r"\bBme\b", "Bartolome"),
        (r"\bPuyrredon\b", "Pueyrredon"),
        (r"\bBillingurst\b", "Billinghurst"),
        (r"\bMent[oó]n\b", "Melián"),
        (r"\bMenton\b", "Melian"),
        (r"\bAv\.?\s*Ment[oó]n\b", "Avenida Melián"),
        (r"\bAvenida\.?\s*Ment[oó]n\b", "Avenida Melián"),
        (r"\bJuan\s*R\.?\s*De\s*Velasco\b", "Juan Ramírez de Velasco"),
        (r"\bLobo\s*De\s*La\s*Vega\b", "Lope de Vega"),
        (r"\bBaldomero\s*Fdez\s*Moreno\b", "Baldomero Fernández Moreno"),
        (r"\bAv\.?\s*Gral\.?\s*J\.?\s*G\.?\s*Artigas\b", "Avenida General José Gervasio Artigas"),
        (r"\bAvenida\.?\s*General\.?\s*J\.?\s*G\.?\s*Artigas\b", "Avenida General José Gervasio Artigas"),
        (r"\bTte\.?\s*Gral\.?\s*J\.?\s*D\.?\s*Per[oó]n\b", "Teniente General Juan Domingo Perón"),
        (r"\bTeniente General\s+J\.?\s*D\.?\s*Per[oó]n\b", "Teniente General Juan Domingo Perón"),
        (r"\bPte\.?\b", "Presidente"),
        (r"\bJ\.?\s*D\.?\s+Peron\b", "Juan Domingo Peron"),
        (r"\bJuan\s+D\.?\s+Peron\b", "Juan Domingo Peron"),
        (r"\bM\.?\b", "Mariscal"),
    ]
    for pattern, replacement in regex_rules:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    return " ".join(text.split())


def build_query(provider: dict) -> str:
    # Avoid sending provider names to the public service; geocode the public address only.
    parts = [provider.get("address"), provider.get("location")]
    parts = [normalize_text(part) for part in parts if normalize_text(part)]
    parts.append("Buenos Aires")
    parts.append("Argentina")
    # This improves hit rate for addresses that only include a street and number.
    return ", ".join(dict.fromkeys(parts))


def build_query_variants(provider: dict) -> list[str]:
    """Generate progressively looser queries for fallback geocoding."""
    variants: list[str] = []

    address = normalize_address(provider.get("address"))
    location = normalize_text(provider.get("location"))

    base_parts = [address, location, "Buenos Aires", "Argentina"]
    base_parts = [part for part in base_parts if part]
    if base_parts:
        variants.append(", ".join(dict.fromkeys(base_parts)))

    if address:
        variants.append(", ".join([address, "Buenos Aires", "Argentina"]))

    if location and address:
        variants.append(", ".join([address, location, "Argentina"]))

    if address:
        stripped_city = re.sub(r"\s*-\s*(Ciudad Autónoma De Buenos Aires|Ciudad De Buenos Aires|CABA)\b", "", address, flags=re.IGNORECASE).strip()
        if stripped_city and stripped_city != address:
            variants.append(", ".join([stripped_city, "Buenos Aires", "Argentina"]))

    if address:
        street_number = re.match(r"^(.+?\d+)", address)
        if street_number:
            variants.append(", ".join([street_number.group(1).strip(), "Buenos Aires", "Argentina"]))

    # Preserve order while deduplicating.
    return list(dict.fromkeys(variants))


def geocode(query: str) -> dict | None:
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": "1",
        "addressdetails": "1",
        "countrycodes": "ar",
    }
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload:
        return None
    match = payload[0]
    return {
        "lat": float(match["lat"]),
        "lon": float(match["lon"]),
        "display_name": match.get("display_name"),
        "class": match.get("class"),
        "type": match.get("type"),
        "importance": match.get("importance"),
        "place_id": match.get("place_id"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Add geocoded coordinates to Cartilla Médica providers.")
    parser.add_argument(
        "input",
        nargs="?",
        default="/Users/damian.troncoso/build/DAMIAN-DEV/da-mian.github.io/cartilla_medica/output/cartilla_medica.json",
        help="Path to cartilla_medica.json",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output JSON path. Defaults to cartilla_medica_geocoded.json next to the input file.",
    )
    parser.add_argument(
        "--cache",
        default=None,
        help="Optional cache JSON path. Defaults to geocode_cache.json next to the output file.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=1.1,
        help="Seconds to sleep between lookups. Defaults to 1.1 to stay under the public 1 req/s guidance.",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
    else:
        output_path = input_path.with_name("cartilla_medica_geocoded.json")
    cache_path = Path(args.cache).expanduser().resolve() if args.cache else output_path.with_name("geocode_cache.json")

    document = json.loads(input_path.read_text(encoding="utf-8"))
    cache = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

    provider_count = 0
    geocoded_count = 0

    for provider in document.get("providers", []):
        provider_count += 1
        if provider.get("lat") is not None and provider.get("lon") is not None:
            geocoded_count += 1
            continue

        queries = build_query_variants(provider)
        provider["geocode_query"] = queries[0] if queries else None

        result = None
        for query in queries:
            provider["geocode_query"] = query
            if query in cache:
                result = cache[query]
            else:
                result = geocode(query)
                cache[query] = result
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                time.sleep(args.sleep)

            if result:
                break

        if result:
            provider["lat"] = result["lat"]
            provider["lon"] = result["lon"]
            provider["geocode"] = result
            geocoded_count += 1
        else:
            provider["geocode"] = None

    document["geocoding"] = {
        "provider": "OpenStreetMap Nominatim",
        "query_template": "name, address, location, Buenos Aires, Argentina",
        "cached": True,
        "input_count": provider_count,
        "geocoded_count": geocoded_count,
        "unresolved_count": provider_count - geocoded_count,
    }

    output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output_path}")
    print(f"Geocoded {geocoded_count}/{provider_count} providers")
    print(f"Cache: {cache_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
