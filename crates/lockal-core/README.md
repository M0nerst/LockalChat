# lockal-core (Rust)

Планируемый нативный core (ещё не используется UI):

- rusqlite / SQLCipher
- Argon2id, OS keychain / secure enclave
- FFI для mobile

**Сейчас networking живёт в crate `lockal-daemon`**: mDNS, UDP discovery, TCP P2P, WebSocket для desktop UI. Сборка sidecar: `npm run prepare:sidecar` в `apps/desktop` или `npm run build:rust` из корня.

Нужен [rustup](https://rustup.rs).
