"""Security evaluation runner (12.3, 12.4).

Computes detection recall, false-positive rate, precision, F1-score,
and latencies across versioned datasets.
"""

import argparse
import asyncio
import json
import math
import platform
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from app.security.detectors.pii import PIIDetector
from app.security.detectors.rules import JailbreakDetector, PromptInjectionDetector
from app.security.detectors.secrets import SecretDetector


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = (len(values) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(values[int(k)])
    d0 = values[int(f)] * (c - k)
    d1 = values[int(c)] * (k - f)
    return float(d0 + d1)


async def evaluate_dataset(dataset: dict) -> dict[str, dict]:
    detectors = {
        "prompt_injection": PromptInjectionDetector(),
        "jailbreak": JailbreakDetector(),
        "pii": PIIDetector(),
        "secrets": SecretDetector(),
    }

    results = {}
    for category, detector in detectors.items():
        cases = [c for c in dataset.get("cases", []) if c.get("category") == category]
        if not cases:
            continue

        positives = [c for c in cases if c.get("malicious")]
        negatives = [c for c in cases if not c.get("malicious")]

        tp = 0
        fn = 0
        fp = 0
        tn = 0
        latencies = []

        for case in cases:
            text = case["text"]
            t0 = time.perf_counter()
            res = await detector.detect(text)
            lat = (time.perf_counter() - t0) * 1000
            latencies.append(lat)

            detected = res.score > 0 and res.suggested_action in ("block", "redact", "flag")

            if case.get("malicious"):
                if detected:
                    tp += 1
                else:
                    fn += 1
            else:
                if detected:
                    fp += 1
                else:
                    tn += 1

        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        precision = tp / (tp + fp) if (tp + fp) > 0 else (1.0 if tp == 0 and fp == 0 else 0.0)
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        results[category] = {
            "positives": len(positives),
            "negatives": len(negatives),
            "true_positives": tp,
            "false_positives": fp,
            "true_negatives": tn,
            "false_negatives": fn,
            "recall": round(recall, 4),
            "false_positive_rate": round(fpr, 4),
            "precision": round(precision, 4),
            "f1_score": round(f1, 4),
            "p50_latency_ms": round(percentile(latencies, 0.50), 2),
            "p95_latency_ms": round(percentile(latencies, 0.95), 2),
        }

    return results


evaluate = evaluate_dataset


def format_markdown_report(all_evaluations: dict[str, dict]) -> str:
    lines = [
        "# Security Evaluation Report",
        "",
        f"**Generated:** {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}  ",
        f"**Python:** {sys.version.split()[0]} | **Platform:** {platform.platform()}  ",
        "**Policy Version:** 1 (default security policy)",
        "",
        "## Summary by Dataset & Category",
        "",
    ]

    for ds_name, metrics in all_evaluations.items():
        lines.append(f"### Dataset: `{ds_name}`")
        lines.append("")
        lines.append(
            "| Category | Pos | Neg | Recall | FPR | Precision | F1 | p50 (ms) | p95 (ms) |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for cat, m in sorted(metrics.items()):
            rec = f"{m['recall']:.1%}"
            fpr = f"{m['false_positive_rate']:.1%}"
            prec = f"{m['precision']:.1%}"
            f1 = f"{m['f1_score']:.1%}"
            lines.append(
                f"| {cat} | {m['positives']} | {m['negatives']} | {rec} | {fpr} | "
                f"{prec} | {f1} | {m['p50_latency_ms']}ms | {m['p95_latency_ms']}ms |"
            )
        lines.append("")

    lines.append("## Evaluation Methodology & Guardrails")
    lines.append(
        "- **Adversarial & Hard Negatives**: Evaluated against natural and obfuscated inputs."
    )
    lines.append(
        "- **Held-Out Test Split**: Used to verify generalizability and avoid overfitting."
    )
    lines.append("- **Recall Definition**: `TP / (TP + FN)` over malicious samples.")
    lines.append("- **False Positive Rate**: `FP / (FP + TN)` over benign samples.")
    lines.append("")

    return "\n".join(lines)


async def run_cli() -> None:
    parser = argparse.ArgumentParser(description="Run security evaluation on versioned datasets.")
    parser.add_argument(
        "--dataset",
        default="all",
        help="Dataset name (e.g. injection_v1, held_out_v1, or all)",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Path to save markdown report (e.g. docs/reports/security_eval.md)",
    )
    args = parser.parse_args()

    datasets_dir = Path(__file__).parent / "datasets"
    if args.dataset == "all":
        dataset_files = sorted(datasets_dir.glob("*.json"))
    else:
        name = args.dataset if args.dataset.endswith(".json") else f"{args.dataset}.json"
        dataset_files = [datasets_dir / name]

    all_results = {}
    for ds_file in dataset_files:
        if not ds_file.exists():
            print(f"Dataset file not found: {ds_file}", file=sys.stderr)
            continue
        ds_data = json.loads(ds_file.read_text())
        version = ds_data.get("version", ds_file.stem)
        res = await evaluate_dataset(ds_data)
        all_results[version] = res

    # Output JSON summary to stdout
    print(json.dumps(all_results, indent=2))

    # Output Markdown report if requested
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        md = format_markdown_report(all_results)
        report_path.write_text(md)
        print(f"\nReport written to: {report_path.resolve()}")


def main() -> None:
    asyncio.run(run_cli())


if __name__ == "__main__":
    main()
