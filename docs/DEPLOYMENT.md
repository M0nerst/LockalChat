# Deployment

## Dev / static UI

```bash
npm run build          # все пакеты + Vite dist
```

Локально UI: `npm start` → http://localhost:5173.

## Windows desktop (Tauri)

```bash
npm install
npm run build
cd apps/desktop
npm run prepare:sidecar   # cargo build --release -p lockal-daemon → src-tauri/bin
npm run tauri:build       # vite build + msi + nsis
```

Артефакты: `apps/desktop/src-tauri/target/release/`

| Файл | Кому отдавать |
|------|----------------|
| `bundle/nsis/LockalChat_0.1.0_x64-setup.exe` | **да** — обычный установщик для коллеги |
| `bundle/msi/LockalChat_0.1.0_x64_en-US.msi` | да, если в организации принят MSI |
| `lockalchat-desktop.exe` | только вместе с sidecar `lockal-daemon` и ресурсами бандла; один «голый» exe коллеге недостаточен |

Требования для **сборки**: Node 20+, Rust. Первый `tauri:build` качает WiX3 и NSIS в `%LOCALAPPDATA%`.

Требования для **запуска** у коллеги: Windows x64, WebView2 (как правило уже стоит). Установщик **не подписан** — SmartScreen может ругаться.

### Sidecar

- `save_daemon_config` пишет `daemon-config.json` в app data и сразу спавнит `lockal-daemon`
- Повторный запуск приложения поднимает daemon, если конфиг уже есть
- При закрытии окна процесс daemon **останавливается** (`RunEvent::Exit`) — не должен оставаться в фоне и не должен подменять VPN/маршрут
- Иконки бандла: `tauri.conf.json` → `bundle.icon`, исходник `logo.png`

### Подключение второго человека

1. Собрать и отдать NSIS.
2. На ПК администратора: создать пользователя → **Экспорт invite** (`lockal-invite-….json`).
3. На втором ПК: Подключиться → JSON + логин + пароль.
4. Конфликт «устройство уже в организации»: Настройки → **Отвязать это устройство** (локальный wipe) или обычный логин, если Join уже был.

Оба ПК — одна LAN.

## Платформы

| Platform | Target | Статус |
|----------|--------|--------|
| Windows | MSI/NSIS via Tauri | готово |
| macOS | .app / dmg | план |
| Linux | AppImage / deb | план |
| Android / iOS | Expo | план |
