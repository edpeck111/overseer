# ADR-0011: KNOWLEDGE backend — vector store, embeddings, voice stack

**Status:** Accepted (Sprint 5)
**Deciders:** Ted (delegated; standing autonomous mandate); recorded by Sprint 5 author

## Context

Sprint 5 (KNOWLEDGE refresh) needs:

  1. A vector store on top of SQLite for embeddings + hybrid retrieval.
  2. An embedding model.
  3. A streaming LLM wrapper around Ollama.
  4. Whisper.cpp integration for voice input.
  5. Piper TTS for voice output.

Per the standing autonomous mandate (synthetic over real hardware,
clean swap interfaces, ADR for non-obvious decisions), Sprint 5 ships
**synthetic backends behind clean interfaces** for all five. Real
model integration lands when Ted has an OPi5 to test against.

## Decision

### 1. Vector store: `sqlite-vec` (not `sqlite-vss`)

Spec calls for sqlite-vss; sqlite-vec is the actively-maintained
successor (2024+) by the same author (Alex Garcia). Drop-in API for
the operations we need. Spec is wrong only because it predates
sqlite-vec's release; otherwise the design is identical.

Schema (server/db.py DDL, applied lazily by the future migrations
runner):

```sql
CREATE TABLE archive_chunk (
  id INTEGER PRIMARY KEY,
  archive TEXT,
  article_title TEXT,
  paragraph_idx INTEGER,
  text TEXT
);
CREATE VIRTUAL TABLE archive_fts USING fts5(article_title, text, content=archive_chunk);
CREATE VIRTUAL TABLE archive_vec USING vec0(embedding float[384]);  -- 384-d, INT8 quant
```

Sprint 5 ships these as DDL + a `SyntheticIndex` Python class that
returns curated canned results for a small fixture corpus (no real
sqlite-vec yet). The real index swaps in by setting
`OVERSEER_KB_INDEX=sqlite-vec` once the OPi5 has the extension built.

### 2. Embedding model: `nomic-embed-text-v1.5` (target), synthetic for Sprint 5

384-dim, INT8-quantisable, MIT-licensed, ~140 MB on disk after
quantisation. Runs comfortably on the OPi5 RK3588 NPU. Sprint 5 ships
a synthetic embedder that hashes input strings to a deterministic
384-dim vector (good enough for testing the retrieval plumbing).

Swap interface:

```python
class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...      # length 384

OVERSEER_KB_EMBEDDER  =  "synthetic"  |  "nomic"
```

### 3. LLM: Ollama wrapper around `qwen2.5:7b-instruct-q4_K_M`

Already in legacy_server.py. Sprint 5 wraps it in `server/llm/ollama.py`
with a streaming interface. **Synthetic mode for Sprint 5**: returns
canned, citation-bearing answers from a tiny lookup table keyed by
keywords ("rainwater", "tourniquet", "fortify"...). Real Ollama mode
is one env-flag away: `OVERSEER_LLM=ollama`.

### 4. Voice input: whisper.cpp tiny model, synthetic for Sprint 5

`server/llm/whisper.py` exposes a `transcribe(wav_bytes) -> str` API.
Synthetic mode returns the literal string `"[voice synth: not
transcribing]"` so UI flows are testable. Real mode requires the
whisper.cpp tiny.en model on disk (~40 MB) and shells out to the
binary; not built in Sprint 5.

### 5. Voice output: piper TTS, synthetic for Sprint 5

`server/llm/piper.py` exposes a `synthesize(text) -> wav_bytes` API.
Synthetic mode returns a 0-byte placeholder. Real mode requires the
piper binary + a voice model. Stubbed for Sprint 5.

## Why synthetic-first

Per the standing autonomous mandate. The retrieval plumbing, OMP
opcodes, store wiring, UI polish, and slash-command surface are the
hard parts of KNOWLEDGE — and they're identical whether the backend
is a 7B parameter model or a hand-tuned echo function. Synthetic
backends let Sprint 5 ship a real-feeling KNOWLEDGE module with
streaming citations and branch trees, without waiting on Ted's
hardware to provision real models. Each backend swap-in is a
single-file change.

## Consequences

  - Sprint 5's `/api/k/query` returns deterministic citations from a
    small fixture set. The shell UI flows are testable via the smoke
    harness without any model on disk.
  - Branches tree (gate requirement) is fully real — the backing
    `chat_session.parent_id` schema and the tree-building code are
    Sprint-5-final, not synthetic. Only the *content* of the LLM
    responses is synthetic.
  - When Ted swaps in real backends (one env flag each), the entire
    KNOWLEDGE UI keeps working unchanged. The gate's "ask a question,
    get a streamed answer" works in Sprint 5 with synthetic answers
    and continues to work in Sprint 5.5 / 6 with real ones.

## Revisit triggers

  - Ted has an OPi5 with model weights on disk → flip env flags, run
    smoke against the real backend.
  - Embedding dimension changes from 384 → swap requires DDL + dict
    rebuild. Schema bump.
  - sqlite-vec major version → re-test the vec0 DDL syntax.
