'use strict';

/**
 * Tool: recallMemory
 *
 * Allows the agent (Claude) to explicitly query the memory store
 * for facts relevant to a natural-language question.
 *
 * Queries BOTH layers:
 *   - ChromaDB (semantic / embedding similarity)
 *   - SQLite   (exact substring match on key + value)
 *
 * Results are merged, deduplicated, and ranked by relevance score.
 */

const memoryManager = require('../memoryManager');

module.exports = {
  name: 'recallMemory',

  description: `Search the persistent memory store for facts, preferences, or information relevant to a query.
Use this tool when:
  - You need to recall something the user told you in a previous session
  - The user asks "do you remember when I told you X?"
  - You want to check what you know about the user before answering
  - You need to look up a specific preference or setting
  - Any question that might be answered by prior stored knowledge

This searches both a semantic vector store (ChromaDB) and a structured fact store (SQLite),
then merges and ranks results by relevance. Returns the top matching memories.`,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'A natural language description of what you want to recall. ' +
          'Examples: "user\'s name", "preferred programming language", "current project"',
      },
      category: {
        type: 'string',
        enum: ['personal', 'preference', 'project', 'technical', 'goal', 'entity', 'general'],
        description: 'Optional: narrow results to a specific category.',
      },
      topK: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5).',
      },
    },
    required: ['query'],
  },

  /**
   * @param {{ query: string, category?: string, topK?: number }} args
   * @returns {Promise<string>}
   */
  async execute({ query, category, topK = 5 }) {
    try {
      const results = await memoryManager.recall(query, { topK, category });

      if (results.length === 0) {
        return `No memories found matching: "${query}". Nothing has been stored about this yet.`;
      }

      const lines = [
        `Found ${results.length} relevant memory(ies) for: "${query}"`,
        '',
      ];

      for (const r of results) {
        const pct    = Math.round(r.score * 100);
        const source = r.source === 'semantic' ? '🔮 semantic' : '📋 exact';
        lines.push(`• [${r.category}] ${r.key}: ${r.value}`);
        lines.push(`  Relevance: ${pct}%  Source: ${source}`);
        lines.push('');
      }

      return lines.join('\n').trim();
    } catch (err) {
      return `❌ Memory recall failed: ${err.message}`;
    }
  },
};
