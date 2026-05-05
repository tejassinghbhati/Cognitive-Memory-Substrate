'use strict';

/**
 * Tool: rememberFact
 *
 * Allows the agent (Claude) to save a fact about the user to persistent memory.
 * Writes simultaneously to SQLite (exact) + ChromaDB (semantic).
 *
 * Follows the same tool contract as calculator.js / fileReader.js in the
 * Agent Execution Pipeline's toolRegistry.
 */

const memoryManager = require('../memoryManager');

module.exports = {
  name: 'rememberFact',

  description: `Save a fact, preference, or piece of information about the user to long-term persistent memory.
Use this tool when the user:
  - Shares personal information ("My name is X", "I live in Y")
  - States a preference ("I prefer TypeScript", "I like dark mode")
  - Mentions a project or goal ("I'm working on OpenClaw")
  - Asks you to remember something explicitly
  - Provides any detail that would be useful in future conversations

The memory persists across ALL sessions — the agent will recall it automatically in future conversations.
Categories: personal, preference, project, technical, goal, entity, general`,

  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'A short, normalised identifier for the fact. Use dot notation for clarity. ' +
          'Examples: "user.name", "preference.language", "project.current", "user.location"',
      },
      value: {
        type: 'string',
        description: 'The value to store. Examples: "Tejas Singh Bhati", "TypeScript", "OpenClaw"',
      },
      category: {
        type: 'string',
        enum: ['personal', 'preference', 'project', 'technical', 'goal', 'entity', 'general'],
        description: 'Category label for the fact. Defaults to "general".',
      },
    },
    required: ['key', 'value'],
  },

  /**
   * @param {{ key: string, value: string, category?: string }} args
   * @returns {Promise<string>}
   */
  async execute({ key, value, category = 'general' }) {
    try {
      const id = await memoryManager.remember(key, value, { category });
      return `✅ Memory saved — "${key}": "${value}" [category: ${category}, id: ${id.slice(0, 8)}]`;
    } catch (err) {
      return `❌ Failed to save memory for key "${key}": ${err.message}`;
    }
  },
};
