# Development

```bash
npm install
npm start            # desktop UI (Vite); daemon поднимается при входе
npm test             # vitest
npm run lint
npm run build
```

`npm start` и `npm run dev` — одно и то же (`apps/desktop`). `predev` / `prebuild` копируют `sql-wasm.wasm` в `apps/desktop/public/`.

## Desktop (Tauri 2)

```bash
cd apps/desktop
npm run prepare:sidecar   # release lockal-daemon → src-tauri/bin (Windows)
npm run tauri:dev         # окно + Vite + sidecar после логина
```

Нужен [Rust](https://rustup.rs). Добавьте `%USERPROFILE%\.cargo\bin` в PATH.

Sidecar живёт, пока открыто окно: `lib.rs` вызывает `kill()` на `RunEvent::Exit`.

### Иконка

Исходник — `logo.png` в корне репозитория:

```bash
cd apps/desktop
npx tauri icon ../../logo.png
```

Пересобирает `src-tauri/icons/*` (ico, icns, PNG).

### Ручной daemon (редко нужен)

```bash
# из корня, если есть daemon-config.json (Настройки → скачать)
npm run dev:daemon
```

На одном ПК два клиента — разные `lan_port` / `ui_ws_port` (см. [QUICKSTART.md](QUICKSTART.md)).

`crates/lockal-core` зарезервирован под rusqlite, Argon2id и OS keychain; сейчас networking — `lockal-daemon`.

## Docker

Только для будущих CI-сценариев, не нужен разработчику и пользователю.
