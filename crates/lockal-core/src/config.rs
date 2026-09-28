use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub organization_id: String,
    pub device_id: String,
    pub user_id: String,
    pub public_key: String,
    pub lan_port: u16,
    pub ui_ws_port: u16,
    pub app_version: String,
    pub device_name: String,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            organization_id: String::new(),
            device_id: String::new(),
            user_id: String::new(),
            public_key: String::new(),
            lan_port: 39200,
            ui_ws_port: 39201,
            app_version: "0.1.0".into(),
            device_name: "device".into(),
        }
    }
}
