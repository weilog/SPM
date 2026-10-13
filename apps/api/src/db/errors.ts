function codes(error: unknown, depth = 0): string[] {
  if (depth > 3 || typeof error !== 'object' || error === null) return [];
  const value = error as Record<string, unknown>;
  return [value.code, value.originalCode].filter((code): code is string => typeof code === 'string')
    .concat(...['cause', 'meta', 'driverAdapterError'].map(key => codes(value[key], depth + 1)));
}

export function isTransactionConflict(error: unknown): boolean {
  // Adapter errors thrown at COMMIT may carry a PG SQLSTATE rather than P2034.
  return codes(error).some(code => ['P2034', '40001', '40P01'].includes(code));
}

export function isDatabaseConflict(error: unknown): boolean {
  return isTransactionConflict(error) || codes(error).some(code => ['P2002', 'P2003', 'P2004', 'P2010', '23505', '23503', '23514'].includes(code));
}
