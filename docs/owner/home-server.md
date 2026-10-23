# Сервер и база на своём ПК

Схема: Go-сервер и Postgres работают на вашем ПК круглые сутки, телефоны мастеров ходят к нему через Tailscale Funnel (публичный https-адрес `имя.ts.net`, порты на роутере открывать не нужно). Сайт остаётся на GitHub Pages. Воркер референсов и сервер живут на одной машине.

Цена выбора: если ПК выключен или нет интернета, приложение не работает у всех мастеров, а данные лежат только на вашем диске. Поэтому копии базы обязательны.

## Что уже сделано

- Postgres 18 стоит в `C:\post-helper-db` (программа в `env`, данные в `data`, журналы в `data\log`). Установщик EnterpriseDB в РФ отдаёт 403, поэтому он взят из conda-forge через micromamba, без администратора и без Docker.
- База `posthelper`, пользователь `posthelper`, слушает только `127.0.0.1:5432`. Адрес базы лежит в `C:\post-helper-db\database-url.txt` (доступ только вам). Пароль суперпользователя `postgres` в журнале сессии и нигде в проекте не хранится, при необходимости смените его командой `ALTER ROLE`.
- Postgres запускает задача Планировщика `PostHelperPostgres` (сейчас при входе в систему, после шага 2 при включении ПК).
- Серверные тесты с Postgres (`TEST_DATABASE_URL`) прогнаны на этой базе: миграции 001–008, заявки с референсами, очередь референсов проходят.

## 1. Секреты сервера

`powershell -File tools/server/env.ps1` (обычное окно PowerShell). Скрипт сам подставит адрес базы, сгенерирует пароль владельца и токен агента, если нажать Enter, и создаст `tools/owner/.env` для команд владельца. Нужно вручную только `ANTHROPIC_API_KEY` (возьмите в панели Render, Environment). Telegram-значения скрипт сохраняет, если они уже есть.

## 2. Всё, что требует прав администратора

`powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-File','C:\Users\master\WebstormProjects\post_helper\tools\server\setup-admin.ps1'"` (откроется окно подтверждения Windows). Скрипт за один проход:
- переставляет запуск Postgres на «при включении ПК, без входа в систему»;
- собирает `server\post-helper.exe` и ставит задачу автозапуска сервера с перезапуском при падении (`tools/server/autostart.ps1`);
- ставит ежедневную копию базы в 04:00 в `C:\post-helper-backups`, хранятся 14 последних (`tools/server/backup.ps1`);
- отключает сон и гибернацию;
- ставит Tailscale (`winget`).

Он остановится с понятной ошибкой, если в `server\.env` нет ключа Claude, пароля владельца или адреса базы. Состояние: `powershell -File tools/server/autostart.ps1 status`, копии: `powershell -File tools/server/backup.ps1 status`. После правок сервера повторите `autostart.ps1 install` от администратора.

## 3. Tailscale Funnel

1. Войдите в Tailscale своей учётной записью (`tailscale up`, откроется браузер).
2. В консоли администратора Tailscale включите HTTPS-сертификаты (раздел DNS) и разрешите Funnel для этого ПК (правила доступа, атрибут `funnel`).
3. `tailscale funnel --bg 8080` (синтаксис зависит от версии, сверьтесь с `tailscale funnel --help`). Адрес покажет `tailscale funnel status`: `https://имя-пк.имя-сети.ts.net`.
4. Проверка с телефона через мобильный интернет: `https://имя-пк.имя-сети.ts.net/healthz` отвечает пустым 204.

## 4. Переключить приложение

1. В `web/src/app/constants/api.constants.ts` заменить `API_PRODUCTION_URL` на адрес из шага 3, закоммитить и запушить. Сайт обновится сам, мастерам ничего делать не нужно.
2. В `tools/agent/.env` задать `AGENT_SERVER=http://127.0.0.1:8080` и `AGENT_TOKEN` из `server\.env`: воркер референсов и агент ходят на тот же ПК.
3. Render после переезда не включайте параллельно: у него отдельная база Neon, данные мастеров разойдутся. Для отката верните прежний `API_PRODUCTION_URL`, но вы вернётесь к старым данным Neon.

## 5. Перенос старых данных из Neon (если нужны)

```
C:\post-helper-db\env\Library\bin\pg_dump --format=custom --file neon.dump "<строка подключения Neon>"
C:\post-helper-db\env\Library\bin\pg_restore --no-owner --role posthelper --dbname "<адрес из database-url.txt>" neon.dump
```

Делайте до первого запуска нового сервера, пока база пустая.

## 6. Вручную остаётся

- BIOS: включить «Восстановление после потери питания» (AC Power Recovery: Power On), чтобы ПК включался после отключения света.
- Windows Update: «Часы активности» на ночь, чтобы перезагрузка не пришлась на день. После перезагрузки Postgres и сервер поднимаются сами.
- Раз в неделю копируйте `C:\post-helper-backups` на другой диск или в облако: копия на том же диске не спасёт от его поломки.

Восстановление из копии: `pg_restore --clean --if-exists --no-owner --dbname "<адрес>" файл.dump`.
