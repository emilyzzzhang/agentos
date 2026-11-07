"""Knowledge Library endpoints. Every route is scoped to the request's workspace."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from rag.documents import (DocumentNotFound, DocumentService, DuplicateDocument, TooManyPending, chunk_to_dict,
                           document_to_dict)
from rag.knowledge import KnowledgeUnavailable
from rag.parsing import ParseError, UnsupportedFile
from storage.files import StorageError

from .deps import workspace

router = APIRouter(prefix="/documents", tags=["documents"])
HEARTBEAT_S = 10.0
MULTIPART_OVERHEAD = 64 * 1024


def service(request: Request) -> DocumentService:
    return request.app.state.documents


def _doc(request: Request, d) -> dict:
    return document_to_dict(d, request.app.state.kb)


async def _get_or_404(request: Request, ws: str, document_id: str):
    try:
        return await service(request).get(ws, document_id)
    except DocumentNotFound:
        raise HTTPException(404, "document not found")


@router.post("", status_code=202)
async def upload_document(request: Request, file: UploadFile = File(...), ws: str = Depends(workspace)):
    limit = request.app.state.settings.max_upload_mb * 1024 * 1024
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + MULTIPART_OVERHEAD:
        raise HTTPException(413, f"The file is larger than {request.app.state.settings.max_upload_mb} MB.")
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"The file is larger than {request.app.state.settings.max_upload_mb} MB.")
    try:
        doc = await service(request).upload(ws, file.filename or "document", data)
    except UnsupportedFile as exc:
        raise HTTPException(415, str(exc))
    except ParseError as exc:
        raise HTTPException(422, str(exc))
    except DuplicateDocument as exc:
        raise HTTPException(409, {"message": str(exc), "document_id": exc.existing.id})
    except TooManyPending as exc:
        raise HTTPException(429, str(exc))
    except KnowledgeUnavailable as exc:
        raise HTTPException(503, str(exc))
    return _doc(request, doc)


@router.get("")
async def list_documents(request: Request, ws: str = Depends(workspace)):
    docs = await service(request).list(ws)
    kb = request.app.state.kb
    return {"documents": [_doc(request, d) for d in docs], "knowledge": kb.info(),
            "events_seq": request.app.state.library_events.last_seq(ws)}


@router.get("/events")
async def document_events(request: Request, after: int = Query(0, ge=0), ws: str = Depends(workspace)):
    """Live document.* events (uploaded, indexing_started/completed/failed, deleted). Metadata only."""
    bus = request.app.state.library_events

    async def gen():
        yield "retry: 2000\n\n"
        async for e in bus.subscribe(ws, after, heartbeat_s=HEARTBEAT_S):
            if await request.is_disconnected():
                return
            if e is None:
                yield "event: heartbeat\ndata: {}\n\n"
                continue
            yield f"id: {e.seq}\nevent: library\ndata: {e.to_json()}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/{document_id}")
async def get_document(document_id: str, request: Request, ws: str = Depends(workspace)):
    return _doc(request, await _get_or_404(request, ws, document_id))


@router.get("/{document_id}/chunks/{chunk_id}")
async def get_chunk(document_id: str, chunk_id: str, request: Request, ws: str = Depends(workspace)):
    try:
        return await service(request).get_chunk(ws, document_id, chunk_id)
    except DocumentNotFound:
        raise HTTPException(404, "passage not found")


@router.get("/{document_id}/file")
async def get_file(document_id: str, request: Request, ws: str = Depends(workspace)):
    """The original upload. Served with headers that stop the browser from executing it."""
    doc = await _get_or_404(request, ws, document_id)
    try:
        data = service(request).storage.get(doc.storage_key)
    except StorageError:
        raise HTTPException(404, "file not found")
    media = "application/pdf" if doc.file_type == "pdf" else "text/plain; charset=utf-8"
    return Response(data, media_type=media, headers={
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(doc.filename)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, max-age=300",
    })


@router.delete("/{document_id}")
async def delete_document(document_id: str, request: Request, ws: str = Depends(workspace)):
    try:
        await service(request).delete(ws, document_id)
    except DocumentNotFound:
        raise HTTPException(404, "document not found")
    except KnowledgeUnavailable as exc:
        raise HTTPException(503, str(exc))
    return {"deleted": True, "document_id": document_id}


@router.post("/{document_id}/reindex", status_code=202)
async def reindex_document(document_id: str, request: Request, ws: str = Depends(workspace)):
    try:
        return _doc(request, await service(request).reindex(ws, document_id))
    except DocumentNotFound:
        raise HTTPException(404, "document not found")
    except KnowledgeUnavailable as exc:
        raise HTTPException(503, str(exc))


__all__ = ["router", "chunk_to_dict"]
