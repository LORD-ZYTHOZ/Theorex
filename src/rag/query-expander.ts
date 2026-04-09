/**
 * Query expansion for agentic retrieval (Stage 3B).
 * Default: Gemma3 via Ollama (local, free, fast).
 * Override: set QUERY_EXPAND_PROVIDER=minimax + MINIMAX_API_KEY + MINIMAX_GROUP_ID
 *           or QUERY_EXPAND_PROVIDER=openrouter + OPENROUTER_API_KEY
 *
 * Returns original query + 2 complementary variants → parallel search → RRF fusion.
 */

const TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You are a search query expansion assistant. Given a search query, generate 2 alternative queries that capture different semantic angles of the same information need. Return ONLY a JSON array of strings with no explanation. Example: ["alternative query one", "alternative query two"]`;

// ---------------------------------------------------------------------------
// 5-minute TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly expansions: string[];
  readonly expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand a query into up to 3 variants (original + 2).
 * Falls back to returning just the original on any error.
 */
export async function expandQuery(query: string): Promise<string[]> {
  // Check cache first
  const cached = _cache.get(query);
  if (cached !== undefined && Date.now() < cached.expiresAt) {
    return cached.expansions;
  }

  const provider = process.env.QUERY_EXPAND_PROVIDER || 'ollama';

  let result: string[];
  try {
    const variants = provider === 'minimax'
      ? await expandViaMinimax(query)
      : await expandViaOllama(query);

    const seen = new Set<string>([query.toLowerCase()]);
    result = [query];
    for (const v of variants) {
      if (v.trim() && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        result.push(v.trim());
      }
    }
    result = result.slice(0, 3);
  } catch {
    result = [query];
  }

  // Store in cache with 5-minute TTL
  _cache.set(query, {
    expansions: result,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Ollama provider
// ---------------------------------------------------------------------------

async function expandViaOllama(query: string): Promise<string[]> {
  const base = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_EXPAND_MODEL || 'gemma3:latest';

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      options: { temperature: 0.3, num_predict: 128 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) return [];
  const data = await res.json() as { message?: { content?: string } };
  return parseJsonArray(data.message?.content ?? '');
}

// ---------------------------------------------------------------------------
// Minimax provider
// ---------------------------------------------------------------------------

async function expandViaMinimax(query: string): Promise<string[]> {
  const apiKey = process.env.MINIMAX_API_KEY || '';
  const groupId = process.env.MINIMAX_GROUP_ID || '';
  if (!apiKey || !groupId) return [];

  const res = await fetch(
    `https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        tokens_to_generate: 128,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!res.ok) return [];
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return parseJsonArray(data.choices?.[0]?.message?.content ?? '');
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseJsonArray(content: string): string[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as unknown[];
    return arr.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}