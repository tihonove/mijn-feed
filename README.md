# mijn-feed

Сервер и приложение персональной ленты. Что это и как устроено — [DESIGN.md](DESIGN.md).

## Запуск локально

    cp .env.example .env      # вписать OWNER_EMAILS, PRODUCER_TOKEN; DEV_LOGIN=1 для входа без Google
    npm install
    npm run build             # React-приложение → dist/app
    npm start                 # сервер на http://localhost:3000, база и медиа в ./data

Вход в разработке: открыть http://localhost:3000/auth/dev. Для разработки приложения с горячей
перезагрузкой: `npm run dev` (сервер) и `npm run dev:app` (Vite на :5173, проксирует API).

## Как положить контент

Все запросы с заголовком `Authorization: Bearer <PRODUCER_TOKEN>`.

    # заметка с гранями и подачами
    curl -H "$AUTH" -H 'content-type: application/json' localhost:3000/v1/nl/notes -d '{
      "id": "fiets", "kind": "word", "level": "A1", "tags": ["vervoer"],
      "fields": { "word": "fiets", "article": "de", "meaning": "велосипед",
                  "example": { "nl": "Ik fiets naar mijn werk.", "ru": "Я еду на работу на велосипеде." } },
      "facets": [
        { "facet": "recognize", "presentations": [ { "html": "<h1 class=\"word\">fiets</h1>", "audio": "/media/….mp3",
                                                     "meta": { "tint": "mustard", "say": "De fiets." } } ] },
        { "facet": "produce" },
        { "facet": "listen" }
      ]}'
    # новая подача к старой грани
    curl -H "$AUTH" -H 'content-type: application/json' localhost:3000/v1/nl/facets/<facetId>/presentations -d '{"html":"…"}'
    # разовые карточки других потоков
    curl -H "$AUTH" -H 'content-type: application/json' localhost:3000/v1/streams/news/items -d '[{"html":"…","expiresAt":1793500000000}]'
    # файл (mp3, png…) → {"url":"/media/<hash>.mp3"}
    curl -H "$AUTH" -H 'content-type: audio/mpeg' --data-binary @word.mp3 localhost:3000/v1/media
    # что нужно производителю: что скоро к повтору, где нет подач, покрытие тегов
    curl -H "$AUTH" localhost:3000/v1/nl/state

Грань без подачи показывается встроенной простой карточкой. Подача — HTML‑фрагмент; оболочка добавляет
базовые стили (классы `.word .ipa .meaning .ex .nl .ru .eyebrow .stage .caption .chips`) и мостик `card`:
`card.on("active", fn)`, `card.send({type:"play"})`, `card.send({type:"answer", correct:true})`.
Пока карточка на экране, на `<html>` висит класс `active` — на него вешаются CSS‑анимации.
В `meta` подачи: `tint` (oranje | teal | mustard | pink | lilac | mint | любой цвет), `say` (текст для озвучки,
если нет mp3), `title`.

## Проверки

    npm test                  # vitest
    npm run test:coverage     # с храповиком покрытия (пороги в vitest.config.ts только растут)
    npm run typecheck
    npm run lint

## Переменные окружения

См. `.env.example`. `PUBLIC_ORIGIN=https://feed.tihonove.dev` в проде (куки Secure, redirect URI для Google).

## Деплой

Живёт в кластере tihonove.dev как https://feed.tihonove.dev, зарегистрирован в
[tihonove.dev-apps](https://github.com/tihonove/tihonove.dev-apps) (`apps/mijn-feed.yaml`).

- `Dockerfile`: сборка приложения и бандла сервера (`npm run build`), в рантайме только `dist/`.
- `deploy/`: kustomize‑манифесты, которые Flux применяет из ветки `main`. Диск `/data` (sqlite и медиа)
  на PVC `local-path`. Секреты в `deploy/secrets.enc.yaml` зашифрованы sops ключами кластера и владельца:
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PRODUCER_TOKEN`.
- CI (`.github/workflows/ci.yaml`): тесты и линт на каждый push и PR; на `main` собирает образ
  `ghcr.io/tihonove/mijn-feed:<sha>-<run>` под amd64 и arm64 и коммитит тег в `deploy/kustomization.yaml`.
  Этот коммит и есть деплой, `git revert` его откатывает.
