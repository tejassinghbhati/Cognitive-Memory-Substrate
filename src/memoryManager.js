'use strict';

/**
 * memoryManager.js — Unified facade for the dual-layer memory system
 *
 * Orchestrates both stores:
 *   • exactStore   (SQLite)   — structured, reliable, instant key lookups
 *   • semanticStore (ChromaDB) — fuzzy meaning-based similarity search
 *
 * This is the single import the Agent and tool files need.
 *
 * Core operations:
 *   remember(key, value, opts)      — write to both stores simultaneously
 *   recall(query)                   — query both, merge + rank results
 *   forget(key)                     — delete from both stores
 *   injectContext(userMessage)      — build a context block for system prompt injection
 *   logConversation(...)            — persist turn to SQLite episodic log
 */

require('dotenv').config();

const exact    = require('./exactStore');
const semantic = require('./semanticStore');

const RECENT_TURNS_LIMIT = parseInt(process.env.RECENT_TURNS_LIMIT || '10', 10);
const SEMANTIC_TOP_K     = parseInt(process.env.SEMANTIC_TOP_K     || '5',  10);

// Relevance threshold — semantic results below this score are filtered out
const MIN_SEMANTIC_SCORE = 0.35;

// ─────────────────────────────────────────────────────────────────
// Core write: remember
// ─────────────────────────────────────────────────────────────────

/**
 * Persist a fact to BOTH the exact store (SQLite) and the semantic store (ChromaDB).
 *
 * @param {string} key        - Short identifier, e.g. "user.name" or "preference.language"
 * @param {string} value      - The fact value, e.g. "Tejas Singh Bhati"
 * @param {object} [opts={}]
 * @param {string} [opts.category='general']  - Group label for filtering
 * @param {number} [opts.confidence=1.0]      - How certain we are (0–1)
 * @param {string} [opts.sessionId]           - Current session UUID (optional)
 * @returns {Promise<string>} The fact UUID
 */
async function remember(key, value, opts = {}) {
  const { category = 'general', confidence = 1.0, sessionId = null } = opts;

  // 1. Exact store — synchronous upsert
  const id = exact.saveFact(key, value, { category, confidence, sessionId });

  // 2. Semantic store — build a natural-language sentence to embed
  //    "user.name = Tejas Singh Bhati [category:personal]"
  const text = `${key} = ${value} [category:${category}]`;

  try {
    await semantic.addMemory(id, text, {
      key,
      category,
      confidence: String(confidence),
      session_id: sessionId || '',
    });
  } catch (err) {
    // Semantic store failure is non-fatal — exact store already succeeded
    console.warn(`⚠️  [MemoryManager] Semantic write failed for "${key}": ${err.message}`);
    console.warn(`   (Exact store write succeeded — memory is safe)`);
  }

  return id;
}

// ─────────────────────────────────────────────────────────────────
// Core read: recall
// ─────────────────────────────────────────────────────────────────

/**
 * Recall memories relevant to a query by combining:
 *   1. Semantic search (ChromaDB) — meaning-based top-K results
 *   2. Exact keyword search (SQLite) — substring matches on key/value
 *
 * Results are merged, deduplicated by ID, and sorted by score (semantic first).
 *
 * @param {string} query
 * @param {object} [opts={}]
 * @param {number} [opts.topK=5]
 * @param {string} [opts.category]  - Optional category filter
 * @returns {Promise<Array<{id, key, value, category, score, source}>>}
 */
