'use strict';

/**
 * index.js — Cognitive Memory Substrate  |  Interactive demo CLI
 *
 * A standalone REPL that exercises the full dual-layer memory system:
 *   • Type a message → agent recalls relevant memories and responds
 *   • Use /remember, /recall, /forget, /stats, /facts, /prefs slash commands
 *   • Session persists to SQLite; ChromaDB persists across restarts
 *   • Shows a live memory dashboard after each turn
 */

require('dotenv').config();

const readline      = require('readline');
const { v4: uuidv4 } = require('uuid');
const memory        = require('./src/memoryManager');

// ─────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────

const SESSION_ID = uuidv4();

// ─────────────────────────────────────────────────────────────────
// Terminal helpers
// ─────────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  blue:    '\x1b[34m',
  gray:    '\x1b[90m',
};

const banner = `
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════╗
║    🧠  OpenClaw — Cognitive Memory Substrate                 ║
║         Persistent Knowledge Store  |  Dual-Layer Retrieval  ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
${C.dim}  SQLite (exact) + ChromaDB (semantic) + Xenova/all-MiniLM-L6-v2${C.reset}
  Session: ${C.yellow}${SESSION_ID.slice(0, 8)}...${C.reset}

${C.bold}Commands:${C.reset}
  ${C.green}/remember <key> = <value> [#category]${C.reset}  — save a fact
  ${C.green}/recall <query>${C.reset}                        — semantic + exact search
  ${C.green}/forget <key>${C.reset}                          — delete a memory
  ${C.green}/facts${C.reset}                                  — list all stored facts
  ${C.green}/prefs${C.reset}                                  — list all preferences
  ${C.green}/stats${C.reset}                                  — show memory statistics
  ${C.green}/reset${C.reset}                                  — wipe vector store (caution!)
  ${C.green}/help${C.reset}                                   — show this help
  ${C.green}/exit${C.reset}                                   — quit

  Or just type anything to query memory with a natural language search.
${'─'.repeat(66)}`;

function print(msg)  { process.stdout.write(msg + '\n'); }
function hr()        { print(`${C.gray}${'─'.repeat(66)}${C.reset}`); }

// ─────────────────────────────────────────────────────────────────
// Command handlers
// ─────────────────────────────────────────────────────────────────

/**
 * /remember user.name = Tejas #personal
 * /remember preference.language = TypeScript
 */
