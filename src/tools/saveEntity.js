'use strict';

/**
 * Tool: saveEntity
 *
 * Allows the agent to save structured information about a named entity
 * (person, project, technology, etc.) to the persistent store.
 */

const exactStore = require('../exactStore');

module.exports = {
  name: 'saveEntity',

  description: `Save or update a named entity in the persistent registry.
Use this for structured entities that have specific attributes, rather than just simple facts.
Examples:
  - A person ("Tejas Singh Bhati") with attributes { "role": "developer", "twitter": "@TejasSinghBhati" }
  - A project ("OpenClaw") with attributes { "language": "Node.js", "status": "active" }
  - A technology ("SQLite") with attributes { "type": "database", "reliability": "high" }

Types: person, project, place, concept, technology, organization`,

  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The full name of the entity. Example: "Claude", "OpenClaw", "San Francisco"',
      },
      type: {
        type: 'string',
        enum: ['person', 'project', 'place', 'concept', 'technology', 'organization'],
        description: 'The category of the entity.',
      },
      attributes: {
        type: 'object',
        description: 'A key-value map of additional attributes/metadata about the entity.',
      },
    },
    required: ['name', 'type'],
  },

  /**
   * @param {{ name: string, type: string, attributes?: object }} args
   * @returns {Promise<string>}
   */
  async execute({ name, type, attributes = {} }) {
    try {
      const id = exactStore.saveEntity(name, type, attributes);
      return `✅ Entity saved — "${name}" (${type}) [id: ${id.slice(0, 8)}]`;
    } catch (err) {
      return `❌ Failed to save entity "${name}": ${err.message}`;
    }
  },
};
