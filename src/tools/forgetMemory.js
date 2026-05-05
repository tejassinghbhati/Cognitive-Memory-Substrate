'use strict';

/**
 * Tool: forgetMemory
 *
 * Allows the agent (Claude) to delete a specific memory from BOTH stores
 * (SQLite exact store + ChromaDB semantic store).
 *
 * Use this when the user asks to "forget" something, corrects stored information,
 * or invokes their right to erasure. Equivalent to a targeted GDPR erasure.
 */

const memoryManager = require('../memoryManager');

module.exports = {
  name: 'forgetMemory',

  description: `Delete a specific memory from persistent storage (both exact and semantic stores).
Use this tool when:
  - The user explicitly says "forget that" or "don't remember X"
  - The user corrects stored information (forget the old one, then remember the new one)
  - The user wants to clear a preference or fact
  - The user invokes their right to have data erased

This permanently removes the fact from both the SQLite database and the ChromaDB vector store.`,

  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'The exact key of the fact to delete, e.g. "user.name", "preference.language". ' +
          'Use recallMemory first to confirm the exact key if unsure.',
      },
    },
    required: ['key'],
  },

  /**
   * @param {{ key: string }} args
   * @returns {Promise<string>}
   */
  async execute({ key }) {
    try {
      const deleted = await memoryManager.forget(key);

      if (deleted) {
        return `🗑️  Memory deleted — "${key}" has been permanently removed from all stores.`;
      } else {
        return `No memory found with key "${key}". Nothing was deleted. ` +
               `Use recallMemory to search for the correct key name.`;
      }
    } catch (err) {
      return `❌ Failed to delete memory "${key}": ${err.message}`;
    }
  },
};
