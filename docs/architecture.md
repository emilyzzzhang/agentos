# AgentOS: design notes

The full reference behind the [README](../README.md): database operations, every setting, how the backend and the 3D office work, the API, what has been verified, and the limitations.

- [Using AgentOS in detail](#using-agentos-in-detail)
- [Database operations](#database-operations) (and migrations, tests)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Verified](#verified)
- [Not verified / limitations](#not-verified--limitations)
- [Path to deployment](#path-to-deployment)

---

## Using AgentOS in detail

1. Open http://localhost:5173.
2. Type a question, or click an example such as *"Compare PostgreSQL and MongoDB for a social media application and recommend one."*
3. Press **Start mission**, then watch Alex plan, Milo search, and Luna review.
4. Click a character (or their roster chip) to inspect their task, tool calls, findings, and errors.
5. Click the **task board** on the left wall to see the mission plan and live task statuses.
6. When the report appears on the meeting table, click it (or **Open report**) to read it. You can also download it as Markdown.

**Knowledge Library.**

1. Click **Library** in the top bar. Upload PDF, Markdown or text files (button or drag and drop, up to 20 MB each). Each file shows *Queued → Indexing → Ready* (or *Failed* with the reason). Expand a row for metadata: pages, passages, embedding model, chunk settings, SHA-256. You can open the original file, reindex it, or delete it.
2. Under **Next mission**, choose **All** (every ready document; Alex decides per subtask whether to use documents, the web, or both), **Selected** (only the checked documents), or **Web only**. The mission dock shows the current choice.
3. Ask a question, e.g. *"According to the uploaded spec, what is the maximum batch size?"* Milo's monitors switch to search mode, his bubble shows the document query, and the activity feed shows each retrieval.
4. Click Milo to see each document search and its passages (file, page or section, similarity). Click a passage to read it and open the original file at that page.
5. In the report, document citations link to the retrieved passage. The Sources list separates **Uploaded documents** (file, page or section, passage ID) from **Web sources**.
6. The mission board lists all evidence the mission gathered and whether the report cited it. **Library → History** lists past missions. They survive restarts, and opening one replays its stored events.

**Demo mode.** Without an API key you can still pick **DEMO** in the mission box. It runs the same LangGraph workflow and event pipeline, but with scripted agents: no Claude calls, no web search, synthetic `.invalid` sources, and every surface is labeled `[DEMO]`. Set `AGENTOS_ENABLE_DEMO=false` to turn it off.

**Frontend dev server.** The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`. Set `AGENTOS_BACKEND_URL` to point it somewhere else. The browser never sees the Anthropic API key.

---

## Database operations

PostgreSQL uses host port **5433** so it does not clash with a PostgreSQL already installed on 5432. Both ports bind to `127.0.0.1` only. Data lives in the named volumes `agentos_agentos_pgdata` and `agentos_agentos_qdrant`.

| Task | Command |
|---|---|
| Start / status | `docker compose up -d` · `docker compose ps` |
| Stop (keep data) | `docker compose stop` (or `docker compose down`, which removes containers but keeps volumes) |
| Restart | `docker compose restart` |
| Logs | `docker compose logs -f postgres qdrant` |
| Back up PostgreSQL | `docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > agentos.sql` |
| **Delete all data** | `docker compose down -v` (removes both volumes: documents, vectors, mission history) |

### Backend startup

The backend reads the database settings from the repo-root `.env`, so `AGENTOS_DATABASE_URL` can stay empty locally. It refuses to start, with a clear message, if PostgreSQL is unreachable or not migrated. The first start downloads the embedding model (`all-MiniLM-L6-v2`, about 90 MB) in the background. Until then the library shows "Loading the embedding model", and web-only missions work as usual.

### Migrations

```bash
.venv/bin/alembic upgrade head      # apply
.venv/bin/alembic current           # show the applied revision
.venv/bin/alembic history           # list revisions
.venv/bin/alembic revision --autogenerate -m "describe change"   # after editing db/models.py; review the file
```

`alembic downgrade` drops tables and their data; it is used only by the test suite on a throwaway database.

Use a **single worker**. The run manager is in-process (see [Limitations](#not-verified--limitations)).

### Checking your API key

Optional and cheap (a few cents): check your key, the model, structured outputs, and web search access:

```bash
.venv/bin/python scripts/check_live.py
```

### Tests and checks

```bash
cd backend  && .venv/bin/python -m pytest -q -rs     # 56 tests (3 need the Compose services; they skip otherwise)
cd frontend && npm run typecheck && npm test && npm run build
```

---

## Configuration

Repo-root `.env` (Docker Compose, also read by the backend): `AGENTOS_PG_USER`, `AGENTOS_PG_PASSWORD`, `AGENTOS_PG_DB`, `AGENTOS_PG_PORT` (5433), `AGENTOS_QDRANT_PORT` (6333).

`backend/.env`:

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for live runs. Loaded only by the backend. |
| `AGENTOS_MODEL` | `claude-sonnet-5-5` | Used by all agents (centralized in `config.py`). Sonnet 5.5 costs $2/$10 per MTok. Switch to `claude-opus-5-5` for more depth. |
| `AGENTOS_SEARCH_MODEL` | `claude-sonnet-5-5` | Model that drives the server-side web search tool. |
| `AGENTOS_EFFORT_MANAGER` / `_RESEARCHER` / `_REVIEWER` | `low` / `low` / `medium` | Claude `output_config.effort` per agent. |
| `AGENTOS_SEARCH_PROVIDER` | `anthropic` | `anthropic` uses Claude's server-side web search with the same key. Web search must be enabled for your org in the Claude Console. `tavily` needs `TAVILY_API_KEY`. |
| `AGENTOS_SEARCH_TOOL_VERSION` | `web_search_20260209` | Falls back automatically to `web_search_20250305` if it yields no sources. |
| `AGENTOS_MAX_REVISIONS` | `2` | Extra research rounds Luna may request. |
| `AGENTOS_MAX_QUERIES_INITIAL` / `_FOLLOWUP` | `4` / `3` | Bounds on web searches per pass. |
| `AGENTOS_REFUSAL_FALLBACK` | `true` | Sends the server-side refusal fallback beta (`fallbacks: "default"`). It is dropped automatically if the API rejects it. |
| `AGENTOS_DATABASE_URL` | built from root `.env` | Set for managed PostgreSQL, e.g. `postgresql+psycopg://user:pass@host:5432/agentos?sslmode=require`. |
| `AGENTOS_WORKSPACE_ID` | `default` | The single local workspace. Every query is filtered by it. |
| `AGENTOS_QDRANT_URL` / `AGENTOS_QDRANT_API_KEY` | `http://127.0.0.1:6333` / — | The API key is for managed Qdrant. |
| `AGENTOS_QDRANT_COLLECTION_PREFIX` | `agentos_chunks` | The collection name adds the model and dimension. |
| `AGENTOS_EMBEDDING_MODEL` / `_DEVICE` | `sentence-transformers/all-MiniLM-L6-v2` / `cpu` | Local Sentence Transformers model. See "Changing the embedding model" below. |
| `AGENTOS_CHUNK_SIZE` / `_OVERLAP` | `1000` / `150` | Characters. A chunk never spans two PDF pages or two Markdown sections. |
| `AGENTOS_MAX_UPLOAD_MB` / `AGENTOS_MAX_PDF_PAGES` | `20` / `1000` | Upload limits. |
| `AGENTOS_INGEST_CONCURRENCY` / `AGENTOS_MAX_PENDING_DOCUMENTS` | `1` / `50` | Bounded background ingestion. |
| `AGENTOS_RAG_TOP_K` / `AGENTOS_RAG_MIN_SCORE` | `5` / `0.2` | Passages per query, and a cosine-similarity floor. The score ranks results; it is not a confidence value. |
| `AGENTOS_MAX_DOC_QUERIES` | `4` | Document searches per initial research pass. |
| `AGENTOS_DATA_DIR` | `./data` | Uploads (`uploads/<workspace>/<doc>/original.*`), JSONL event logs, Markdown reports. |

A typical live mission makes 4–8 Claude calls plus 4–10 web searches. With Sonnet 5.5 at low/medium effort, that is usually a few tens of cents. Web search is billed separately by Anthropic.

---

## Architecture

```
agentos/
├── docker-compose.yml       # PostgreSQL + Qdrant only (pinned images, named volumes, health checks)
├── .env.example             # Compose credentials template (copy to .env)
├── backend/
│   ├── config.py            # all model/provider/database/RAG settings in one place
│   ├── alembic.ini          # migrations config (URL comes from config.py)
│   ├── agents/              # Alex, Milo, Luna + Pydantic output schemas + Claude wrapper
│   ├── tools/web_search.py  # Anthropic server-side web search (default) / Tavily
│   ├── rag/
│   │   ├── parsing.py       # PDF (pypdf, per page) / Markdown (heading paths) / text; validation + cleaning
│   │   ├── chunking.py      # RecursiveCharacterTextSplitter per page/section
│   │   ├── embeddings.py    # Embedder interface + local Sentence Transformers implementation
│   │   ├── vector_store.py  # the only Qdrant code: connection, collections, upsert/delete/search
│   │   ├── retrieval.py     # RetrievalService: scoping, score floor, structured results (no Qdrant code)
│   │   ├── tools.py         # `search_documents` LangChain tool (scope bound server-side)
│   │   ├── knowledge.py     # owns embedder + index + retrieval; async startup
│   │   └── documents.py     # upload, bounded background ingestion, delete, reindex, recovery
│   ├── storage/files.py     # FileStorage interface + LocalFileStorage (S3 later)
│   ├── db/                  # SQLAlchemy models, async session, MissionStore, Alembic migrations
│   ├── workflows/           # LangGraph StateGraph, runner (run.* lifecycle), labeled demo doubles
│   ├── events/              # ExecutionEvent model, per-run recorder (JSONL + DB sink + fan-out), library bus
│   ├── api/                 # FastAPI routes (runs, documents), RunManager, workspace dependency
│   ├── tests/               # pytest (fakes, hash embeddings, PDF generator live here only)
│   └── data/                # uploads, events/<run>.jsonl, reports/<run>.md (git-ignored)
└── frontend/src/
    ├── services/            # REST client + SSE client with resume + watchdog
    ├── stores/              # runStore, reduce.ts (pure reducer), libraryStore, visualStore, uiStore
    ├── hooks/useVisualDirector.ts   # event → animation mapping
    └── components/
        ├── office/          # room, furniture, live monitors, task board, report doc, effects, waypoint layout
        ├── agents/          # procedural characters + movement/queue actor
        ├── ui/              # top bar, roster, mission dock
        └── panels/          # inspector, activity feed, mission board, library, evidence viewer, report modal
```

### Backend

- **LangGraph `StateGraph`** with a typed `OfficeState` (`TypedDict` plus reducers for sources, findings, and reviews). Nodes are `alex_plan → milo_research → luna_review → (milo_research | luna_report)`. The conditional edge returns to Milo only when Luna's verdict is `revise`, she supplied follow-up queries, and `revision_count < AGENTOS_MAX_REVISIONS`. That bounds the loop.
- **Structured outputs.** Every agent returns a Pydantic model (`ResearchPlan`, `ResearchFindings`, `ReviewDecision`, `FinalReport`) through `ChatAnthropic.with_structured_output(..., method="json_schema")`. That uses Claude's native `output_config.format`; current models reject the forced tool-choice the default method uses. Refusals, truncation, and schema mismatches raise `LLMError`.
- **No fabricated sources.** Milo's sources come only from the search API's result blocks and citation locations. Findings that cite unknown source IDs are dropped. The report renderer strips any `[S#]` marker that isn't a real source, renumbers citations `[1]`, `[2]`, …, and appends a Sources list of only what was cited.
- **Reports are answer-first and shaped by the task.** Alex classifies each request as `comparison`, `study_plan`, `how_to`, `explanation`, `summary` (of uploaded documents) or `research`. If an essential detail is missing (interview role, deadline, budget, scale, version), he records an assumption instead of inventing it, plus at most two focused clarifying questions. Luna fills a `FinalReport` whose structured fields match the type, and `render_report` lays it out. Every report starts with **Answer**: the direct answer, recommendation or deliverable in 1–3 sentences, with assumptions and "tell us" questions right under it. Then:
  - *comparison*: comparison table → when to choose each option → more detail.
  - *study_plan*: topics to cover → schedule table (when, focus, time) → checklist per phase (sorted by priority) → why this order.
  - *how_to*: before you start → steps with checkbox tasks → example.
  - *explanation*: key ideas → a flow diagram (when the topic is a process) → short explanatory sections → a worked example.
  - *research*: key findings → context sections → recommendation (only if advice was asked for).
  - *summary*: main takeaways → relevant details by topic.

  Every type ends with **Evidence** (the supporting facts, each with its citations), **Limitations** and **Sources**; the viewer collapses these. Headings are descriptive ("Write throughput"), never generic ("Verified findings"). Clarification is **not blocking**: the mission does not pause to ask; the report states what it assumed, and you can run a follow-up mission with the details.
- **Citations and sources.** Luna cites sparingly: specific facts, numbers and versions get one citation group with their one or two strongest sources; analysis, advice, plan tasks, limitations and common knowledge get none. Full support sits in the Evidence section. Findings that cite no valid source are moved to *Limitations* as "Not verified". Unknown IDs are stripped, every valid citation the model wrote is kept, and only exact repeats in a row (`[S1][S1]`) collapse. Each web source carries a URL-based type label (`agents/sources.py`: official docs, standard/spec, paper, reference, news, blog/forum, web page), and the prompts prefer primary documentation. The label is a heuristic and never removes a source.
- **Writing style.** Plain, direct technical English: short sentences and paragraphs (1–3 sentences), active voice, numbers and conditions instead of vague adjectives, important technical detail kept, tables and lists only where they help scanning, no filler or marketing phrases, and no section that repeats another.
- **Failure handling.** A failed search emits `tool.failed` and research continues with the remaining queries. If every search fails and there's no prior evidence, Milo emits `agent.failed` and the run ends with `run.failed`. Any agent's LLM failure is surfaced the same way. Cancellation emits `run.failed` too.
- **Events.** Each `ExecutionEvent` has `id`, `run_id`, `seq` (contiguous per run), UTC `timestamp`, `type`, `agent_id`, `task_id`, and `payload`. Events are written to PostgreSQL (`mission_events`) and to `data/events/<run_id>.jsonl` as they happen. If a database write fails, it is logged, the JSONL copy is kept, and the run continues. Reports are stored in `missions.report_markdown` and in `data/reports/<run_id>.md`.
- **Persistence (PostgreSQL, SQLAlchemy 2 async + psycopg 3, Alembic).** Tables: `workspaces`, `missions` (status, scope, plan, report, counts), `mission_events`, `documents` (metadata, SHA-256, storage key, status, embedding model/dimension, chunk settings), `document_chunks` (text, page, section), and `mission_evidence` (every S#/D# source with the passage snapshot and its citation number). Every row that belongs to a user carries `workspace_id`, and every query filters by it. The workspace comes from one dependency (`api/deps.py`), so authentication can replace it later without changes elsewhere. On startup, missions still marked `running` become `interrupted`.
- **Knowledge Library pipeline.** Upload → validate (extension *and* content: `%PDF-` magic, no NUL bytes in text, size limit, page limit) → store the original (`FileStorage`) → `pending` row → background ingestion: parse → clean → chunk → embed + upsert to Qdrant → chunks + `ready` in PostgreSQL. Parsing and embedding run in worker threads behind an `asyncio.Semaphore`, so the API event loop never blocks. Every error path ends in `failed` with a readable reason: empty file, malformed or encrypted PDF, scanned PDF with no text layer (no OCR yet), or a Qdrant write error. Partial vectors are removed. Duplicates are detected by SHA-256 per workspace (`409`). Deleting a document removes its vectors first (if Qdrant is down, nothing is deleted), then its rows and file. It also clears the passage text stored in mission evidence; the citation metadata remains.
- **Embeddings.** `SentenceTransformerEmbeddings` implements LangChain's `Embeddings` plus `model_id` and `dimension`. The same instance embeds documents and queries. A hosted provider only needs the same small interface.
- **Changing the embedding model.** The Qdrant collection is named `<prefix>__<model-slug>__<dim>`, and each document records the model and dimension it was indexed with. `langchain-qdrant` also refuses a collection whose vector size or distance does not match. After a model change, the new collection starts empty, old documents show **Needs reindex** and are excluded from retrieval, and **Reindex** (or `POST /documents/{id}/reindex`) re-embeds from the stored original. The old vectors are deleted on reindex or delete.
- **Retrieval.** `RetrievalService.search(query, workspace_id, document_ids=None, top_k)` runs dense cosine search through `langchain-qdrant` with a Qdrant payload filter on workspace (and documents). It re-checks the workspace on every hit, applies the similarity floor, and returns `document_id, title, filename, chunk_id, text, page, section, score`. BM25/hybrid search or reranking can be added inside this service.
- **Agents and RAG.** The mission's document scope is resolved on the server: `document_ids: null` means all ready documents, `[]` means web only, and `[ids]` must all be ready and in the workspace (`400` otherwise).
  - *Alex* sees the library only when documents are in scope. He then sets `evidence_source` (`web` / `documents` / `both`) per subtask, with rules that prioritize documents when the user asks about them. Without documents, his prompt is unchanged and every subtask is forced to `web`.
  - *Milo* calls the `search_documents` LangChain `StructuredTool` (invoked with a tool call; `content_and_artifact`). Its workspace and document IDs are bound when the mission starts, so the model can set only `query` and `top_k`. Web searches and retrievals run concurrently. Passages get stable `D#` IDs (de-duplicated by chunk) next to web `S#` IDs, and are passed to the model inside delimiters marked as untrusted data. When the documents return nothing relevant, Milo records the gap instead of calling the model.
  - *Luna* reviews with rules that keep document and web evidence apart, flag contradictions, and route follow-ups (`follow_up_target`) to documents, the web, or both. The revision limit is unchanged. The renderer turns `[D#]` into links to the in-app passage and lists uploaded documents with file name, page or section, and passage/chunk ID. Uncited or unknown IDs are still dropped or marked "Not verified".
- **New events.** In run streams: `rag.retrieval_started` / `rag.retrieval_completed` / `rag.retrieval_failed` (agent `milo`). They carry the query, counts, and references (document, chunk, page, section, score), never passage text. Workspace-level, on `GET /documents/events` with `run_id: null`: `document.uploaded`, `document.indexing_started`, `document.indexing_completed`, `document.indexing_failed`, `document.deleted`. Passage text is fetched on demand from the API.
- **API**

  | Method | Path | Purpose |
  |---|---|---|
  | `GET` | `/health` | model, provider, whether a key is configured, active run |
  | `POST` | `/runs` | `{question, mode: "live"\|"demo", document_ids?: null\|[]\|[ids]}` → `202` immediately. `409` if a run is active, `503` if the key is missing, `400` for an invalid document scope |
  | `GET` | `/runs` | mission history for the workspace (newest first) |
  | `GET` | `/runs/{id}` | status + summary (from memory, or from PostgreSQL after a restart) |
  | `GET` | `/runs/{id}/events` | **SSE** stream. Replays from `?after=<seq>` or the `Last-Event-ID` header, sends heartbeats every 10s, ends with `event: end` |
  | `GET` | `/runs/{id}/events.json` | same events as JSON (debugging) |
  | `GET` | `/runs/{id}/report` | report JSON (`?format=markdown` for raw `.md`). `425` while running |
  | `GET` | `/runs/{id}/evidence` | every source the mission gathered (S# web, D# passages with text), cited flags and numbers |
  | `POST` | `/runs/{id}/cancel` | cancel the active run |
  | `POST` | `/documents` | multipart upload → `202` (`pending`). `413` too large, `415` unsupported type, `422` empty, `409` duplicate, `429` queue full, `503` library unavailable |
  | `GET` | `/documents` | documents + knowledge-base status (model, dimension, collection) |
  | `GET` | `/documents/{id}` | metadata and indexing status |
  | `GET` | `/documents/{id}/chunks/{chunk_id}` | one passage (text, page, section) |
  | `GET` | `/documents/{id}/file` | original file (`nosniff`, `CSP: sandbox`) |
  | `POST` | `/documents/{id}/reindex` | re-embed (e.g. after a model change) |
  | `DELETE` | `/documents/{id}` | delete vectors, rows, and file |
  | `GET` | `/documents/events` | **SSE** of `document.*` events |

- **Execution.** `POST /runs` creates an `asyncio` task and returns at once, so the workflow never blocks the request. The `RunManager` tracks run lifecycle (`running → completed | failed | cancelled`, plus `interrupted` after a restart), enforces one active run, and cancels running tasks on shutdown. SSE for a run that finished before the current process started replays its events from PostgreSQL (also with `?after=`).

### Frontend

- **Backend truth vs. visuals.** `runStore` holds the result of a pure reducer (`applyEvent`) over the event log: agents, statuses, tasks, mission, findings, tool calls, and feed. It ignores duplicates by `seq`. `visualStore` and the per-agent `runtime` hold only the animation state: position, rotation, queued actions, bubbles, flying cards.
- **Report viewer.** `services/reportParse.ts` splits the rendered Markdown into title, request, answer (with assumptions and questions), sections and footer; older reports (with *Summary*) still parse, and unknown layouts fall back to plain rendering. The answer sits in a card at the top in larger type. Main sections follow in one 68ch column; *Evidence*, *Limitations* and *More detail* are collapsed rows with item counts, followed by the collapsible **Sources** list. Tables scroll sideways on phones, plan tasks are checkboxes, and an explanation's flow diagram (a ```` ```mermaid ```` flowchart in the Markdown) is drawn natively as numbered steps, with no diagram library. Citations render as small chips; adjacent citations merge into one chip ("1, 2") in the viewer only. A web citation opens Sources with those entries expanded (type, domain, search query, link); a document citation opens the passage. The **Markdown** download is the unmodified report, with every citation link and the full source list.
- **Knowledge Library UI.** `libraryStore` holds the document list (the server is the source of truth: every `document.*` event triggers a re-fetch) and the per-viewer mission scope (`localStorage`). The library panel shares the right-hand column with the inspector and mission board, and only one is open at a time. The evidence viewer fetches passage text from the API on demand.
- **UI.** One type scale (11 / 12.5 / 13.5 / 15 px), weights 400–600, Figtree plus JetBrains Mono for technical details, color tokens in `index.css`, and Lucide icons (no emoji). The activity feed is a collapsible timeline. `describeEvent` writes plain one-sentence messages, and `groupFeed` folds consecutive parallel searches and batch assignments into one expandable row. Every row keeps the raw event (type, seq, task ID, JSON) behind a disclosure. Agent status uses one vocabulary everywhere (Idle, Waiting, Working, Completed, Failed) and one dot per agent in the scene. Scene labels show only the name until you hover or select the agent. The connection indicator shows **Run finished** or **Run ended** when the server closes the stream normally. Only a real failure shows **Connection lost**.
- **Event → animation.** `useVisualDirector` maps each new event to queued visual actions. Agents walk the waypoint graph to the right spot, play a pose, and side effects such as the hand-off card or the report reveal fire when the pose actually starts. The queue never blocks the backend. If an agent falls behind (for example in fast demo runs), filler poses are dropped and consecutive moves are merged; the agent still walks the path, so nobody teleports. Bubbles and monitors show the current backend state immediately.

  | Event | In the office |
  |---|---|
  | `run.started` | Team stops what it's doing, huddles at the meeting table (Alex announces the mission), then everyone goes to their desk |
  | `agent.started` | Character works at their desk: Alex thinks, then types; Milo types; Luna reads a clipboard |
  | `agent.completed` (plan) | Alex walks to the task board; notes appear from the real plan |
  | `task.assigned` | Sender walks over, talks, and paper cards fly to the assignee (one per task) |
  | `tool.started` | Milo types faster; monitors switch to search mode; bubble shows the query |
  | `tool.completed` / `tool.failed` | "N sources" / "Search failed" chip floats up |
  | `rag.retrieval_started` | Milo's monitors switch to search mode; bubble shows "Documents: <query>" |
  | `rag.retrieval_completed` / `_failed` | "N passages" / "No passages" / "Document search failed" chip floats up |
  | `review.requested` | Luna walks to Milo and hands back a red card |
  | `agent.failed` | Error pose, red status dot, error bubble |
  | `report.generated` | Report document appears on the meeting table (clickable) |
  | `run.completed` | Everyone gathers to celebrate (confetti), then they drift off to idle spots |

- **Reconnects.** The SSE client reopens with `?after=<last seq>` on error, with backoff. A watchdog also reopens the stream if nothing, not even a heartbeat, arrives for 25s, which catches proxies that silently keep a dead upstream open. The active run ID is kept in `localStorage`, so a page reload re-attaches and replays history without re-animating the past.
- **Character bodies** (`components/agents/body.ts`) are one continuous skinned mesh per character. Torso, arms, hands, legs and shoes are a single smooth surface that bends at the joints (three.js `SkinnedMesh`; the rig's joints are bones), instead of separate shapes placed against each other. The shape is a signed distance field of rounded cones and ellipsoids joined with a smooth union (blended at the shoulders and hips only, so arms and legs don't web together), meshed once at load with surface nets (~0.2 s, ~23k triangles, shared by all three characters) with normals from the field. Clothing colours are painted along smooth waist, collar, cuff and shoe lines in the shader, so edges are clean. Joint positions are unchanged, so every pose, seat and click area lines up as before. Heads, faces, hair and clothing details are separate as before.
- **Between missions** idle agents wander (`stores/wander.ts`). Each stays 30–60 s at a spot, then strolls to a free one: a sofa seat (sitting or reading), the bookshelf (reading), the coffee counter, the back window, the task board (thinking) or the lounge coffee table. It stays calm:
  - one stroller at a time, at least 8 s between departures, at a slower pace (1.1 m/s vs 1.7 m/s);
  - no new strolls while the report or a document passage is open;
  - spots are reserved before leaving, and an agent never goes straight back to the spot it just left.

  They start at the board (Alex), the shelf (Milo) and the sofa (Luna). A mission start stops everyone at once: a stroller turns toward the meeting table from where it is. After the celebration they leave the table one by one, a few seconds apart. An agent that errored stays at their desk until the next mission. On reload they're at their desks mid-mission and at their start spots otherwise. `?wander=fast` (dev) shortens stays to 3–5 s for testing.
- **Walkers don't overlap.** A walking agent that comes within 0.6 m of another, or will within half a metre, eases up to 0.45 m sideways and back. Only the rendered position moves; the waypoint path, timing and event queue do not. Milo has a second visitor spot, so Alex and Luna never stand in the same place, and a walkway in front of the desks keeps routes off occupied spots.
- **Dev tool.** `/?perf=1` exposes `window.__agentosPerf`: draw calls, triangles, geometries, programs and agent positions. These come from three.js's own counters and add no draw calls.
- **Rendering budget.** Low-poly procedural geometry and shared materials. The bookshelf and confetti are instanced. There are no real-time shadow maps (soft blob shadows instead), and textures (wood floor, task board) are generated at runtime, so there are no asset downloads. `AdaptiveDpr` is on.

---

## Verified

Run locally on 2026-11-06 (macOS, Docker 29.9, the Compose services above).

**Reports and walker spacing (2026-11-06):**

- *Reports.*
  - `tests/test_reports.py`: comparison, study-plan and research layouts; plans and assumptions; duplicate citations collapsing while every distinct citation stays; source-type labels.
  - `reportParse.test.ts`: summary, preface, body and footer splitting, plus the fallback for older reports.
  - Live runs (test budget: 1 revision, 3 initial searches):
    - *Study plan* with no role or company given: stated its assumptions and 2 questions, 7 phases with concrete tasks, 6 sources cited.
    - *Comparison* (PostgreSQL vs MongoDB): recommendation, 7-row trade-off table, details, evidence, 19 sources.
    - *Research* (Python 3.13 free-threading): 9 findings, 11 sources (5 official docs). It concluded "experimental, not production-ready".
  - In the browser:
    - The summary card is on top for all three and for an older report.
    - Citation chips open and expand the right source.
    - The Markdown export has the same distinct citations and sources as the viewer: 6, 19 and 11.
    - No horizontal scroll at 390 px.
- *Walker spacing.* The minimum distance between agents over a demo run went from 0 m (walking through each other in ~16% of frames) to 0.29–0.54 m across 4 runs.

**Automated:**

- **Backend `pytest`: 56 passed, 0 skipped** (47 from the RAG iteration + 9 report tests).
  - The original 15 tests still pass.
  - Parsing: PDF pages, title, and skipped pages without a text layer. Scanned, malformed, and over-limit PDFs. Markdown heading paths and code fences. Text encodings. Type and binary checks. Filename sanitizing.
  - Chunking: limits, overlap, and page/section kept per chunk.
  - Ingestion and indexing: statuses, chunks in the DB and in Qdrant, and library events that carry no passage text.
  - Retrieval: page numbers end to end, document filters, workspace isolation, and a LangChain tool that is bound to its scope.
  - Deletion: vectors, rows, and file are removed, and evidence text is cleared.
  - Errors: duplicates; failures for scanned PDFs, malformed PDFs, and vector-write errors; recovery of interrupted ingestion.
  - Embedding models: collections for different models stay separate, a dimension mismatch is refused, and a model change leads to reindexing.
  - Workflow: document-only research with D# citations and file/section in the report; web-only missions unchanged (same Alex prompt, no `rag.*` events, original Sources list); Luna sending Milo back to the documents; a failed retrieval while web research continues; a "no relevant passages" gap without a model call.
  - HTTP API: upload/list/get/chunk/file headers/reindex/delete; error codes (413/415/422/409); library events and resume; mission scope validation (400/503); evidence; workspace isolation on every route; history, events, report, and evidence surviving an app restart; `interrupted` marking.
  - Real services (`test_integration_services.py`): `alembic upgrade head` → `downgrade base` → `upgrade head` on a fresh `agentos_test` PostgreSQL database (JSONB checked), a persistence round trip, and real MiniLM embeddings with Docker Qdrant retrieving a paraphrased Aurora question.
- **Frontend:** `tsc -b` passes, `vitest` 16/16, `vite build` succeeds.

**End to end (real stack, live Claude, headless Chromium), total API cost well under $1:**

- **Test A (RAG).** A 3-page PDF with the fictional fact *"Project Aurora supports a maximum batch size of 137 records"* on page 2, plus an unrelated Markdown file, were uploaded through the UI.
  - Both reached *Ready*: 3 + 2 chunks, 5 points in Qdrant.
  - With only the PDF selected, Alex planned 2 document subtasks and Milo ran 4 document searches (bubble and feed shown live). The top passage was page 2, similarity 0.85.
  - Luna's report states 137 records and AUR-413, and cites "aurora-spec.pdf, p. 2". The in-report citation and the inspector passage both open the correct passage.
  - The mission finished in 25 s.
- **Test B (web only).** A live web mission with **Web only** scope worked as before:
  - 3 subtasks, 7 web searches, one review revision, 46 sources, and a report with 12 citations in the original numbered format.
  - No `rag.*` events and no console errors.
  - Office animations, bubbles, and popups played.
- **Test C (persistence).** The backend was stopped and both containers restarted (`docker compose restart`, volumes kept), then the backend was started again.
  - Documents, metadata, both missions, reports, evidence counts, and event counts were identical before and after, compared field by field. All 5 vectors were still present.
  - A paraphrased retrieval found page 2 (0.76).
  - In the browser, *History* reopened the RAG mission: 15 feed rows replayed from PostgreSQL, and the report citation opened its passage.
- **Test D (frontend).** Covered by the type check, tests, and build above.
  - Seen working in the UI: upload, status transitions, metadata, selection and scope chip, inspector passages, the evidence viewer, the mission-board evidence list, and history.
  - All panels stay inside the viewport at 1440×900, 768×1024 and 390×844.

## Not verified / limitations

- **Execution is not durable.** Missions run in the API process. A restart interrupts in-flight missions (marked `interrupted`; events so far are kept). In-progress ingestion is re-queued on the next start. There is no job queue; use a single uvicorn worker. Only one mission runs at a time ("one office"); others get `409`.
- **No authentication or authorization.** There is one local workspace. The workspace column and filtering exist, but nothing identifies users yet.
- **Retrieval is dense-only** (MiniLM, 384 dimensions, English-oriented): no BM25/hybrid search, no reranking. Similarity scores rank passages; they are not probabilities. The score floor (0.2) is a heuristic.
- **Parsing.** No OCR (scanned PDFs fail with a clear message). PDF text order follows pypdf and can be imperfect for multi-column layouts or tables. Setext Markdown headings (`===`) are not detected. Very large documents are embedded in one background step; progress is not reported per chunk.
- **Library events are in memory** (a replay buffer only). The documents table is the source of truth, and the UI re-fetches on reconnect.
- **Upload size** is checked from `Content-Length` and after reading. The multipart parser may still spool a large body to a temporary file before the check.
- **Live Claude runs were tested a few times**, not at volume. Search quality depends on the web and on the uploaded documents.
- **Characters are procedural**, not rigged glTF models, and no third-party assets are used, so there are no licenses to track. Paths are a predefined waypoint graph. The sidestep prevents walking through other agents but is not full local avoidance: passing agents can still come within ~0.3 m (shoulder to shoulder). It doesn't account for furniture, so a sidestep near a desk can briefly graze it.
- **Reports.** Task-type detection and selective citation are prompt rules; the model can still over-cite or pick a weaker source. The source-type label is a URL heuristic (e.g. a company's careers blog counts as blog/forum). Web search results usually carry no text excerpt, so a web source's detail is its link and query. Clarifying questions are shown, not asked interactively.
- **Out of scope for now:** MCP, hybrid search and reranking, OCR, persistent agent memory, hiring agents, and a layout editor.

**This is not production-ready.** Before any public deployment:

- **Authentication and authorization.** Derive the workspace from the authenticated user in `api/deps.py`, never from client input, and check document and mission ownership.
- **Rate limiting and quotas** per user: missions (Claude and web-search spend), uploads, and storage.
- **Durable background jobs** for missions and ingestion (a queue plus workers), with retries and idempotency.
- **Secure file handling.** Object storage (S3-compatible `FileStorage`) with private buckets, malware scanning, strict content types, download limits, and serving untrusted files from a separate origin.
- **Prompt-injection hardening** for uploaded and web content beyond delimiters and instructions. Uploaded documents are untrusted input to the model.
- **Backups and retention** for PostgreSQL and Qdrant, data deletion on account removal, and audit logging.
- **Monitoring:** structured logs, metrics, tracing, alerting, and error reporting.
- **TLS, a CORS allowlist, secret management, dependency and image updates, and connection pooling** for managed PostgreSQL.

## Path to deployment

The pieces that change in production are each behind one setting or one interface:

| Today (local) | Later (hosted) | Where it changes |
|---|---|---|
| Vite dev server | Static hosting (`npm run build`, set `VITE_API_BASE`) | build config only |
| `uvicorn` on the host | Containerized FastAPI (single worker until jobs are durable) | a Dockerfile; no code changes |
| Compose PostgreSQL | Managed PostgreSQL | `AGENTOS_DATABASE_URL` + `alembic upgrade head` |
| Compose Qdrant | Managed Qdrant | `AGENTOS_QDRANT_URL`, `AGENTOS_QDRANT_API_KEY` |
| `LocalFileStorage` | S3-compatible object storage | a new `FileStorage` class (`put/get/delete/exists`) |
| Local MiniLM | Local, or a hosted embedding API | an `Embedder` implementation; reindex documents |
| One configured workspace | Authenticated workspaces | `api/deps.py` (all queries are already workspace-scoped) |
| In-process tasks | Job queue + workers | `RunManager._execute`, `DocumentService.schedule` |

Retrieval policy (`rag/retrieval.py`) is separate from Qdrant connection code (`rag/vector_store.py`) and from the agent tool (`rag/tools.py`), so the same service can be exposed through MCP later without rewriting it. Secrets stay server-side, and the browser only talks to the FastAPI API.
