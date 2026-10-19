# Помощник

Личный голосовой помощник: большая кнопка записи, текстовый чат, вложения файлов и фото, озвучка ответов. Фронт: Angular 22 PWA (`web/`). Сервер с Claude: Go (`server/`).

## Сервер (из `server/`)

```bash
go run .           # слушает :8080, читает server/.env
go test ./...      # юнит-тесты
```

Переменные окружения (локально можно в `server/.env`, на хостинге в его настройках):

| Переменная | Назначение |
|---|---|
| `ANTHROPIC_API_KEY` | ключ Anthropic, обязателен |
| `ACCESS_PASSWORD` | пароль доступа, не короче 8 символов, обязателен |
| `PORT` | порт, по умолчанию 8080 (хостинг задаёт сам) |
| `ALLOWED_ORIGINS` | адреса фронта через запятую для CORS, по умолчанию Pages и localhost:4200 |
| `HELPER_MODEL` | модель, по умолчанию `claude-sonnet-5-5` |
| `DATABASE_URL` | строка подключения Postgres (Neon) для истории и журнала ошибок, необязательна: без неё сервер работает, но ничего не сохраняет (см. раздел «История и журнал ошибок») |

API: `POST /api/chat` (multipart: `text`, `history` как JSON `[{role,text}]`, `files`), заголовок `Authorization: Bearer <пароль>`, ответ `{"reply": "..."}`. `GET /healthz` для проверки хостингом. Фронт запоминает пароль в `localStorage` и просит ввести его заново при ответе 401.

Адрес боевого сервера задаётся в `web/src/app/constants/api.constants.ts` (`API_PRODUCTION_URL`), в dev-режиме фронт ходит на `http://localhost:8080`.

## История и журнал ошибок (Postgres)

Сервер пишет в Postgres, если задана `DATABASE_URL` (бесплатная база на Neon, строка вида `postgres://user:pass@host/db?sslmode=require`). Таблицы создаются сами при старте из `server/internal/store/migrations/*.sql` (применённые миграции помнит таблица `schema_migrations`). Запись идёт в фоне: если база недоступна, чат продолжает работать, а в логе сервера появляется предупреждение.

| Таблица | Что хранит |
|---|---|
| `messages` | все реплики чата приложения (`source=app`, беседа = `conversation`, меняется кнопкой «Очистить»); через `POST /api/ingest` можно загрузить реплики из других источников |
| `events` | запросы чата и пакеты загрузки |
| `error_log` | ошибки сервера (всё, что пишется в лог на уровне ERROR, паники) и ошибки приложения в браузере (`source=client`) |

Чтение (заголовок `Authorization: Bearer <пароль>`): `GET /api/history?source=&conversation=&limit=`, `GET /api/events?kind=&limit=`, `GET /api/errors?limit=`. Запись: `POST /api/ingest` (`{source, conversationId, messages:[{externalId, role, text, at}]}`, повтор с тем же `externalId` не создаёт дубль) и `POST /api/client-error`.

## Команды (из `web/`)

```bash
npm start          # dev-сервер http://localhost:4200 (service worker выключен)
npm run build      # боевая сборка в dist/web/browser (service worker активен)
npm test           # юнит-тесты
```

Проверить PWA локально:

```bash
npm run build
npx http-server dist/web/browser -p 4300 -c-1
```

## Версионирование

Версия повышается при каждом коммите хуком `.githooks/pre-commit` (`web/scripts/bump-version.mjs`): правит `web/package.json` и `web/src/app/version.ts`. Хук подключается сам при `npm install` (скрипт `prepare`), либо вручную: `git config core.hooksPath .githooks`.

## Обновления PWA

При каждой загрузке и при возврате на вкладку приложение проверяет новую версию (`AppUpdate`). Найденная версия применяется перезагрузкой, когда пользователь не пишет сообщение, не ждёт ответ и не записывает голос.

## Публикация на GitHub Pages

Workflow `.github/workflows/deploy.yml` собирает `web/` с `--base-href=/<имя-репозитория>/` и публикует на Pages при пуше в `master` или `main`. Pages на бесплатном плане требуют публичный репозиторий. Один раз включить Pages через workflow:

```bash
gh api -X POST repos/StarcevAlexander/post-helper/pages -f build_type=workflow
```

Ключ Anthropic лежит только в `server/.env` (в `.gitignore`) и в переменных окружения хостинга сервера, во фронт и в репозиторий он не попадает.
