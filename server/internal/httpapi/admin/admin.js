const API = '/api/admin';

const STATUS = {
  queued: ['в очереди', 'warn'],
  running: ['обрабатывается', 'warn'],
  done: ['готово', 'ok'],
  failed: ['не получилось', 'bad'],
  new: ['новая', 'warn'],
  ready: ['план выдан', 'ok'],
  actual: ['актуально', 'ok'],
  outdated: ['неактуально', 'bad'],
  info: ['сообщение', ''],
};

const NOTICE_REASONS = {
  planRemoved: 'плана больше нет',
  planReplaced: 'пришёл новый план',
  refsGone: 'референсы убраны',
  mediaGone: 'контент удалён',
  dayPassed: 'день съёмки прошёл',
  scheduleChanged: 'дни съёмки изменились',
  itemRemoved: 'публикацию убрали',
  published: 'публикация сделана',
  moved: 'публикация перенесена',
};

const KINDS = { photo: 'фото', video: 'видео' };
const FORMATS = { reels: 'Reels', post: 'Пост', stories: 'Сторис' };

const TABS = [
  ['media', 'Контент'],
  ['plan', 'План'],
  ['intakes', 'Заявки'],
  ['feedback', 'Обратная связь'],
  ['notices', 'Уведомления'],
  ['profile', 'Профиль'],
];

const state = {
  masters: [],
  media: [],
  intakes: [],
  feedback: [],
  selected: undefined,
  tab: 'media',
  master: undefined,
};

const mastersList = document.getElementById('masters');
const main = document.getElementById('main');
const search = document.getElementById('search');

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = value;
    } else if (key.startsWith('on')) {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child !== undefined && child !== null && child !== false) {
      node.append(child instanceof Node ? child : String(child));
    }
  }
  return node;
}

function badge(status) {
  const [label, tone] = STATUS[status] ?? [status, ''];
  return el('span', { class: tone ? `badge badge--${tone}` : 'badge' }, label);
}

