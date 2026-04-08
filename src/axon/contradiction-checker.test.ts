import { describe, test, expect } from 'bun:test';
import { checkContradictions } from './contradiction-checker';
import type {
  ConceptRow,
  ContradictionCheckerDeps,
} from './contradiction-checker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function makeDeps(overrides: Partial<ContradictionCheckerDeps> = {}): ContradictionCheckerDeps {
  return {
    embed: async (_text) => FAKE_EMBEDDING,
    searchSimilar: async (_emb, _agentId, _limit) => [],
    llmVerdict: async (_newContent, _existingBody) => 'none',
    ...overrides,
  };
}

function makeConceptRow(partial: Partial<ConceptRow> & { id: string }): ConceptRow {
  return {
    label: `Concept ${partial.id}`,
    body: 'some existing body text',
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkContradictions', () => {
  test('no similar concepts → empty result', async () => {
    const deps = makeDeps({ searchSimilar: async () => [] });
    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(result.hasHard).toBe(false);
    expect(result.hasSoft).toBe(false);
    expect(result.contradictions).toEqual([]);
  });

  test('similar concept with "none" verdict → empty result', async () => {
    const concept = makeConceptRow({ id: 'c1', body: 'existing body' });
    const deps = makeDeps({
      searchSimilar: async () => [concept],
      llmVerdict: async () => 'none',
    });

    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(result.hasHard).toBe(false);
    expect(result.hasSoft).toBe(false);
    expect(result.contradictions).toHaveLength(0);
  });

  test('similar concept with "hard" verdict → hasHard=true with entry', async () => {
    const concept = makeConceptRow({ id: 'c1', label: 'Gold is expensive', body: 'Gold costs a lot' });
    const deps = makeDeps({
      searchSimilar: async () => [concept],
      llmVerdict: async () => 'hard',
    });

    const result = await checkContradictions('Gold is free', 'agent-1', deps);

    expect(result.hasHard).toBe(true);
    expect(result.hasSoft).toBe(false);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].conceptId).toBe('c1');
    expect(result.contradictions[0].label).toBe('Gold is expensive');
    expect(result.contradictions[0].severity).toBe('hard');
    expect(result.contradictions[0].reason).toContain('Gold is expensive');
  });

  test('similar concept with "soft" verdict → hasSoft=true', async () => {
    const concept = makeConceptRow({ id: 'c2', label: 'Markets trend up', body: 'Long-term markets rise' });
    const deps = makeDeps({
      searchSimilar: async () => [concept],
      llmVerdict: async () => 'soft',
    });

    const result = await checkContradictions('Markets are flat', 'agent-2', deps);

    expect(result.hasSoft).toBe(true);
    expect(result.hasHard).toBe(false);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].severity).toBe('soft');
  });

  test('multiple concepts, mixed verdicts → both flags set', async () => {
    const concepts: ConceptRow[] = [
      makeConceptRow({ id: 'c1', label: 'Hard concept', body: 'hard body' }),
      makeConceptRow({ id: 'c2', label: 'Soft concept', body: 'soft body' }),
      makeConceptRow({ id: 'c3', label: 'Fine concept', body: 'fine body' }),
    ];

    let callCount = 0;
    const verdicts: Array<'hard' | 'soft' | 'none'> = ['hard', 'soft', 'none'];

    const deps = makeDeps({
      searchSimilar: async () => concepts,
      llmVerdict: async () => verdicts[callCount++],
    });

    const result = await checkContradictions('new content', 'agent-3', deps);

    expect(result.hasHard).toBe(true);
    expect(result.hasSoft).toBe(true);
    expect(result.contradictions).toHaveLength(2);

    const ids = result.contradictions.map((c) => c.conceptId);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(ids).not.toContain('c3');
  });

  test('embed throws → returns empty result (graceful degradation)', async () => {
    const deps = makeDeps({
      embed: async () => { throw new Error('embed service unavailable'); },
      searchSimilar: async () => { throw new Error('should not be called'); },
    });

    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(result.hasHard).toBe(false);
    expect(result.hasSoft).toBe(false);
    expect(result.contradictions).toEqual([]);
  });

  test('searchSimilar throws → returns empty result (graceful degradation)', async () => {
    const deps = makeDeps({
      embed: async () => FAKE_EMBEDDING,
      searchSimilar: async () => { throw new Error('db unavailable'); },
    });

    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(result.hasHard).toBe(false);
    expect(result.hasSoft).toBe(false);
    expect(result.contradictions).toEqual([]);
  });

  test('llmVerdict throws for one concept → skips it, processes rest', async () => {
    const concepts: ConceptRow[] = [
      makeConceptRow({ id: 'fail', label: 'Fails', body: 'will throw' }),
      makeConceptRow({ id: 'ok', label: 'Succeeds', body: 'will return hard' }),
    ];

    const deps = makeDeps({
      searchSimilar: async () => concepts,
      llmVerdict: async (_newContent, existingBody) => {
        if (existingBody === 'will throw') throw new Error('LLM timeout');
        return 'hard';
      },
    });

    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(result.hasHard).toBe(true);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].conceptId).toBe('ok');
  });

  test('concepts with null body are skipped without calling llmVerdict', async () => {
    let verdictCalled = false;
    const concept = makeConceptRow({ id: 'c1', body: null });

    const deps = makeDeps({
      searchSimilar: async () => [concept],
      llmVerdict: async () => {
        verdictCalled = true;
        return 'hard';
      },
    });

    const result = await checkContradictions('new content', 'agent-1', deps);

    expect(verdictCalled).toBe(false);
    expect(result.contradictions).toHaveLength(0);
  });

  test('respects custom similarityLimit', async () => {
    let capturedLimit = 0;
    const deps = makeDeps({
      searchSimilar: async (_emb, _agentId, limit) => {
        capturedLimit = limit;
        return [];
      },
    });

    await checkContradictions('new content', 'agent-1', deps, 10);

    expect(capturedLimit).toBe(10);
  });

  test('defaults similarityLimit to 5 when not specified', async () => {
    let capturedLimit = 0;
    const deps = makeDeps({
      searchSimilar: async (_emb, _agentId, limit) => {
        capturedLimit = limit;
        return [];
      },
    });

    await checkContradictions('new content', 'agent-1', deps);

    expect(capturedLimit).toBe(5);
  });
});
