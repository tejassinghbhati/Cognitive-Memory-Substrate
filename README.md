# Cognitive Memory Substrate

> **The Persistent Memory Layer of the OpenClaw Framework**

**Author:** Tejas Singh Bhati  
**Status:** Active Development — Phase 2  
**Module role:** Long-term context persistence + structured entity registry

---

## Abstract

The Cognitive Memory Substrate gives OpenClaw **cross-session, long-term memory**. Without it, every conversation with the agent starts from zero. With it, the agent accumulates facts, preferences, and episodic history about the user — and draws on them automatically in every future session.

This implements a **dual-layer retrieval architecture** combining the strengths of two complementary systems:

| Layer | Technology | Retrieval type | Best for |
|---|---|---|---|
| **Exact Store** | SQLite (`better-sqlite3`) | Deterministic key/substring lookup | Known keys, preferences, entity records |
| **Semantic Store** | ChromaDB + Xenova/all-MiniLM-L6-v2 | Cosine similarity over embeddings | Fuzzy queries, meaning-based search |

Both layers are written simultaneously on every `remember()` call and queried in parallel on every `recall()` — results are merged, deduplicated, and ranked by relevance score before being returned to the agent.

---

## Architecture

```
Agent Turn (userMessage)
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│                    MemoryManager                          │
│                  src/memoryManager.js                     │
│                                                           │
│  injectContext()  ←── builds a context block for Claude   │
│  remember()       ←── dual write: SQLite + ChromaDB       │
│  recall()         ←── dual query: merge + rank results    │
│  forget()         ←── dual delete: both stores            │
│  logConversation()←── episodic turn log (SQLite)          │
│                                                           │
│  ┌──────────────────┐   ┌────────────────────────────┐   │
│  │   ExactStore     │   │      SemanticStore          │   │
│  │ src/exactStore.js│   │  src/semanticStore.js       │   │
│  │                  │   │                             │   │
│  │ SQLite tables:   │   │ ChromaDB collection:        │   │
│  │  • facts         │   │  openclaw_memories          │   │
│  │  • entities      │   │  (384-dim cosine space)     │   │
│  │  • conversations │   │                             │   │
│  │  • preferences   │   │ Embeddings via:             │   │
│  │                  │   │  Xenova/all-MiniLM-L6-v2    │   │
│  │ better-sqlite3   │   │  (local, no API key)        │   │
│  └──────────────────┘   └────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
        │
        ▼
Agent Tools (same contract as calculator.js):
  • rememberFact    — saves a fact to both stores
  • saveEntity      — saves a structured named entity (person, project, etc.)
  • recallMemory    — queries both stores, returns ranked results
  • recallEntity    — searches/retrieves structured entities
  • summarizeSession — condenses history into high-level archival facts
  • forgetMemory    — deletes from both stores (right to erasure)
        │
        ▼
Agent Execution Pipeline
  agent.js → memory context injected into SYSTEM_PROMPT per turn
```

---

## SQLite Schema

Four tables in `data/memory.db`:

```sql
-- Long-lived facts ("My name is Tejas", "I prefer TypeScript")
facts         (id, key, value, category, confidence, session_id, created_at, updated_at)

-- Named entity registry (people, projects, places, technologies)
entities      (id, name, type, attributes[JSON], created_at)

-- Episodic conversation log (every user + assistant turn)
conversations (id, session_id, role, content, tool_used, timestamp)

-- User preferences (simple key/value, upsert-friendly)
preferences   (key, value, updated_at)
```

---

## Project Structure

```
Cognitive Memory Substrate/
├── src/
│   ├── exactStore.js        ← SQLite store (4 tables, WAL mode, prepared stmts)
│   ├── semanticStore.js     ← ChromaDB client + Xenova embedding pipeline
│   ├── memoryManager.js     ← Unified facade (dual write/read/delete)
│   ├── tools/
│       ├── rememberFact.js     ← Agent tool: save to both stores
│       ├── saveEntity.js       ← Agent tool: save structured entities
│       ├── recallMemory.js     ← Agent tool: dual-layer query + merge
│       ├── recallEntity.js     ← Agent tool: search structured entities
│       ├── summarizeSession.js ← Agent tool: condense history into facts
│       └── forgetMemory.js     ← Agent tool: delete from both stores
├── data/
│   └── memory.db            ← SQLite file (auto-created, gitignored)
├── docker-compose.yml       ← ChromaDB local server (one command)
├── .env.example             ← Environment variable template
├── .gitignore
├── index.js                 ← Interactive demo CLI
└── package.json
```

---

## Setup

### Prerequisites
- Node.js v18+
- Docker Desktop (for ChromaDB local server)

### 1. Start ChromaDB

```bash
cd "Cogntive Memory Substrate"
docker-compose up -d
```

