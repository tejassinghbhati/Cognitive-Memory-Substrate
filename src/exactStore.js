'use strict';

/**
 * exactStore.js — SQLite-backed exact/structured memory layer
 *
 * Schema (4 tables):
 *   facts         — key/value user facts ("My name is Tejas")
 *   entities      — named entity registry (people, projects, places)
 *   conversations — episodic turn log per session
 *   preferences   — simple user preference key/value store
 *
 * Uses better-sqlite3 (same lib as CLI Task Manager) for synchronous,
 * zero-configuration SQLite access.
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────────
// Setup — ensure data directory + database file exist
// ─────────────────────────────────────────────────────────────────

const DB_PATH = process.env.MEMORY_DB_PATH || './data/memory.db';
const dbDir   = path.dirname(path.resolve(DB_PATH));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────────
// Schema initialisation
// ─────────────────────────────────────────────────────────────────

db.exec(`
  -- Long-lived facts ("My name is Tejas", "I prefer TypeScript")
  CREATE TABLE IF NOT EXISTS facts (
    id          TEXT    PRIMARY KEY,
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    category    TEXT    DEFAULT 'general',
    confidence  REAL    DEFAULT 1.0,
    session_id  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Full-text index on key/value for fast substring search
  CREATE INDEX IF NOT EXISTS idx_facts_key      ON facts(key);
  CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);

  -- Named entity registry (people, projects, places, concepts)
  CREATE TABLE IF NOT EXISTS entities (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    attributes  TEXT,                    -- JSON blob
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

  -- Episodic conversation log (per-session turn history)
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT    PRIMARY KEY,
    session_id  TEXT    NOT NULL,
    role        TEXT    NOT NULL,        -- 'user' | 'assistant'
    content     TEXT    NOT NULL,
    tool_used   TEXT,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
  CREATE INDEX IF NOT EXISTS idx_conv_time    ON conversations(timestamp);

  -- User preferences (simple key/value, upsert-friendly)
  CREATE TABLE IF NOT EXISTS preferences (
    key         TEXT    PRIMARY KEY,
    value       TEXT    NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─────────────────────────────────────────────────────────────────
// Prepared statements
// ─────────────────────────────────────────────────────────────────

const stmts = {
  // Facts
  upsertFact: db.prepare(`
    INSERT INTO facts (id, key, value, category, confidence, session_id)
    VALUES (@id, @key, @value, @category, @confidence, @session_id)
    ON CONFLICT(id) DO UPDATE SET
      value      = excluded.value,
      category   = excluded.category,
      confidence = excluded.confidence,
      updated_at = CURRENT_TIMESTAMP
  `),

  getFactByKey: db.prepare(`
    SELECT * FROM facts WHERE key = ? ORDER BY updated_at DESC LIMIT 1
  `),

  searchFacts: db.prepare(`
    SELECT * FROM facts
    WHERE key   LIKE ? OR value LIKE ?
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `),

  getAllFacts: db.prepare(`
    SELECT * FROM facts ORDER BY updated_at DESC LIMIT ?
  `),

  getFactsByCategory: db.prepare(`
    SELECT * FROM facts WHERE category = ? ORDER BY updated_at DESC
  `),

  deleteFact: db.prepare(`DELETE FROM facts WHERE key = ?`),

  deleteFactById: db.prepare(`DELETE FROM facts WHERE id = ?`),

  // Entities
  upsertEntity: db.prepare(`
    INSERT INTO entities (id, name, type, attributes)
    VALUES (@id, @name, @type, @attributes)
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      type       = excluded.type,
      attributes = excluded.attributes
  `),

  getEntityByName: db.prepare(`
    SELECT * FROM entities WHERE name LIKE ? LIMIT 10
  `),

  getEntitiesByType: db.prepare(`
    SELECT * FROM entities WHERE type = ?
  `),

  // Conversations
  insertTurn: db.prepare(`
    INSERT INTO conversations (id, session_id, role, content, tool_used)
    VALUES (@id, @session_id, @role, @content, @tool_used)
  `),

  getRecentTurns: db.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getAllRecentTurns: db.prepare(`
    SELECT * FROM conversations
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  // Preferences
  upsertPreference: db.prepare(`
    INSERT INTO preferences (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `),

  getPreference: db.prepare(`
    SELECT value FROM preferences WHERE key = ?
  `),

  getAllPreferences: db.prepare(`
    SELECT * FROM preferences ORDER BY key
  `),
};

// ─────────────────────────────────────────────────────────────────
// Public API — Facts
// ─────────────────────────────────────────────────────────────────

/**
 * Save or update a fact. If a fact with the same key already exists,
 * it will be updated in-place (upsert by normalised key).
 *
 * @param {string} key        - Normalised fact key e.g. "user.name"
 * @param {string} value      - Fact value e.g. "Tejas Singh Bhati"
 * @param {object} [opts]
 * @param {string} [opts.category='general']
 * @param {number} [opts.confidence=1.0]
 * @param {string} [opts.sessionId]
 * @returns {string} The fact's ID
 */
