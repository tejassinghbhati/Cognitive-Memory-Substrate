'use strict';

const fs = require('fs');
const path = require('path');

// Use a temporary test database
const TEST_DB_PATH = path.resolve(__dirname, '../data/test-memory.db');
process.env.MEMORY_DB_PATH = TEST_DB_PATH;

// Ensure test db is fresh (BEFORE requiring the module which opens the connection)
if (fs.existsSync(TEST_DB_PATH)) {
  try {
    fs.unlinkSync(TEST_DB_PATH);
    const wal = TEST_DB_PATH + '-wal';
    const shm = TEST_DB_PATH + '-shm';
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch (e) {
    // Ignore busy errors, we'll just reuse the DB
  }
}

const exactStore = require('./exactStore');

describe('exactStore', () => {

  afterAll(() => {
    // Cleanup
    exactStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // Also cleanup WAL files if they exist
    const wal = TEST_DB_PATH + '-wal';
    const shm = TEST_DB_PATH + '-shm';
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  });

  describe('Facts', () => {
    test('should save and retrieve a fact', () => {
      const id = exactStore.saveFact('user.name', 'Tejas', { category: 'personal' });
      expect(id).toBeDefined();

      const fact = exactStore.getFact('user.name');
      expect(fact).toBeDefined();
      expect(fact.value).toBe('Tejas');
      expect(fact.category).toBe('personal');
    });

    test('should update an existing fact (upsert)', () => {
      const id1 = exactStore.saveFact('user.status', 'active');
      const id2 = exactStore.saveFact('user.status', 'busy');

      expect(id1).toBe(id2);
      const fact = exactStore.getFact('user.status');
      expect(fact.value).toBe('busy');
    });

    test('should search facts', () => {
      exactStore.saveFact('project.name', 'OpenClaw');
      const results = exactStore.searchFacts('OpenClaw');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe('project.name');
    });

    test('should delete a fact', () => {
      exactStore.saveFact('temp.fact', 'to be deleted');
      const deleted = exactStore.deleteFact('temp.fact');
      expect(deleted).toBe(true);
      expect(exactStore.getFact('temp.fact')).toBeNull();
    });
  });

  describe('Entities', () => {
    test('should save and find entities', () => {
      const id = exactStore.saveEntity('Claude', 'person', { company: 'Anthropic' });
      expect(id).toBeDefined();

      const entities = exactStore.findEntities('Claude');
      expect(entities.length).toBe(1);
      expect(entities[0].name).toBe('Claude');
      expect(JSON.parse(entities[0].attributes).company).toBe('Anthropic');
    });

    test('should get entities by type', () => {
      exactStore.saveEntity('JavaScript', 'technology');
      exactStore.saveEntity('Python', 'technology');
      
      const techs = exactStore.getEntitiesByType('technology');
      expect(techs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Conversations', () => {
    test('should log and retrieve turns', () => {
      const sessionId = 'test-session-123';
      exactStore.logTurn(sessionId, 'user', 'Hello');
      exactStore.logTurn(sessionId, 'assistant', 'Hi there');

      const turns = exactStore.getRecentTurns(sessionId, 10);
      expect(turns.length).toBe(2);
      const roles = turns.map(t => t.role);
      expect(roles).toContain('user');
      expect(roles).toContain('assistant');
    });
  });

  describe('Preferences', () => {
    test('should set and get preferences', () => {
      exactStore.setPreference('theme', 'dark');
      const value = exactStore.getPreference('theme');
      expect(value).toBe('dark');
    });

    test('should update preferences', () => {
      exactStore.setPreference('font', 'Inter');
      exactStore.setPreference('font', 'Roboto');
      expect(exactStore.getPreference('font')).toBe('Roboto');
    });
  });
});
