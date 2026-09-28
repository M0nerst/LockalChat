# LockalChat

Локальный корпоративный мессенджер **local-first / P2P**: сотрудники общаются в одной LAN без обязательного центрального сервера.

Каждое устройство хранит свою копию SQLite, сообщения и файлы ходят напрямую между пирами (подписанные envelopes). Чтобы подключить второй компьютер, администратор экспортирует JSON-приглашение — облако не требуется.

## Что уже работает

- Организация, роли (ADMIN / USER), сессии, панель администратора (пользователи, устройства, журнал аудита, export invite)
- **Join по приглашению**: Admin → Export JSON → на втором ПК «Подключиться» → тот же логин/пароль
- **LAN P2P**: Rust `lockal-daemon` (mDNS + UDP discovery, TCP, WebSocket к UI)
- Личные чаты в трёхколоночном интерфейсе (навигация | список чатов | переписка): превью последнего сообщения, непрочитанные, статус «в сети» / «был(а) в сети…»
- Подписанные envelopes, outbox с повторной отправкой, **read receipts** (`chat.ack` delivered/read)
- Файлы чанками, SHA-256, превью картинок, пауза / продолжить / отмена, повтор неудавшейся отправки
- Directory sync пользователей по LAN и копии сообщений на **другие устройства того же аккаунта**
- Тема (светлая / тёмная / системная) и язык — в Настройках
- Windows-оболочка **Tauri 2**: установщики MSI/NSIS, иконка из `logo.png`, sidecar-daemon стартует после входа и **останавливается при закрытии окна**
- Если устройство уже «занято» организацией: **Настройки → Отвязать это устройство** (стирает только локальные данные)

Ещё не сделано: звонки (WebRTC), мобильный клиент, полноценный E2E payload, подпись установщика.

## Требования

- **Node.js 20+**
- Для нативного окна и daemon: **Rust toolchain** (см. [DEVELOPMENT.md](docs/DEVELOPMENT.md))
- Windows: WebView2 (обычно уже есть). Сборка MSI/NSIS тянет WiX/NSIS при первом `tauri:build`

## Быстрый старт (разработка)

```bash
npm install
npm start
```

Откройте http://localhost:5173. При входе dev-сервер сам поднимает `lockal-daemon` — отдельный терминал для daemon **не нужен**. Пошаговые сценарии (два браузера, два ПК): [docs/QUICKSTART.md](docs/QUICKSTART.md).

При первом `npm start` / `npm run build` в `apps/desktop/public/` копируется `sql-wasm.wasm`. Без него окно может остаться белым.

## Сборка и проверка

```bash
npm test          # vitest (~28 тестов)
npm run lint
npm run build
```

## Production Windows

```bash
npm install
npm run build
cd apps/desktop
npm run prepare:sidecar    # release lockal-daemon.exe → src-tauri/bin
npm run tauri:build
```

Артефакты в `apps/desktop/src-tauri/target/release/`:

| Файл | Назначение |
|------|------------|
| `bundle/nsis/LockalChat_0.1.0_x64-setup.exe` | установщик для передачи другому человеку |
| `bundle/msi/LockalChat_0.1.0_x64_en-US.msi` | MSI |
| `lockalchat-desktop.exe` | portable-запуск (daemon всё равно должен лежать рядом как sidecar) |

Иконка приложения собирается из корневого `logo.png` (`npx tauri icon ../../logo.png` из `apps/desktop`).

## Как передать коллеге

1. Отправьте **NSIS** `LockalChat_0.1.0_x64-setup.exe` (не один только `.exe` из `release/` без sidecar).
2. На своём ПК: Панель администратора → пользователь → **Экспорт invite** (`lockal-invite-….json`) и пароль (отдельным каналом).
3. Коллега ставит приложение → **Подключиться** → файл JSON + логин + пароль + имя устройства.
4. Если видит «уже подключено к организации» — **Настройки → Отвязать это устройство**, затем Join снова. Либо просто **войти**, если Join уже прошёл раньше.

Оба компьютера должны быть в **одной LAN**. VPN/TUN LockalChat не поднимает.

## Первая организация

1. Запуск → **Создать организацию** (название, admin, пароль, имя устройства).
2. Сохраните отпечаток организации — его можно сверить в invite JSON перед входом на втором ПК.
3. Новых людей создаёт администратор; им выдаётся invite-файл, а не «регистрация в облаке».

## Возможности (статус)

| Функция | Статус |
|--------|--------|
| LAN discovery | Да (mDNS + UDP) |
| Сообщения P2P | Да (TCP + Ed25519 envelopes, read receipts, unread) |
| Файлы | Да (chunks, hash, pause/resume/cancel/retry) |
| Multi-device sync | Да (копия на другие устройства того же пользователя) |
| Join по invite JSON | Да |
| Audio/Video (WebRTC) | План |
| Mobile (Expo) | План (заготовка `apps/mobile`) |

## Документация

- [QUICKSTART.md](docs/QUICKSTART.md) — проверка UI, LAN, два браузера
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — слои, monorepo, схема
- [PROTOCOL.md](docs/PROTOCOL.md) — envelopes и типы сообщений
- [NETWORKING.md](docs/NETWORKING.md) — daemon, порты, discovery
- [SECURITY.md](docs/SECURITY.md)
- [DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [TESTING.md](docs/TESTING.md)

## Лицензия

Proprietary / уточните у владельца репозитория.
