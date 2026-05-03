# ADR 013: Scout fact memory — RAG over a Postgres + pgvector corpus

## Status

Accepted

## Context

Scout's effectiveness is bottlenecked by domain knowledge that can't be derived from the database: ground quirks ("Mitford have no covers"), league logistics ("Saturday games start at 1pm"), opposition reputations, and personal user preferences ("I hate facing spin"). Without persistence the same insights have to be re-explained every conversation, and the agent repeats the same mistakes.

Two approaches were considered:

1. **System-prompt fact list.** A `fact_record` tool writes facts to a table; every turn loads all facts into the cached system prompt.
2. **RAG with embeddings + reranking.** Facts are stored with vector embeddings; per-turn retrieval pulls the top relevant facts and injects them.

Option 1 is simpler but doesn't scale — at 500+ facts the cached preamble becomes large and noisy, and irrelevant facts crowd context. Option 2 is more complex but bounded: only the top-N relevant facts ever land in context.

## Decision

Implement Option 2. Architecture:

- **Storage.** `scout_fact` table in Postgres + `pgvector` extension. Columns: `id`, `user_id`, `scope ('user'|'club')`, `content`, `tags jsonb`, `embedding vector(1024)`, `confidence`, `superseded_by` (soft-delete via supersession), `source_thread_id`/`source_message_id` (traceability).
- **Indexes.** HNSW (cosine) on `embedding`, GIN on `tags`, GIN on `to_tsvector(content)` for keyword fallback. All partial indexes on `WHERE superseded_by IS NULL`.
- **Embeddings + reranking.** Voyage AI. `voyage-4` for embeddings (1024-dim), `rerank-2.5` for cross-encoder reranking. 200M tokens free shared across both. Hit via thin REST client — no SDK.
- **Write path (`fact_record` tool).** Embed → query nearest live fact (cosine) → if distance < 0.1, insert new and supersede old; else fresh insert.
- **Read path.** Hybrid retrieval: top-30 vector + top-30 FTS + top-30 tag-filter (when tags supplied) → dedup by id → Voyage `rerank-2.5` → top-K (default 8).
- **Trigger.** Auto-retrieve on every user turn using last-2 user messages + current as query (cheap anaphora mitigation). Inject as `<known-facts>` block appended to the last user model-message _after_ convertToModelMessages — keeps the persisted DB row clean and keeps the cache-control breakpoint position correct.
- **Tools.** `fact_record` always; `fact_retrieve` exposed for mid-turn deeper queries.

## Why these choices

**Postgres + pgvector over a dedicated vector store.** We already run RDS Postgres 16 in prod with a generous shared instance. pgvector + HNSW is sub-millisecond on low thousands of rows. Adding a separate vector DB (Pinecone, Weaviate, etc.) would mean another vendor, another secret, another failure mode for no measurable benefit at this scale.

**Voyage over OpenAI embeddings.** Anthropic doesn't have an embeddings API; their docs point at Voyage. The 200M-token free tier is generous (≈200k turns of retrieval), they offer rerankers (OpenAI doesn't), and dimensions match cleanly to a single fixed-width column.

**Reranking with a cross-encoder.** Pure embedding similarity surfaces antonyms ("hates spin" / "loves spin") because the embeddings are nearly identical. A cross-encoder (`rerank-2.5`) attends jointly to the query and each candidate and reorders accurately. Pattern: retrieve wide (~50 candidates) cheaply, rerank narrow (top 8).

**Hybrid retrieval (vector + FTS + tags).** Vector search alone is weak at exact-name lookups (a query containing "Swalwell" doesn't always rank Swalwell facts first). FTS catches them. Tag filters give the agent a cheap way to ask "everything tagged team:Mitford CC" without depending on phrasing.

**Auto-retrieval every turn, not session-start.** Conversation topics pivot; turn 5 may be about a player not mentioned at turn 1. Per-turn retrieval cost is negligible (~1k tokens) and dramatically more accurate than session-start.

**Soft-delete via supersession.** Facts evolve ("Mitford got covers in 2027"). Superseding rather than deleting keeps history queryable without polluting retrieval (`WHERE superseded_by IS NULL`). Replaces what would otherwise be agent-managed updates that are easy to get wrong.

**Voyage optional in config.** Scout works without `VOYAGE_API_KEY` — fact tools and auto-retrieval are simply omitted. Lets local dev and non-Scout deployments boot cleanly without a third-party dependency.

## Rejected alternatives

- **System-prompt-only fact list.** Fine at 50 facts, breaks at 500. Doesn't degrade gracefully.
- **OpenAI embeddings + a separate Pinecone instance.** Adds two vendor relationships, one secret per env, and Pinecone's free tier is more constrained than Voyage's.
- **Embed-only retrieval (no reranker).** Antonym confusion is the killer use case — you cannot ship a cricket-analysis tool that hands back "Smith loves facing spin" when the recorded fact is the opposite.
- **Query rewrite via a Haiku call.** Considered for anaphora ("what about them?") but adds a model hop and latency. Concatenating last-2 user messages is cheaper and good enough; revisit if retrieval quality is visibly bad.

## Consequences

- New required dependency: pgvector extension. Local dev image switched to `pgvector/pgvector:pg16`. Test containers likewise. RDS already supports pgvector as an available extension; no Terraform change needed beyond the migration's `CREATE EXTENSION`.
- Voyage as a third-party vendor. API key stored in AWS Secrets Manager alongside Anthropic. Spend alerts on the free tier even though we're well under 200M tokens.
- Schema is locked to `vector(1024)` — any model change with a different dim requires a follow-up migration.
- Auto-retrieval adds ~1k tokens to each turn's cache-creation cost. The cached preamble (system prompt + tools) still hits cache; only the per-turn user message + facts is fresh.
- Admin UI for fact review is deferred. We'll want it before opening Scout up beyond the current allowlist — bad agent-recorded facts will compound otherwise.