async function handleRemember(args) {
  // Parse:  key = value  [#category]
  const match = args.match(/^(.+?)\s*=\s*(.+?)(?:\s+#(\w+))?$/);
  if (!match) {
    print(`${C.red}Usage: /remember <key> = <value> [#category]${C.reset}`);
    return;
  }

  const [, key, value, category = 'general'] = match;
  print(`${C.dim}Saving to SQLite + ChromaDB...${C.reset}`);

  const id = await memory.remember(key.trim(), value.trim(), {
    category:  category.toLowerCase(),
    sessionId: SESSION_ID,
  });

  print(`${C.green}✅ Saved — "${key.trim()}": "${value.trim()}"  [${category}]${C.reset}`);
  print(`${C.gray}   ID: ${id}${C.reset}`);
}

/**
 * /recall preferred programming language
 */
async function handleRecall(query) {
  if (!query.trim()) {
    print(`${C.red}Usage: /recall <query>${C.reset}`);
    return;
  }

  print(`${C.dim}Searching semantic + exact stores...${C.reset}`);
  const results = await memory.recall(query, { topK: 7 });

  if (results.length === 0) {
    print(`${C.yellow}⚠️  No memories found for: "${query}"${C.reset}`);
    return;
  }

  print(`\n${C.cyan}${C.bold}🔍 Recall results for: "${query}"${C.reset}`);
  hr();
  for (const r of results) {
    const pct    = Math.round(r.score * 100);
    const src    = r.source === 'semantic' ? `${C.magenta}🔮 semantic${C.reset}` : `${C.blue}📋 exact${C.reset}`;
    const bar    = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    print(`  ${C.bold}${r.key}${C.reset}  →  ${C.green}${r.value}${C.reset}`);
    print(`  ${C.gray}[${r.category}]  ${bar} ${pct}%  via ${src}`);
    print('');
  }
}

/**
 * /forget user.name
 */
async function handleForget(key) {
  if (!key.trim()) {
    print(`${C.red}Usage: /forget <key>${C.reset}`);
    return;
  }
  const deleted = await memory.forget(key.trim());
  if (deleted) {
    print(`${C.green}🗑️  Deleted "${key.trim()}" from all stores.${C.reset}`);
  } else {
    print(`${C.yellow}No memory found with key "${key.trim()}".${C.reset}`);
  }
}

/**
 * /facts
 */
function handleFacts() {
  const facts = memory.getAllFacts(50);
  if (facts.length === 0) {
    print(`${C.yellow}No facts stored yet.${C.reset}`);
    return;
  }
  print(`\n${C.cyan}${C.bold}📋 All Stored Facts (${facts.length})${C.reset}`);
  hr();
  for (const f of facts) {
    const ts = new Date(f.updated_at).toLocaleString();
    print(`  ${C.bold}${f.key}${C.reset}  →  ${C.green}${f.value}${C.reset}  ${C.gray}[${f.category}]  ${ts}${C.reset}`);
  }
}

/**
 * /prefs
 */
function handlePrefs() {
  const prefs = memory.getAllPreferences();
  if (prefs.length === 0) {
    print(`${C.yellow}No preferences stored yet.${C.reset}`);
    return;
  }
  print(`\n${C.cyan}${C.bold}⚙️  User Preferences${C.reset}`);
  hr();
  for (const p of prefs) {
    print(`  ${C.bold}${p.key}${C.reset}  →  ${C.green}${p.value}${C.reset}`);
  }
}

/**
 * /stats
 */
async function handleStats() {
  print(`${C.dim}Fetching memory stats...${C.reset}`);
  const stats = await memory.getStats();
  print(`\n${C.cyan}${C.bold}📊 Memory Statistics${C.reset}`);
  hr();
  print(`  ${C.bold}Facts (SQLite)${C.reset}        :  ${C.green}${stats.facts}${C.reset}`);
  print(`  ${C.bold}Vectors (ChromaDB)${C.reset}    :  ${C.green}${stats.vectors}${C.reset}`);
  print(`  ${C.bold}Preferences (SQLite)${C.reset}  :  ${C.green}${stats.preferences}${C.reset}`);
  print(`  ${C.bold}Conversation turns${C.reset}    :  ${C.green}${stats.turns}${C.reset}`);
  print(`  ${C.bold}Session ID${C.reset}            :  ${C.yellow}${SESSION_ID.slice(0, 8)}...${C.reset}`);
}

/**
 * Natural-language memory query
 */
async function handleQuery(input) {
  // Log the user's message to episodic store
  memory.logConversation(SESSION_ID, 'user', input);

  print(`${C.dim}Searching memory...${C.reset}`);
  const results = await memory.recall(input, { topK: 5 });

  // Build context block
  const context = await memory.injectContext(input, SESSION_ID);

  print(`\n${C.cyan}${C.bold}🧠 Memory Response${C.reset}`);
  hr();

  if (context.trim()) {
    print(context);
  } else {
    print(`${C.yellow}No relevant memories found. Try /remember to store some facts first!${C.reset}`);
    print('');
  }

  if (results.length > 0) {
    print(`${C.bold}Top matches:${C.reset}`);
    for (const r of results) {
      const pct = Math.round(r.score * 100);
      print(`  • ${C.bold}${r.key}${C.reset}: ${C.green}${r.value}${C.reset}  ${C.gray}(${pct}% match via ${r.source})${C.reset}`);
    }
  }

  // Log a synthetic "assistant" response
  const response = results.length > 0
    ? `Found ${results.length} relevant memories for your query.`
    : 'No relevant memories found.';
  memory.logConversation(SESSION_ID, 'assistant', response);
}

// ─────────────────────────────────────────────────────────────────
// REPL loop
// ─────────────────────────────────────────────────────────────────

async function main() {
  print(banner);

  // Warm up the semantic store (connects to Chroma + loads embedding model)
  print(`${C.dim}Initialising stores...${C.reset}`);
  try {
    const stats = await memory.getStats();
    print(`${C.green}✅ Memory stores ready  |  ${stats.facts} facts  |  ${stats.vectors} vectors${C.reset}\n`);
  } catch (err) {
    print(`${C.yellow}⚠️  ChromaDB not available: ${err.message}${C.reset}`);
    print(`${C.yellow}   Exact (SQLite) store is still fully operational.${C.reset}`);
    print(`${C.yellow}   To enable semantic search, run: docker-compose up -d${C.reset}\n`);
  }

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: true,
  });

  const prompt = () =>
    rl.question(`${C.cyan}${C.bold}❯ You: ${C.reset}`, async (line) => {
      const input = line.trim();

      if (!input) { prompt(); return; }

      if (input === '/exit' || input === '/quit') {
        print(`${C.gray}Goodbye! Your memories are safely stored.${C.reset}`);
        rl.close();
        return;
      }

      if (input === '/help') {
        print(banner);
        prompt();
        return;
      }

      if (input === '/stats') {
        await handleStats().catch((e) => print(`${C.red}${e.message}${C.reset}`));
        print('');
        prompt();
        return;
      }

      if (input === '/facts') {
        handleFacts();
        print('');
        prompt();
        return;
      }

      if (input === '/prefs') {
        handlePrefs();
        print('');
        prompt();
        return;
      }

      if (input.startsWith('/remember ')) {
        await handleRemember(input.slice(10)).catch((e) => print(`${C.red}${e.message}${C.reset}`));
        print('');
        prompt();
        return;
      }

      if (input.startsWith('/recall ')) {
        await handleRecall(input.slice(8)).catch((e) => print(`${C.red}${e.message}${C.reset}`));
        print('');
        prompt();
        return;
      }

      if (input.startsWith('/forget ')) {
        await handleForget(input.slice(8)).catch((e) => print(`${C.red}${e.message}${C.reset}`));
        print('');
        prompt();
        return;
      }

      if (input.startsWith('/reset')) {
        print(`${C.yellow}⚠️  This will wipe ALL vectors from ChromaDB. Type "yes" to confirm: ${C.reset}`);
        rl.question('', async (ans) => {
          if (ans.trim().toLowerCase() === 'yes') {
            const { resetCollection } = require('./src/semanticStore');
            await resetCollection();
            print(`${C.green}✅ Vector store reset.${C.reset}`);
          } else {
            print('Cancelled.');
          }
          print('');
          prompt();
        });
        return;
      }

      // Default: natural-language memory query
      await handleQuery(input).catch((e) => print(`${C.red}${e.message}${C.reset}`));
      print('');
      prompt();
    });

  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
