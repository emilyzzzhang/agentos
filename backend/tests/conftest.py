import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import Settings  # noqa: E402


@pytest.fixture
def settings(tmp_path):
    # Unit tests use SQLite and in-memory Qdrant; test_postgres.py covers the real PostgreSQL + Alembic path.
    return Settings(anthropic_api_key=None, data_dir=tmp_path, max_revisions=2,
                    database_url=f"sqlite+aiosqlite:///{tmp_path / 'agentos.db'}",
                    chunk_size=300, chunk_overlap=50, rag_min_score=0.05)
