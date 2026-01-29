#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required: pip install pillow") from exc


def compare_pair(golden_path: Path, current_path: Path):
    golden = Image.open(golden_path).convert("RGBA")
    current = Image.open(current_path).convert("RGBA")
    if golden.size != current.size:
        return {
            "size_mismatch": True,
            "golden_size": golden.size,
            "current_size": current.size,
            "max_delta": 255,
            "diff_percent": 100.0,
        }

    golden_px = golden.load()
    current_px = current.load()
    width, height = golden.size
    total = width * height
    diff_pixels = 0
    max_delta = 0

    for y in range(height):
        for x in range(width):
            g = golden_px[x, y]
            c = current_px[x, y]
            delta = max(abs(g[i] - c[i]) for i in range(4))
            if delta > 0:
                diff_pixels += 1
                max_delta = max(max_delta, delta)

    diff_percent = (diff_pixels / total) * 100 if total else 0
    return {
        "size_mismatch": False,
        "max_delta": max_delta,
        "diff_percent": diff_percent,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", required=True, help="Path to golden images")
    parser.add_argument("--current", required=True, help="Path to current images")
    args = parser.parse_args()

    golden_root = Path(args.golden)
    current_root = Path(args.current)

    failures = []
    for golden_path in golden_root.rglob("*.png"):
        rel = golden_path.relative_to(golden_root)
        current_path = current_root / rel
        if not current_path.exists():
            failures.append((rel, "missing current"))
            continue
        result = compare_pair(golden_path, current_path)
        if result["size_mismatch"] or result["max_delta"] > 1 or result["diff_percent"] > 0:
            failures.append((rel, result))
        print(f"{rel}: max_delta={result['max_delta']}, diff_percent={result['diff_percent']:.4f}")

    if failures:
        print("\nFailures:")
        for rel, info in failures:
            print(f"- {rel}: {info}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
