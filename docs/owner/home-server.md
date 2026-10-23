# Сервер и база на своём ПК

Схема: Go-сервер и Postgres работают на вашем ПК круглые сутки, телефоны мастеров ходят к нему через Tailscale Funnel (публичный https-адрес `имя.ts.net`, порты на роутере открывать не нужно). Сайт остаётся на GitHub Pages. Воркер референсов и сервер живут на одной машине.

Цена выбора: если ПК выключен или нет интернета, приложение не работает у всех мастеров, а данные лежат только на вашем диске. Поэтому копии базы обязательны (шаг 5).

## 1. Postgres как служба Windows

1. Скачать установщик PostgreSQL для Windows (postgresql.org, EnterpriseDB), поставить самую свежую версию, порт 5432, запомнить пароль суперпользователя. Установщик ставит службу, она стартует при включении ПК до входа в систему.
2. Создать базу и отдельного пользователя (в `C:\Program Files\PostgreSQL\<версия>\bin`):
   `psql -U postgres -c "CREATE ROLE posthelper LOGIN PASSWORD 'длинный-пароль'"`
   `psql -U postgres -c "CREATE DATABASE posthelper OWNER posthelper"`

## 2. Секреты сервера

`powershell -File tools/server/env.ps1` спрашивает значения со скрытым вводом и пишет `server/.env` (файл не попадает в git). Нужны `ANTHROPIC_API_KEY`, `ACCESS_PASSWORD` (пароль владельца), `DATABASE_URL`, `AGENT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Прежние значения скопируйте из панели Render. Адрес базы: `postgres://posthelper:пароль@127.0.0.1:5432/posthelper?sslmode=disable`. Миграции сервер накатывает сам при старте.

## 3. Перенос данных из Neon (если там есть что сохранять)

```
pg_dump --format=custom --file neon.dump "<строка подключения Neon>"
pg_restore --no-owner --role posthelper --dbname "<адрес локальной базы>" neon.dump
```

Версия `pg_dump` должна быть не старше версии базы на Neon.

## 4. Автозапуск сервера

PowerShell от имени администратора: `powershell -File tools/server/autostart.ps1 install`. Скрипт собирает `server/post-helper.exe`, ставит задачу Планировщика, которая стартует при включении ПК (без входа в систему), перезапускает сервер при падении и пишет `server/server.log`. `status` показывает состояние и ответ `healthz`, `uninstall` убирает задачу. После правок кода запустите `install` ещё раз: он пересоберёт exe.

## 5. Копии базы

`powershell -File tools/server/backup.ps1 install` ставит ежедневную копию в 04:00 в `C:\post-helper-backups` (хранятся 14 последних). Проверка: `powershell -File tools/server/backup.ps1 run`, потом `status`. Раз в неделю копируйте папку на другой диск или в облако: копия на том же диске не спасёт от поломки диска. Восстановление: `pg_restore --clean --if-exists --no-owner --dbname "<адрес>" файл.dump`.

## 6. Чтобы ПК не засыпал

PowerShell от имени администратора:
- `powercfg /change standby-timeout-ac 0` и `powercfg /hibernate off` (не спать).
- Обновления Windows: «Часы активности» на ночь, чтобы перезагрузка не пришлась на день. После перезагрузки сервер поднимается сам.
- В BIOS включить «Восстановление после потери питания» (AC Power Recovery: Power On), чтобы ПК включался после отключения света.

## 7. Tailscale Funnel

1. Установить Tailscale (tailscale.com), войти своей учётной записью.
2. В консоли администратора Tailscale (DNS) включить HTTPS-сертификаты, а в правилах доступа разрешить Funnel для этого ПК (атрибут `funnel`).
3. `tailscale funnel --bg 8080` (синтаксис зависит от версии: сверьтесь с `tailscale funnel --help`). Адрес покажет `tailscale funnel status`, он вида `https://имя-пк.имя-сети.ts.net`.
4. Проверка с телефона через мобильный интернет: `https://имя-пк.имя-сети.ts.net/healthz` должен вернуть пустой ответ 204.

## 8. Переключить приложение

1. В `web/src/app/constants/api.constants.ts` заменить `API_PRODUCTION_URL` на адрес из шага 7, закоммитить и запушить. Сайт обновится сам, мастерам ничего делать не нужно.
2. В `tools/agent/.env` и для `owner.mjs` указать `AGENT_SERVER`/`OWNER_SERVER` как `http://127.0.0.1:8080`: воркер референсов и владельческие команды теперь ходят на тот же ПК.
3. Render после переезда не включайте параллельно: у него отдельная база Neon, данные мастеров разойдутся. Для отката верните прежний `API_PRODUCTION_URL` и учтите, что вернётесь к старым данным Neon.

## 9. Проверка

`powershell -File tools/server/autostart.ps1 status` до и после перезагрузки ПК, затем создайте тестового мастера и отправьте заявку с телефона.
