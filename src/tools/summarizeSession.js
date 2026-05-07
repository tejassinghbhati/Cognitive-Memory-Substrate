'use strict';

/**
 * Tool: summarizeSession
 *
 * Allows the agent to condense the current conversation history into a
 * high-level summary. This summary is then saved as a persistent fact
 * to preserve context while allowing episodic turns to be cleared or rotated.
 */

const memoryManager = require('../memoryManager');

module.exports = {
  name: 'summarizeSession',

  description: `Condense the current conversation history into a persistent summary.
Use this when a major task is completed, or before starting a new topic, to preserve
the 'gist' of what happened without keeping every single turn in the active context.
The summary will be saved to long-term memory with category 'session_summary'.`,

  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The UUID of the session being summarized.',
      },
      summary: {
        type: 'string',
        description: 'A concise, high-level summary of the session goals, outcomes, and key details.',
      },
      topic: {
        type: 'string',
        description: 'A short label for the topic (e.g., "Feature X development", "Debugging bug Y").',
      },
    },
    required: ['sessionId', 'summary'],
  },

  /**
   * @param {{ sessionId: string, summary: string, topic?: string }} args
   * @returns {Promise<string>}
   */
  async execute({ sessionId, summary, topic = 'general' }) {
    try {
      const key = `session.${sessionId.slice(0, 8)}.summary`;
      const val = topic ? `[Topic: ${topic}] ${summary}` : summary;
      
      const id = await memoryManager.remember(key, val, {
        category: 'session_summary',
        sessionId: sessionId
      });

      return `✅ Session summarized and archived — Key: "${key}" [id: ${id.slice(0, 8)}]`;
    } catch (err) {
      return `❌ Failed to summarize session: ${err.message}`;
    }
  },
};
