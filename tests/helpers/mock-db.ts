// ---------------------------------------------------------------------------
// Shared mock DB infrastructure for route tests
// ---------------------------------------------------------------------------
// Provides a chainable mock that simulates Drizzle ORM's query builder API.
// Import in any route test file to avoid duplicating this boilerplate.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MockFn = ReturnType<typeof vi.fn>;

export interface DbChain {
  values: MockFn;
  onConflictDoUpdate: MockFn;
  onConflictDoNothing: MockFn;
  set: MockFn;
  from: MockFn;
  leftJoin: MockFn;
  where: MockFn;
  groupBy: MockFn;
  having: MockFn;
  orderBy: MockFn;
  limit: MockFn;
  returning: MockFn;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a chainable mock that simulates Drizzle ORM's query builder.
 *
 * Most methods return the chain itself for fluent chaining.
 * `where()` returns a thenable so `await db.select().from().where()` works.
 *
 * @param terminalResult - The value that awaiting the chain resolves to.
 */
export function createChainableProxy(terminalResult: unknown = []): DbChain {
  const chain: DbChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    onConflictDoNothing: vi.fn(),
    set: vi.fn(),
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    having: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    returning: vi.fn(),
  };

  // Build a thenable wrapper that spreads the chain's actual methods
  // so test overrides (e.g. chain.returning.mockResolvedValueOnce) work
  const makeThenable = () => ({
    ...chain,
    then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
      Promise.resolve(terminalResult).then(resolve, reject),
  });

  const methods: (keyof DbChain)[] = [
    "values", "onConflictDoUpdate", "onConflictDoNothing",
    "set", "from", "leftJoin",
  ];
  for (const m of methods) {
    chain[m].mockImplementation(() => chain);
  }

  // Terminal methods return thenables so `await db.insert().values().returning()` works
  // and `await db.select().from().where().orderBy()` works
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.orderBy.mockImplementation(() => makeThenable());
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.limit.mockImplementation(() => makeThenable());
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.returning.mockImplementation(() => makeThenable());

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.where.mockImplementation(() => makeThenable());

  // groupBy chains to having; having is terminal (thenable)
  chain.groupBy.mockImplementation(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.having.mockImplementation(() => makeThenable());

  return chain;
}

// ---------------------------------------------------------------------------
// Mock DB instance
// ---------------------------------------------------------------------------

export interface MockDb {
  insert: MockFn;
  select: MockFn;
  selectDistinct: MockFn;
  update: MockFn;
  delete: MockFn;
  transaction: MockFn;
  execute: MockFn;
}

/**
 * Create a fresh mock DB instance with insert/select/update/delete/transaction/execute.
 */
export function createMockDb(): MockDb {
  return {
    insert: vi.fn(),
    select: vi.fn(),
    selectDistinct: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  };
}

/**
 * Reset all mock DB chains to fresh state. Call this in beforeEach.
 * Returns the new selectChain for per-test mock setup.
 */
export function resetDbMocks(mockDb: MockDb): DbChain {
  const selectChain = createChainableProxy([]);
  const selectDistinctChain = createChainableProxy([]);
  mockDb.insert.mockReturnValue(createChainableProxy());
  mockDb.select.mockReturnValue(selectChain);
  mockDb.selectDistinct.mockReturnValue(selectDistinctChain);
  mockDb.update.mockReturnValue(createChainableProxy([]));
  mockDb.delete.mockReturnValue(createChainableProxy());
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async for Drizzle transaction mock
  mockDb.transaction.mockImplementation(async (fn: (tx: MockDb) => Promise<unknown>) => {
    return await fn(mockDb);
  });
  mockDb.execute.mockReset();
  return selectChain;
}
