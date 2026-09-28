# Security

## Сейчас

- Пароли: **scrypt** (Noble) в TypeScript. Целевой production-алгоритм — **Argon2id** в `crates/lockal-core` (ещё не подключён).
- Identity: **Ed25519** для организации и устройства; fingerprint — SHA-256 public key (`XXXX-XXXX-…`).
- Сессии: случайный token, в БД только **SHA-256 hash**.
- Private keys: `SecureStorage` (сейчас localStorage с префиксом `lockal.secure.*`; план — OS keychain через Tauri).
- RBAC: `PermissionAction`, не hardcoded logins.
- **Подпись envelopes** устройством; `sync.envelope` — ключом организации.
- **Replay**: `seen_envelopes` (senderDeviceId + nonce), prune ~7 дней.
- Отозванное устройство не должно проходить `EnvelopeGuard` (нет в known/trusted).
- Invite JSON содержит публичные поля org/user/devices и **passwordHash** пользователя — передавать как секрет, не публиковать.

## Не логировать

Пароли, private keys, тексты сообщений, файлы, session tokens.

## Операционные моменты

- Одно локальное устройство = одна организация. Сброс только явно: Настройки → **Отвязать это устройство**.
- Daemon не должен переживать закрытие окна (утечка процесса чинилась отдельно).
- Установщик Windows не подписан — ожидаем SmartScreen.
- Полноценный E2E (шифрованный payload, а не только подпись envelope) и TLS между пирами — дальше по плану.
