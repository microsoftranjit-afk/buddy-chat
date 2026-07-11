#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use tauri::{Manager, Window};

// Resolve the backend URL the desktop window should load:
//   1. ELECTRON_SERVER_URL env var (kept the same name for compatibility)
//   2. serverUrl in config.json (dev only; not shipped in the installer)
//   3. fallback to the deployed Render server
fn resolve_url() -> String {
    if let Ok(u) = std::env::var("ELECTRON_SERVER_URL") {
        return u;
    }
    if let Ok(text) = std::fs::read_to_string("config.json") {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(u) = v.get("serverUrl").and_then(|x| x.as_str()) {
                return u.to_string();
            }
        }
    }
    "https://buddy-chat-bd6c.onrender.com".to_string()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = resolve_url();
            if let Some(win) = app.get_window("main") {
                let quoted = serde_json::to_string(&url)
                    .unwrap_or_else(|_| "\"https://buddy-chat-bd6c.onrender.com\"".to_string());
                let _ = win.eval(&format!("window.location.replace({});", quoted));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Buddy");
}
