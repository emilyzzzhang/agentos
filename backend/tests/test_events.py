import asyncio
import json

from events import EventRecorder, EventType


async def test_sequence_jsonl_and_replay(tmp_path):
    path = tmp_path / "e.jsonl"
    rec = EventRecorder("run_1", path)
    await rec.emit(EventType.RUN_STARTED, payload={"q": 1})
    await rec.emit(EventType.AGENT_STARTED, agent_id="alex", task_id="plan")
    await rec.emit(EventType.RUN_COMPLETED)
    assert [e.seq for e in rec.events] == [1, 2, 3]
    assert len({e.id for e in rec.events}) == 3
    lines = [json.loads(l) for l in path.read_text().splitlines()]
    assert lines[1]["agent_id"] == "alex" and lines[1]["task_id"] == "plan" and lines[1]["type"] == "agent.started"
    assert lines[0]["timestamp"].endswith("Z") or "+00:00" in lines[0]["timestamp"]
    replay = [e.seq async for e in rec.subscribe(after_seq=1) if e is not None]
    assert replay == [2, 3]
    assert rec.closed


async def test_live_subscriber_receives_new_events(tmp_path):
    rec = EventRecorder("run_2")
    got = []

    async def consume():
        async for e in rec.subscribe(0, heartbeat_s=0.05):
            if e is not None:
                got.append(e.type)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.12)  # let a heartbeat tick pass without blocking emit()
    await rec.emit(EventType.RUN_STARTED)
    await rec.emit(EventType.RUN_FAILED, payload={"error": "x"})
    await asyncio.wait_for(task, 1)
    assert got == [EventType.RUN_STARTED, EventType.RUN_FAILED]
