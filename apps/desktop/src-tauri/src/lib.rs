use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

/// Tracks whether the `lockal-daemon` sidecar has already been spawned for the
/// lifetime of this app process, so we never launch it twice (e.g. once at
/// startup from a previously saved config, and again right after login), and
/// holds a handle to the running child so it can be killed when the app
/// exits — otherwise the sidecar is orphaned and keeps running in the
/// background after the window is closed.
struct DaemonState {
    started: Mutex<bool>,
    child: Mutex<Option<CommandChild>>,
}

/// Kills the `lockal-daemon` sidecar, if one is currently tracked. Safe to
/// call multiple times; a second call is a no-op once the child has been
/// taken out of the state.
fn kill_daemon(app: &tauri::AppHandle) {
    let state = app.state::<DaemonState>();
    let child = match state.child.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn daemon_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("daemon-config.json"))
}

/// Persists the daemon config to disk and, unless it is already running,
/// spawns the `lockal-daemon` sidecar immediately. This lets the UI start the
/// LAN daemon right after login/setup in the packaged app, instead of
/// requiring an app restart (which was previously the only trigger for the
/// `setup()` auto-start below).
#[tauri::command]
async fn save_daemon_config(
    app: tauri::AppHandle,
    state: State<'_, DaemonState>,
    config_json: String,
) -> Result<String, String> {
    let path = daemon_config_path(&app)?;
    fs::write(&path, &config_json).map_err(|e| e.to_string())?;

    let should_spawn = {
        let mut started = state.started.lock().map_err(|e| e.to_string())?;
        if *started {
            false
        } else {
            *started = true;
            true
        }
    };

    if should_spawn {
        if let Err(err) = spawn_daemon(&app, &path).await {
            if let Ok(mut started) = state.started.lock() {
                *started = false;
            }
            return Err(err);
        }
    }

    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DaemonState {
            started: Mutex::new(false),
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![save_daemon_config])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_data_dir() {
                    let config_path = dir.join("daemon-config.json");
                    if config_path.exists() {
                        let state = handle.state::<DaemonState>();
                        let should_spawn = {
                            let mut started = state.started.lock().unwrap();
                            if *started {
                                false
                            } else {
                                *started = true;
                                true
                            }
                        };
                        if should_spawn {
                            if spawn_daemon(&handle, &config_path).await.is_err() {
                                if let Ok(mut started) = state.started.lock() {
                                    *started = false;
                                }
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Fires once when the app is quitting (last window closed, or the OS
            // is shutting the process down). Kill the daemon sidecar here so it
            // never lingers as an orphaned background process after the window
            // closes.
            if let RunEvent::Exit = event {
                kill_daemon(app);
            }
        });
}

async fn spawn_daemon(app: &tauri::AppHandle, config_path: &Path) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("lockal-daemon")
        .map_err(|e| e.to_string())?
        .args(["--config", config_path.to_str().unwrap_or("daemon-config.json")]);

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    set_daemon_child(app, Some(child));
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(_payload) = event {
                // The sidecar exited on its own (e.g. crashed); clear the
                // handle so we don't try to kill an already-dead process.
                set_daemon_child(&app_handle, None);
                break;
            }
        }
    });
    Ok(())
}

/// Stores (or clears) the currently-tracked daemon child handle in app state.
fn set_daemon_child(app: &tauri::AppHandle, child: Option<CommandChild>) {
    let state = app.state::<DaemonState>();
    let mut guard = match state.child.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = child;
}
