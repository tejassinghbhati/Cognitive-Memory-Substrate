'use strict';

/**
 * Tool: recallEntity
 *
 * Allows the agent to search for and retrieve structured entity information.
 */

const exactStore = require('../exactStore');

module.exports = {
  name: 'recallEntity',

  description: `Search for and retrieve information about named entities (people, projects, etc.).
You can search by name (partial match) or list all entities of a specific type.`,

  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Partial or full name of the entity to search for.',
      },
      type: {
        type: 'string',
        enum: ['person', 'project', 'place', 'concept', 'technology', 'organization'],
        description: 'Optionally filter results by entity type.',
      },
    },
  },

  /**
   * @param {{ name?: string, type?: string }} args
   * @returns {Promise<string>}
   */
  async execute({ name, type }) {
    try {
      let results = [];

      if (name) {
        results = exactStore.findEntities(name);
      } else if (type) {
        results = exactStore.getEntitiesByType(type);
      } else {
        return '❌ Please provide either a name or a type to search for entities.';
      }

      if (results.length === 0) {
        return `⚠️ No entities found matching your criteria${name ? ' ("' + name + '")' : ''}${type ? ' [type: ' + type + ']' : ''}.`;
      }

      const output = results.map(r => {
        const attrs = JSON.parse(r.attributes || '{}');
        const attrStr = Object.entries(attrs)
          .map(([k, v]) => `  • ${k}: ${v}`)
          .join('\n');
        
        return `Name: ${r.name}\nType: ${r.type}\nAttributes:\n${attrStr || '  (none)'}`;
      }).join('\n\n---\n\n');

      return `🔍 Found ${results.length} entities:\n\n${output}`;
    } catch (err) {
      return `❌ Error recalling entities: ${err.message}`;
    }
  },
};