async function recall(query, opts = {}) {
  const { topK = SEMANTIC_TOP_K, category } = opts;

  const seen    = new Map();  // id → result (for deduplication)
  const results = [];

  // ── Layer 1: Semantic search ──────────────────────────────────
  try {
    const where  = category ? { category } : null;
    const semRes = await semantic.searchMemory(query, topK, where);

    for (const hit of semRes) {
      if (hit.score < MIN_SEMANTIC_SCORE) continue;

      // Pull the full structured record from SQLite for rich data
      const sqlRow = exact.getFact(hit.metadata.key || '');
      const entry  = {
        id:       hit.id,
        key:      hit.metadata.key      || hit.text,
        value:    sqlRow ? sqlRow.value : hit.text,
        category: hit.metadata.category || 'general',
        score:    hit.score,
        source:   'semantic',
      };
      seen.set(hit.id, entry);
      results.push(entry);
    }
  } catch (err) {
    // ChromaDB might not be running — fall back gracefully
    console.warn(`⚠️  [MemoryManager] Semantic recall unavailable: ${err.message}`);
  }

  // ── Layer 2: Exact keyword search ────────────────────────────
  const sqlRows = exact.searchFacts(query, topK);
  for (const row of sqlRows) {
    if (seen.has(row.id)) continue; // already from semantic
    results.push({
      id:       row.id,
      key:      row.key,
      value:    row.value,
      category: row.category,
      score:    row.confidence * 0.8,  // slightly lower than semantic hits
      source:   'exact',
    });
    seen.set(row.id, true);
  }

  // Sort by descending relevance score
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ─────────────────────────────────────────────────────────────────
// Core delete: forget
// ─────────────────────────────────────────────────────────────────

/**
 * Forget a memory completely — removes from both SQLite and ChromaDB.
 *
 * @param {string} key - The fact key to delete
 * @returns {Promise<boolean>} true if the fact existed and was deleted
 */
async function forget(key) {
  // Look up the fact to get its UUID (needed for Chroma deletion)
  const row = exact.getFact(key);

  // Delete from exact store
  const deleted = exact.deleteFact(key);

  // Delete from semantic store (use UUID)
  if (row) {
    try {
      await semantic.deleteMemory(row.id);
    } catch (err) {
      console.warn(`⚠️  [MemoryManager] Semantic delete failed for "${key}": ${err.message}`);
    }
  }

  return deleted;
}

// ─────────────────────────────────────────────────────────────────
// Context injection — prepend memories to system prompt
// ─────────────────────────────────────────────────────────────────

/**
 * Build a compact context block from memories relevant to the user's message.
 * This is injected into the agent's system prompt before each Claude call
 * so the LLM has automatic, long-term memory of the user.
 *
 * @param {string} userMessage
 * @param {string} [sessionId]
 * @returns {Promise<string>} A formatted context block, or '' if no memories
 */
async function injectContext(userMessage, sessionId = null) {
  const lines = [];

  // ── 1. Relevant semantic + exact memories ─────────────────────
  try {
    const hits = await recall(userMessage, { topK: SEMANTIC_TOP_K });
    if (hits.length > 0) {
      lines.push('=== PERSISTENT MEMORY (what you know about the user) ===');
      for (const h of hits) {
        lines.push(`• [${h.category}] ${h.key}: ${h.value}  (relevance: ${h.score})`);
      }
      lines.push('');
    }
  } catch (_) { /* graceful no-op */ }

  // ── 2. All user preferences ──────────────────────────────────
  const prefs = exact.getAllPreferences();
  if (prefs.length > 0) {
    lines.push('=== USER PREFERENCES ===');
    for (const p of prefs) {
      lines.push(`• ${p.key}: ${p.value}`);
    }
    lines.push('');
  }

  // ── 3. Recent conversation turns (episodic context) ───────────
  const turns = sessionId
    ? exact.getRecentTurns(sessionId, RECENT_TURNS_LIMIT)
    : exact.getAllRecentTurns(RECENT_TURNS_LIMIT);

  if (turns.length > 0) {
    lines.push('=== RECENT CONVERSATION HISTORY ===');
    for (const t of turns) {
      const label = t.role === 'user' ? 'User' : 'Assistant';
      const snippet = t.content.length > 120 ? t.content.slice(0, 120) + '…' : t.content;
      lines.push(`[${label}]: ${snippet}`);
    }
    lines.push('');
  }

  if (lines.length === 0) return '';

  return (
    '\n' +
    '─────────────────────────────────────────────────────────\n' +
    lines.join('\n') +
    '─────────────────────────────────────────────────────────\n'
  );
}

// ─────────────────────────────────────────────────────────────────
// Episodic logging
// ─────────────────────────────────────────────────────────────────

/**
 * Log a single conversation turn to the SQLite episodic store.
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {string|null} [toolUsed]
 * @returns {string} Turn ID
 */
function logConversation(sessionId, role, content, toolUsed = null) {
  return exact.logTurn(sessionId, role, content, toolUsed);
}

// ─────────────────────────────────────────────────────────────────
// Preference helpers (thin wrappers for agent tools)
// ─────────────────────────────────────────────────────────────────

function setPreference(key, value)  { return exact.setPreference(key, value); }
function getPreference(key)         { return exact.getPreference(key); }
function getAllPreferences()        { return exact.getAllPreferences(); }
function getAllFacts(limit)         { return exact.getAllFacts(limit); }
function findEntities(name)         { return exact.findEntities(name); }
function getEntitiesByType(type)     { return exact.getEntitiesByType(type); }

// ─────────────────────────────────────────────────────────────────
// Stats helper — useful for the demo CLI dashboard
// ─────────────────────────────────────────────────────────────────

/**
 * Return a quick snapshot of what's stored.
 * @returns {Promise<object>}
 */
async function getStats() {
  let vectorCount = 0;
  try {
    vectorCount = await semantic.getCount();
  } catch (_) {}

  const facts       = exact.getAllFacts(1000).length;
  const preferences = exact.getAllPreferences().length;
  const turns       = exact.getAllRecentTurns(10000).length;

  return { facts, preferences, turns, vectors: vectorCount };
}

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  remember,
  recall,
  forget,
  injectContext,
  logConversation,
  setPreference,
  getPreference,
  getAllPreferences,
  getAllFacts,
  findEntities,
  getEntitiesByType,
  getStats,
};