function saveFact(key, value, opts = {}) {
  const { category = 'general', confidence = 1.0, sessionId = null } = opts;

  // Try to find existing fact with same key to reuse its ID
  const existing = stmts.getFactByKey.get(key);
  const id = existing ? existing.id : uuidv4();

  stmts.upsertFact.run({
    id,
    key:        key.toLowerCase().trim(),
    value:      String(value).trim(),
    category:   category.toLowerCase(),
    confidence,
    session_id: sessionId,
  });

  return id;
}

/**
 * Retrieve a fact by exact key.
 * @param {string} key
 * @returns {object|null}
 */
function getFact(key) {
  return stmts.getFactByKey.get(key.toLowerCase().trim()) || null;
}

/**
 * Keyword-based fact search (LIKE query on key + value).
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {object[]}
 */
function searchFacts(query, limit = 10) {
  const pattern = `%${query}%`;
  return stmts.searchFacts.all(pattern, pattern, limit);
}

/**
 * Return the N most recently updated facts.
 * @param {number} [limit=20]
 * @returns {object[]}
 */
function getAllFacts(limit = 20) {
  return stmts.getAllFacts.all(limit);
}

/**
 * Return all facts in a given category.
 * @param {string} category
 * @returns {object[]}
 */
function getFactsByCategory(category) {
  return stmts.getFactsByCategory.all(category.toLowerCase());
}

/**
 * Delete a fact by key.
 * @param {string} key
 * @returns {boolean}
 */
function deleteFact(key) {
  const info = stmts.deleteFact.run(key.toLowerCase().trim());
  return info.changes > 0;
}

/**
 * Delete a fact by its UUID.
 * @param {string} id
 * @returns {boolean}
 */
function deleteFactById(id) {
  const info = stmts.deleteFactById.run(id);
  return info.changes > 0;
}

// ─────────────────────────────────────────────────────────────────
// Public API — Entities
// ─────────────────────────────────────────────────────────────────

/**
 * Save or update a named entity.
 * @param {string} name
 * @param {string} type   - 'person'|'project'|'place'|'concept'|'technology'
 * @param {object} [attributes={}]
 * @returns {string} Entity ID
 */
function saveEntity(name, type, attributes = {}) {
  const existing = stmts.getEntityByName.get(`%${name}%`);
  const id = existing ? existing.id : uuidv4();
  stmts.upsertEntity.run({
    id,
    name:       name.trim(),
    type:       type.toLowerCase(),
    attributes: JSON.stringify(attributes),
  });
  return id;
}

/**
 * Find entities by name (fuzzy LIKE).
 * @param {string} name
 * @returns {object[]}
 */
function findEntities(name) {
  return stmts.getEntityByName.all(`%${name}%`);
}

/**
 * Return all entities of a given type.
 * @param {string} type
 * @returns {object[]}
 */
function getEntitiesByType(type) {
  return stmts.getEntitiesByType.all(type.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────
// Public API — Conversations
// ─────────────────────────────────────────────────────────────────

/**
 * Log a single conversation turn to the episodic store.
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {string|null} [toolUsed]
 * @returns {string} Turn ID
 */
function logTurn(sessionId, role, content, toolUsed = null) {
  const id = uuidv4();
  stmts.insertTurn.run({
    id,
    session_id: sessionId,
    role,
    content:    String(content),
    tool_used:  toolUsed,
  });
  return id;
}

/**
 * Retrieve recent turns for a specific session (most recent first).
 * @param {string} sessionId
 * @param {number} [limit=10]
 * @returns {object[]}
 */
function getRecentTurns(sessionId, limit = 10) {
  return stmts.getRecentTurns.all(sessionId, limit).reverse();
}

/**
 * Retrieve recent turns across ALL sessions.
 * @param {number} [limit=20]
 * @returns {object[]}
 */
function getAllRecentTurns(limit = 20) {
  return stmts.getAllRecentTurns.all(limit).reverse();
}

// ─────────────────────────────────────────────────────────────────
// Public API — Preferences
// ─────────────────────────────────────────────────────────────────

/**
 * Set a user preference.
 * @param {string} key
 * @param {string} value
 */
function setPreference(key, value) {
  stmts.upsertPreference.run(key.toLowerCase().trim(), String(value));
}

/**
 * Get a user preference by key.
 * @param {string} key
 * @returns {string|null}
 */
function getPreference(key) {
  const row = stmts.getPreference.get(key.toLowerCase().trim());
  return row ? row.value : null;
}

/**
 * Get all stored preferences.
 * @returns {object[]}
 */
function getAllPreferences() {
  return stmts.getAllPreferences.all();
}

/**
 * Close the database connection. Useful for tests.
 */
function close() {
  db.close();
}

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  // Facts
  saveFact,
  getFact,
  searchFacts,
  getAllFacts,
  getFactsByCategory,
  deleteFact,
  deleteFactById,
  // Entities
  saveEntity,
  findEntities,
  getEntitiesByType,
  // Conversations
  logTurn,
  getRecentTurns,
  getAllRecentTurns,
  // Preferences
  setPreference,
  getPreference,
  getAllPreferences,
  close,
};