Verify it's running:
```bash
curl http://localhost:8000/api/v1/heartbeat
# → {"nanosecond heartbeat":...}
```

### 2. Install Dependencies

```bash
npm install
```

> **First run**: `@xenova/transformers` will download `all-MiniLM-L6-v2` (~23 MB) and cache it locally. This takes ~30 seconds once, then is instant forever.

### 3. Configure Environment

```bash
copy .env.example .env
```

`.env` defaults are ready to go — no API key needed for this module.

### 4. Run the Demo CLI

```bash
node index.js
```

---

## Usage

### Demo CLI

```
╔══════════════════════════════════════════════════════════════╗
║    🧠  OpenClaw — Cognitive Memory Substrate                 ║
║         Persistent Knowledge Store  |  Dual-Layer Retrieval  ║
╚══════════════════════════════════════════════════════════════╝

❯ You: /remember user.name = Tejas Singh Bhati #personal
✅ Saved — "user.name": "Tejas Singh Bhati"  [personal]

❯ You: /remember preference.language = TypeScript #preference
✅ Saved — "preference.language": "TypeScript"  [preference]

❯ You: /recall what is the user's preferred language?
🔍 Recall results for: "what is the user's preferred language?"
──────────────────────────────────────────────────
  preference.language  →  TypeScript
  ████████░░ 84%  via 🔮 semantic

❯ You: /stats
📊 Memory Statistics
  Facts (SQLite)        :  2
  Vectors (ChromaDB)    :  2
  Preferences (SQLite)  :  0
  Conversation turns    :  4

❯ You: /forget user.name
🗑️  Deleted "user.name" from all stores.
```

### CLI Commands

| Command | Description |
|---|---|
| `/remember <key> = <value> [#category]` | Save a fact to both stores |
| `/recall <query>` | Semantic + exact search |
| `/search <query>` | Universal search (Facts + Entities + Prefs) |
| `/forget <key>` | Delete a memory from both stores |
| `/facts` | List all stored facts |
| `/prefs` | List all preferences |
| `/entities [type]` | List all stored entities |
| `/summarize <topic>` | Test session summarization |
| `/stats` | Show memory statistics |
| `/reset` | Wipe the ChromaDB vector store |
| `/exit` | Quit the CLI |
| *(any text)* | Natural-language memory query |

### Agent Tool Examples

When Claude is running via the Agent Execution Pipeline, it can call these tools:

```
User: "My name is Tejas and I'm working on a project called OpenClaw"

→ Claude calls: rememberFact({ key: "user.name", value: "Tejas", category: "personal" })
→ Claude calls: rememberFact({ key: "project.current", value: "OpenClaw", category: "project" })

--- (next session, weeks later) ---

User: "What was I working on?"

→ Claude calls: recallMemory({ query: "current project" })
→ Returns: project.current = OpenClaw (87% relevance, semantic)
```

---

## Integration with Agent Execution Pipeline

The memory tools are automatically registered in the pipeline's `toolRegistry.js`. Additionally, `agent.js` has been patched to:

1. **Inject memory context** into the system prompt before each Claude call:
   ```
   === PERSISTENT MEMORY ===
   • [personal] user.name: Tejas Singh Bhati  (relevance: 0.91)
   • [project] project.current: OpenClaw       (relevance: 0.87)
   ```

2. **Log every turn** (user + assistant) to the SQLite episodic store.

This gives Claude **automatic, passive memory** — no tool call required for the agent to know who it's talking to.

---

## Design Notes

### Graceful Degradation
If ChromaDB (Docker) is not running, the system falls back to exact-only SQLite retrieval. No crash, no data loss — the agent just operates without semantic search until Chroma is restored.

### Embedding Model
`Xenova/all-MiniLM-L6-v2` produces 384-dimensional sentence embeddings and runs entirely inside Node.js via WebAssembly. No API key, no network requests, no data leaves the machine.

### Dual-Write Consistency
On `remember()`, SQLite is written first (synchronous, guaranteed). ChromaDB write is attempted second; failure is logged as a warning but never bubbles up to the caller. This means the exact store is always the source of truth.

---

## OpenClaw Module Map

| Module | Role |
|---|---|
| CLI Task Manager | Persistent task storage — SQLite patterns |
| Multi-Platform Bot | Input layer — Discord + Telegram |
| Runtime Extension Engine | Hot-loadable skill plugins |
| Agent Execution Pipeline | Intelligence core — ReAct loop |
| **Cognitive Memory Substrate** | **Long-term memory — this module** |
| Skill Graph *(upcoming)* | Composable tool chains |

---

## Stack

| Concern | Technology |
|---|---|
| Exact Store | SQLite via `better-sqlite3` |
| Vector Store | ChromaDB (Docker, local) |
| Embedding Model | `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` |
| Unique IDs | `uuid` v4 |
| Config | `dotenv` |
| Runtime | Node.js v18+ |
