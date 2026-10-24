const DAY_MS = 86_400_000;

function dayNumber(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function share(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? { planned: 0, done: 0 };
    group.planned += 1;
    group.done += item.done ? 1 : 0;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([name, group]) => ({ name, ...group, percent: share(group.done, group.planned) }));
}

export function buildReviewStats(exported, today) {
  const data = exported?.state?.data ?? {};
  const calendar = data.calendar;
  const items = Array.isArray(calendar?.items) ? calendar.items : [];
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const audits = Array.isArray(data.audit) ? data.audit : data.audit ? [data.audit] : [];
  const kits = data.kits && typeof data.kits === 'object' ? Object.keys(data.kits).length : 0;

  const base = {
    master: exported?.master?.name ?? '',
    today,
    hasPlan: items.length > 0,
    kitsReady: kits,
    weeklyReviews: reviews.map((review) => ({
      weekFrom: review.weekFrom,
      inquiries: review.answers?.inquiries,
      bestIdea: review.answers?.bestIdea,
      hard: review.answers?.hard,
      headline: review.result?.headline,
      nextFocus: review.result?.nextFocus,
      applied: Boolean(review.applied),
    })),
    monthReviews: Array.isArray(data.monthReviews) ? data.monthReviews : [],
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    audits: audits.map((audit) => ({ createdAt: audit.createdAt, summary: audit.result?.summary })),
    strategy: data.strategy,
    profile: data.onboarding?.answers,
  };
  if (items.length === 0) {
    return base;
  }

  const sorted = [...items].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const start = calendar.startedOn ?? first;
  const done = items.filter((item) => item.done).length;
  const due = items.filter((item) => item.date <= today);
  const dueDone = due.filter((item) => item.done).length;
  const weeks = groupBy(sorted, (item) => Math.max(0, Math.floor((dayNumber(item.date) - dayNumber(start)) / 7)) + 1).map(
    (week) => ({ ...week, name: `неделя ${week.name}` }),
  );

  return {
    ...base,
    startedOn: start,
    lastDate: last,
    daysLeft: Math.max(0, dayNumber(last) - dayNumber(today)),
    planFinished: last < today,
    total: items.length,
    done,
    donePercent: share(done, items.length),
    dueCount: due.length,
    dueDone,
    dueDonePercent: share(dueDone, due.length),
    overdue: due.filter((item) => !item.done).map((item) => ({ id: item.id, date: item.date, format: item.format, pillar: item.pillar, idea: item.idea })),
    byWeek: weeks,
    byFormat: groupBy(items, (item) => item.format),
    byPillar: groupBy(items, (item) => item.pillar),
  };
}

export function describeReviewStats(stats) {
  if (!stats.hasPlan) {
    return `Мастер ${stats.master || '?'}: календаря нет, сверять не с чем.`;
  }
  const lines = [
    `Мастер ${stats.master || '?'} · сегодня ${stats.today}`,
    `Календарь: ${stats.startedOn} … ${stats.lastDate} · ${stats.planFinished ? 'закончился' : `до конца ${stats.daysLeft} дн.`}`,
    `Отмечено «опубликовано»: ${stats.done} из ${stats.total} (${stats.donePercent}%), из наступивших по дате ${stats.dueDone} из ${stats.dueCount} (${stats.dueDonePercent}%)`,
    `Комплектов подготовлено: ${stats.kitsReady}`,
    'По неделям:',
    ...stats.byWeek.map((week) => `  • ${week.name}: ${week.done}/${week.planned} (${week.percent}%)`),
    'По форматам:',
    ...stats.byFormat.map((group) => `  • ${group.name}: ${group.done}/${group.planned} (${group.percent}%)`),
    'По рубрикам:',
    ...stats.byPillar.map((group) => `  • ${group.name}: ${group.done}/${group.planned} (${group.percent}%)`),
    stats.overdue.length > 0
      ? `Не отмечено, хотя срок прошёл (${stats.overdue.length}):\n${stats.overdue.map((item) => `  • ${item.date} ${item.format}: ${item.idea}`).join('\n')}`
      : 'Просроченных неотмеченных публикаций нет',
    stats.weeklyReviews.length > 0
      ? `Итоги недели от мастера:\n${stats.weeklyReviews.map((review) => `  • с ${review.weekFrom}: обращений ${review.inquiries ?? '—'}; лучшая идея: ${review.bestIdea || '—'}; было трудно: ${review.hard || '—'}`).join('\n')}`
      : 'Итогов недели мастер не заполнял',
    stats.recommendations.length > 0
      ? `Рекомендации по профилю: сделано ${stats.recommendations.filter((item) => item.done).length} из ${stats.recommendations.length}\n${stats.recommendations.map((item) => `  • [${item.done ? 'x' : ' '}] ${item.importance}% ${item.text}`).join('\n')}`
      : 'Рекомендаций по профилю пока нет',
    stats.audits.length > 0
      ? `Прежние разборы страницы: ${stats.audits.map((audit) => audit.createdAt).join(', ')}`
      : 'Прежних разборов страницы нет',
  ];
  return lines.join('\n');
}
