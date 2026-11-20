# ALEX G — Гитара, Аранжировки, Афиши и Мерч

Авторский сайт-портфолио музыканта и визуального автора.

## Быстрый запуск локально

```bash
node server.js
```
Сайт откроется по адресу `http://localhost:3000`.

---

## Бесплатная выгрузка в интернет через GitHub

Проект уже полностью подготовлен и содержит первый Git-коммит со всеми вашими треками, обложками и афишами.

### Вариант 1: GitHub Pages (100% бесплатно навсегда, работает 24/7 без «засыпания»)
В проект уже встроен авто-деплой [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

1. Создайте новый пустой репозиторий на [github.com/new](https://github.com/new) (например, `alexg-music`).
2. В терминале в папке проекта привяжите репозиторий и отправьте код:
   ```bash
   git remote add origin https://github.com/<ВАШ_ЛОГИН>/alexg-music.git
   git push -u origin main
   ```
3. На GitHub зайдите в настройки репозитория: **Settings → Pages → Build and deployment → Source** и выберите **GitHub Actions**.
4. Через 30 секунд ваш сайт будет доступен по ссылке `https://<ВАШ_ЛОГИН>.github.io/alexg-music/`.

> **Совет:** Если вы добавили новые треки или поменяли фото локально через `node server.js` в Кабинете автора, просто выполните `git add . && git commit -m "update" && git push` — и сайт на GitHub Pages автоматически обновится со всеми новыми песнями и картинками.

---

### Вариант 2: Render.com (Бесплатный Node.js сервер с работающим Кабинетом автора онлайн)
В проекте уже настроен файл [`render.yaml`](render.yaml).

1. Отправьте репозиторий на GitHub (шаги 1–2 выше).
2. Зайдите на [render.com](https://render.com) (вход через GitHub) → нажмите **New + → Web Service** → выберите ваш репозиторий.
3. Render автоматически подхватит команду запуска `node server.js` и тариф **Free**, после чего выдаст вам ссылку вида `https://alexg-portfolio.onrender.com`.
