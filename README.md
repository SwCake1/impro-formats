# Что сыграем?

Статический каталог импровизационных форматов. Данные загружаются при открытии страницы из публичной Google-таблицы; последний успешный набор сохраняется локально на случай сетевой ошибки.

## Локальный запуск

```bash
npm install
npm run dev
```

Проверки:

```bash
npm test
npm run build
```

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` собирает и публикует `dist` при push в `main`. В настройках отдельного GitHub-репозитория выберите **Settings → Pages → Source → GitHub Actions**.

Проект использует относительный `base`, поэтому работает и на корневом домене, и по адресу вида `username.github.io/repository/`.
