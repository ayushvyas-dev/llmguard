import json
from pathlib import Path

import pytest

from tests.security_eval.run import evaluate


@pytest.mark.asyncio
async def test_injection_dataset_evaluation_reports_recall_and_false_positive_rate() -> None:
    path = Path(__file__).parents[2] / "security_eval" / "datasets" / "injection_v1.json"
    report = await evaluate(json.loads(path.read_text()))
    assert {"prompt_injection", "jailbreak"}.issubset(set(report))
    assert all(
        "recall" in metrics and "false_positive_rate" in metrics for metrics in report.values()
    )