function stamp(value) {
  if (!value || value.startsWith('0001-')) {
    return 'никогда';
  }
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

async function get(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

function renderMasters() {
  const query = search.value.trim().toLowerCase();
  const visible = state.masters.filter((master) =>
    [master.name, master.city, master.id].some((field) => (field ?? '').toLowerCase().includes(query)),
  );
  mastersList.replaceChildren(
    ...visible.map((master) => {
      const uploads = state.media.filter((item) => item.masterId === master.id).length;
      return el(
        'li',
        {},
        el(
          'button',
          {
            class: 'master',
            type: 'button',
            'aria-current': master.id === state.selected ? 'true' : undefined,
            onclick: () => select(master.id),
          },
          el('div', { class: 'master__name' }, master.name, master.disabled ? ' (отключён)' : ''),
          el(
            'div',
            { class: 'master__meta' },
            [master.city, `вход ${stamp(master.lastSeenAt)}`, uploads ? `контент ${uploads}` : ''].filter(Boolean).join(' · '),
          ),
        ),
      );
    }),
  );
}

async function select(id) {
  state.selected = id;
  location.hash = `#${id}/${state.tab}`;
  renderMasters();
  main.replaceChildren(el('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const [exported, notices] = await Promise.all([get(`/masters/${id}/export`), get(`/masters/${id}/notifications`)]);
    state.master = { exported, notices };
    renderMaster();
  } catch (error) {
    main.replaceChildren(el('p', { class: 'error' }, `Не удалось загрузить мастера: ${error.message}`));
  }
}

function renderMaster() {
  const { exported } = state.master;
  const master = exported.master;
  const id = master.id;
  const counts = {
    media: state.media.filter((item) => item.masterId === id).length,
    plan: exported.state?.data?.calendar?.items?.length ?? 0,
    intakes: state.intakes.filter((item) => item.masterId === id).length,
    feedback: state.feedback.filter((item) => item.masterId === id).length,
    notices: state.master.notices.length,
  };
  main.replaceChildren(
    el(
      'header',
      { class: 'head' },
      el('h2', { class: 'head__name' }, master.name),
      el(
        'p',
        { class: 'head__meta' },
        [master.city || 'город не указан', master.timezone, `создан ${stamp(master.createdAt)}`, `последний вход ${stamp(master.lastSeenAt)}`, `id ${id}`]
          .filter(Boolean)
          .join(' · '),
      ),
    ),
    el(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map(([key, label]) =>
        el(
          'button',
          {
            class: 'tab',
            type: 'button',
            role: 'tab',
            'aria-selected': String(state.tab === key),
            onclick: () => {
              state.tab = key;
              location.hash = `#${id}/${key}`;
              renderMaster();
            },
          },
          label,
          counts[key] !== undefined ? el('span', { class: 'count' }, counts[key]) : undefined,
        ),
      ),
    ),
    el('section', { role: 'tabpanel' }, VIEWS[state.tab](id, exported)),
  );
}

function mediaView(id) {
  const items = state.media.filter((item) => item.masterId === id);
  if (items.length === 0) {
    return el('p', { class: 'hint' }, 'Мастер ничего не отправлял в обработку.');
  }
  return el(
    'div',
    { class: 'grid' },
    items.map((item) => {
      const file = `${API}/media/${encodeURIComponent(item.id)}/file`;
      const preview =
        item.status !== 'done'
          ? el('div', { class: 'placeholder' }, STATUS[item.status]?.[0] ?? item.status)
          : item.kind === 'video'
            ? el('video', { class: 'preview', src: file, controls: true, preload: 'metadata', playsinline: true })
            : el('img', { class: 'preview', src: file, alt: `Готовое фото ${item.key}`, loading: 'lazy' });
      return el(
        'article',
        { class: 'card' },
        preview,
        el('p', { class: 'card__title' }, `${item.key} · ${KINDS[item.kind] ?? item.kind}, ${FORMATS[item.format] ?? item.format} `, badge(item.status)),
        el('p', { class: 'card__meta' }, `${stamp(item.createdAt)} · ${item.source.name}, ${(item.source.size / 1024 / 1024).toFixed(1)} МБ`),
        item.note ? el('p', { class: 'card__text' }, `Текст мастера: ${item.note}`) : undefined,
        item.result?.note ? el('p', { class: 'card__text' }, `Обработка: ${item.result.note}`) : undefined,
        item.result?.caption ? el('p', { class: 'card__text' }, `Продающая подпись:\n${item.result.caption}`) : undefined,
        item.redos > 0 ? el('p', { class: 'card__text' }, `Переделок: ${item.redos}${item.wish ? `, пожелание: ${item.wish}` : ''}`) : undefined,
        item.error ? el('p', { class: 'card__text error' }, item.error) : undefined,
        el(
          'div',
          { class: 'links' },
          item.status === 'done' ? el('a', { href: file, download: '' }, 'Скачать готовое') : undefined,
          el('a', { href: `${file}?of=source`, download: '' }, 'Скачать оригинал'),
        ),
      );
    }),
  );
}

function planView(id, exported) {
  const calendar = exported.state?.data?.calendar;
  if (!calendar?.items?.length) {
    return el('p', { class: 'hint' }, 'Плана нет.');
  }
  const done = calendar.items.filter((item) => item.done).length;
  return el(
    'div',
    {},
    el('p', { class: 'hint' }, `План с ${calendar.startedOn}: опубликовано ${done} из ${calendar.items.length}, публикации в ${calendar.schedule?.publishTime ?? '?'}`),
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ['Дата', 'Время', 'Формат', 'Рубрика', 'Идея', 'Статус'].map((title) => el('th', {}, title)))),
      el(
        'tbody',
        {},
        [...calendar.items]
          .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
          .map((item) =>
            el(
              'tr',
              { class: item.done ? 'done' : undefined },
              el('td', {}, item.date, item.movedFrom ? ` (было ${item.movedFrom})` : ''),
              el('td', {}, item.time),
              el('td', {}, FORMATS[item.format] ?? item.format),
              el('td', {}, item.pillar),
              el('td', {}, item.idea),
              el('td', {}, item.done ? badge('done') : ''),
            ),
          ),
      ),
    ),
  );
}

function intakesView(id) {
  const items = state.intakes.filter((item) => item.masterId === id);
  if (items.length === 0) {
    return el('p', { class: 'hint' }, 'Заявок нет.');
  }
  return items.map((item) =>
    el(
      'article',
      { class: 'card' },
      el('p', { class: 'card__title' }, item.review ? 'Просьба об итогах месяца ' : 'Заявка на план ', badge(item.status)),
      el('p', { class: 'card__meta' }, `${stamp(item.createdAt)}${item.city ? ` · ${item.city}` : ''}`),
      el(
        'div',
        { class: 'links' },
        [...(item.networks ?? []), ...(item.references ?? [])].map((network) =>
          el('a', { href: network.url, target: '_blank', rel: 'noopener noreferrer' }, `${network.platform}: ${network.url}`),
        ),
      ),
      item.goalTitles?.some(Boolean) ? el('p', { class: 'card__text' }, `Цели: ${item.goalTitles.filter(Boolean).join(', ')}`) : undefined,
      item.note ? el('p', { class: 'card__text' }, `Пожелания: ${item.note}`) : undefined,
      item.replyNote ? el('p', { class: 'card__text' }, `Ответ: ${item.replyNote}`) : undefined,
    ),
  );
}

