'use strict';

/**
 * semanticStore.js — ChromaDB + local embedding layer
 *
 * Uses:
 *   - chromadb      : Official JS client to talk to the local Docker ChromaDB server
 *   - @xenova/transformers : Runs Xenova/all-MiniLM-L6-v2 entirely in Node.js
 *                           (~23 MB, downloaded once on first run, no API key needed)
 *
 * Every piece of text stored here is embedded into a 384-dimensional vector.
 * Retrieval is by cosine similarity — "find memories that MEAN something similar
 * to this query" even if the words are different.
 */

require('dotenv').config();

const { ChromaClient } = require('chromadb');

// ─────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────

const CHROMA_URL        = process.env.CHROMA_URL        || 'http://localhost:8000';
const COLLECTION_NAME   = process.env.CHROMA_COLLECTION || 'openclaw_memories';
const SEMANTIC_TOP_K    = parseInt(process.env.SEMANTIC_TOP_K || '5', 10);
const EMBEDDING_MODEL   = process.env.EMBEDDING_MODEL   || 'Xenova/all-MiniLM-L6-v2';

// ─────────────────────────────────────────────────────────────────
// Singleton: embedding pipeline + Chroma collection
// ─────────────────────────────────────────────────────────────────

let _pipeline   = null;   // Xenova pipeline (lazy-loaded)
let _collection = null;   // ChromaDB collection (lazy-loaded)
let _client     = null;   // ChromaDB client

/**
 * Lazy-load the Xenova feature-extraction pipeline.
 * On first call this downloads the model (~23 MB) and caches it locally.
 * Subsequent calls are instant (singleton).
 * @returns {Promise<Function>}
 */
async function getPipeline() {
  if (_pipeline) return _pipeline;

  console.log(`🧠 [Embeddings] Loading model: ${EMBEDDING_MODEL} (first run may take ~30 s)`);

  // Dynamic import — @xenova/transformers is ESM-only export
  const { pipeline } = await import('@xenova/transformers');
  _pipeline = await pipeline('feature-extraction', EMBEDDING_MODEL);

  console.log(`✅ [Embeddings] Model ready`);
  return _pipeline;
}

/**
 * Lazy-connect to ChromaDB and get (or create) the openclaw_memories collection.
 * @returns {Promise<object>} ChromaDB collection handle
 */
async function getCollection() {
  if (_collection) return _collection;

  _client     = new ChromaClient({ path: CHROMA_URL });

  // Heartbeat check — gives a clear error if Docker isn't running
  try {
    await _client.heartbeat();
  } catch (err) {
    throw new Error(
      `Cannot reach ChromaDB at ${CHROMA_URL}.\n` +
      `Make sure Docker is running and the container is up:\n` +
      `  cd "Cogntive Memory Substrate"\n` +
      `  docker-compose up -d\n` +
      `Original error: ${err.message}`
    );
  }

  _collection = await _client.getOrCreateCollection({
    name:     COLLECTION_NAME,
    metadata: { 'hnsw:space': 'cosine' },
  });

  const count = await _collection.count();
  console.log(`📚 [ChromaDB]   Collection "${COLLECTION_NAME}" ready (${count} vectors)`);
  return _collection;
}

// ─────────────────────────────────────────────────────────────────
// Core helper — generate embedding
// ─────────────────────────────────────────────────────────────────

/**
 * Convert a text string into a flat float32 embedding vector.
 * Uses mean-pooling over the token embeddings (standard for sentence transformers).
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const pipe   = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // output.data is a Float32Array — convert to plain JS array for Chroma
  return Array.from(output.data);
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Add (or update) a memory in the semantic store.
 *
 * @param {string}  id        - UUID (should match the exactStore fact ID)
 * @param {string}  text      - The text content to embed
 * @param {object}  [meta={}] - Additional metadata stored alongside the vector
 *                             (key, category, timestamp, etc.)
 * @returns {Promise<void>}
 */
async function addMemory(id, text, meta = {}) {
  const collection = await getCollection();
  const embedding  = await embed(text);

  await collection.upsert({
    ids:        [id],
    embeddings: [embedding],
    documents:  [text],
    metadatas:  [{ ...meta, stored_at: new Date().toISOString() }],
  });
}

/**
 * Search for memories semantically similar to a query string.
 *
 * @param {string}  query        - Natural language query
 * @param {number}  [topK]       - Number of results to return (default: SEMANTIC_TOP_K)
 * @param {object}  [where=null] - Optional ChromaDB metadata filter
 * @returns {Promise<Array<{id, text, metadata, distance, score}>>}
 */
async function searchMemory(query, topK = SEMANTIC_TOP_K, where = null) {
  const collection = await getCollection();
  const count      = await collection.count();
  if (count === 0) return [];

  const queryEmbedding = await embed(query);

  const queryParams = {
    queryEmbeddings: [queryEmbedding],
    nResults:        Math.min(topK, count),
    include:         ['documents', 'metadatas', 'distances'],
  };
  if (where) queryParams.where = where;

  const results = await collection.query(queryParams);

  // Flatten + normalise the nested result arrays Chroma returns
  const ids       = results.ids[0]        || [];
  const docs      = results.documents[0]  || [];
  const metas     = results.metadatas[0]  || [];
  const distances = results.distances[0]  || [];

  return ids.map((id, i) => ({
    id,
    text:     docs[i],
    metadata: metas[i],
    distance: distances[i],
    // Convert cosine distance [0,2] → similarity score [0,1]
    score: parseFloat((1 - distances[i] / 2).toFixed(4)),
  }));
}

/**
 * Delete a single memory by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteMemory(id) {
  const collection = await getCollection();
  await collection.delete({ ids: [id] });
}

/**
 * Return how many vectors are stored in the collection.
 * @returns {Promise<number>}
 */
async function getCount() {
  const collection = await getCollection();
  return collection.count();
}

/**
 * Wipe the entire collection (nuclear option — useful for testing).
 * @returns {Promise<void>}
 */
async function resetCollection() {
  if (_client) {
    await _client.deleteCollection(COLLECTION_NAME);
    _collection = null;
    await getCollection();  // recreate fresh
  }
}

module.exports = {
  addMemory,
  searchMemory,
  deleteMemory,
  getCount,
  resetCollection,
};
