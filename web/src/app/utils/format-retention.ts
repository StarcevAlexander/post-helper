export function formatRetention(days: number): string {
  if (days <= 0) {
    return 'без ограничения срока';
  }
  if (days % 365 === 0) {
    const years = days / 365;
    const lastTwo = years % 100;
    const last = years % 10;
    const word =
      lastTwo >= 11 && lastTwo <= 14
        ? 'лет'
        : last === 1
          ? 'год'
          : last >= 2 && last <= 4
            ? 'года'
            : 'лет';
    return `${years} ${word}`;
  }
  return `${days} дн.`;
}
