"""Original-file storage behind a small interface.

Document metadata lives in PostgreSQL; the original bytes live here, addressed by an opaque
key such as `default/doc_ab12.../original.pdf`. `LocalFileStorage` writes under the data
directory. An S3-compatible implementation only needs the same four methods.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Protocol


class StorageError(RuntimeError):
    pass


class FileStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


class LocalFileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root) or p == self.root:
            raise StorageError(f"invalid storage key: {key!r}")
        return p

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)  # atomic: readers never see a partial file
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise StorageError(f"file not found: {key}") from exc

    def delete(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)
        try:  # remove the now-empty per-document directory
            path.parent.rmdir()
        except OSError:
            pass

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()