function feedbackView(id) {
  const items = state.feedback.filter((item) => item.masterId === id);
  if (items.length === 0) {
    return el('p', { class: 'hint' }, 'Сообщений нет.');
  }
  return items.map((item) =>
    el(
      'article',
      { class: 'card' },
      el('p', { class: 'card__meta' }, [stamp(item.createdAt), item.email, item.contact, item.itemLabel ? `замена идеи: ${item.itemLabel}` : ''].filter(Boolean).join(' · ')),
      el('p', { class: 'card__text' }, item.text),
    ),
  );
}

function noticesView() {
  const items = state.master.notices;
  if (items.length === 0) {
    return el('p', { class: 'hint' }, 'Уведомлений за 60 дней не было.');
  }
  return items.map((item) =>
    el(
      'article',
      { class: 'card' },
      el('p', { class: 'card__title' }, `${item.title} `, badge(item.state)),
      el('p', { class: 'card__meta' }, [stamp(item.sentAt), NOTICE_REASONS[item.reason], item.movedTo ? `на ${item.movedTo}` : '', item.link].filter(Boolean).join(' · ')),
      item.body ? el('p', { class: 'card__text' }, item.body) : undefined,
    ),
  );
}

function profileView(id, exported) {
  const data = exported.state?.data ?? {};
  const strategy = data.strategy;
  const recommendations = data.recommendations ?? [];
  const reviews = data.monthReviews ?? [];
  const master = exported.master;
  return el(
    'div',
    {},
    el(
      'dl',
      { class: 'facts' },
      el('dt', {}, 'Расход ИИ'),
      el('dd', {}, `сегодня ${master.usageToday ?? 0}, всего ${master.usageTotal ?? 0}`),
      el('dt', {}, 'Версия данных'),
      el('dd', {}, `${exported.state?.version ?? 0}, обновлены ${stamp(exported.state?.updatedAt)}`),
      el('dt', {}, 'Выгрузка'),
      el('dd', {}, el('a', { href: `${API}/masters/${encodeURIComponent(id)}/export`, download: '' }, 'скачать всё о мастере (JSON)')),
    ),
    el('h3', { class: 'section' }, 'Стратегия'),
    strategy
      ? el(
          'article',
          { class: 'card' },
          el('p', { class: 'card__text' }, strategy.summary),
          strategy.positioning ? el('p', { class: 'card__text' }, `Позиционирование: ${strategy.positioning}`) : undefined,
          strategy.pillars?.length ? el('p', { class: 'card__text' }, `Рубрики: ${strategy.pillars.map((pillar) => pillar.title).join(', ')}`) : undefined,
        )
      : el('p', { class: 'hint' }, 'Стратегии нет.'),
    el('h3', { class: 'section' }, `Рекомендации (${recommendations.filter((item) => item.done).length} из ${recommendations.length} сделано)`),
    recommendations.length
      ? el(
          'table',
          {},
          el(
            'tbody',
            {},
            [...recommendations]
              .sort((a, b) => b.importance - a.importance)
              .map((item) => el('tr', { class: item.done ? 'done' : undefined }, el('td', {}, `${item.importance}%`), el('td', {}, item.text), el('td', {}, item.done ? badge('done') : ''))),
          ),
        )
      : el('p', { class: 'hint' }, 'Рекомендаций нет.'),
    el('h3', { class: 'section' }, 'Итоги месяца'),
    reviews.length
      ? reviews.map((review) =>
          el(
            'article',
            { class: 'card' },
            el('p', { class: 'card__title' }, `${review.from} – ${review.to}: ${review.done} из ${review.planned}`),
            el('p', { class: 'card__text' }, review.headline),
          ),
        )
      : el('p', { class: 'hint' }, 'Итогов нет.'),
  );
}

const VIEWS = {
  media: mediaView,
  plan: planView,
  intakes: intakesView,
  feedback: feedbackView,
  notices: noticesView,
  profile: profileView,
};

async function start() {
  try {
    const [masters, media, intakes, feedback] = await Promise.all([
      get('/masters'),
      get('/media'),
      get('/intakes?limit=200'),
      get('/feedback'),
    ]);
    state.masters = [...(masters ?? [])].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
    state.media = media ?? [];
    state.intakes = intakes ?? [];
    state.feedback = feedback ?? [];
  } catch (error) {
    main.replaceChildren(el('p', { class: 'error' }, `Сервер не ответил: ${error.message}`));
    return;
  }
  renderMasters();
  const [id, tab] = location.hash.slice(1).split('/');
  if (tab && VIEWS[tab]) {
    state.tab = tab;
  }
  if (id && state.masters.some((master) => master.id === id)) {
    await select(id);
  }
}

search.addEventListener('input', renderMasters);
void start();
