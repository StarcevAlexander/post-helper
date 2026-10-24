function parts(version: string): number[] | undefined {
  const numbers = version.split('.').map(Number);
  return numbers.length === 3 && numbers.every((value) => Number.isInteger(value) && value >= 0)
    ? numbers
    : undefined;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parts(candidate);
  const now = parts(current);
  if (!next || !now) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) {
      return next[index] > now[index];
    }
  }
  return false;
}
