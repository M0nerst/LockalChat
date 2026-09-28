use crate::config::DaemonConfig;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

pub const SERVICE_TYPE: &str = "_lockalchat._tcp.local.";
const UDP_DISCOVERY_PORT: u16 = 39209;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscoveredPeer {
    pub device_id: String,
    pub user_id: String,
    pub organization_id: String,
    pub public_key: String,
    pub host: String,
    pub port: u16,
}

#[derive(Clone)]
pub struct DiscoveryHandle {
    peers: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
}

impl DiscoveryHandle {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn list(&self) -> Vec<DiscoveredPeer> {
        self.peers.read().await.values().cloned().collect()
    }

    async fn upsert(&self, peer: DiscoveredPeer) {
        if peer.device_id.is_empty() {
            return;
        }
        self.peers.write().await.insert(peer.device_id.clone(), peer);
    }
}

pub struct DiscoveryService;

impl DiscoveryService {
    pub async fn start(config: &DaemonConfig, handle: DiscoveryHandle) -> Result<(), String> {
        let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
        let hostname = mdns_host_fqdn();

        let props = [
            ("org_id", config.organization_id.as_str()),
            ("user_id", config.user_id.as_str()),
            ("device_id", config.device_id.as_str()),
            ("pubkey", config.public_key.as_str()),
            ("ver", config.app_version.as_str()),
        ];

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &config.device_id,
            &hostname,
            (),
            config.lan_port,
            &props[..],
        )
        .map_err(|e| e.to_string())?
        .enable_addr_auto();

        mdns.register(service_info).map_err(|e| e.to_string())?;
        info!(
            device_id = %config.device_id,
            port = config.lan_port,
            "mDNS service registered"
        );

        let receiver = mdns.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        let own_device = config.device_id.clone();
        let org_id = config.organization_id.clone();
        let handle_bg = handle.clone();

        tokio::spawn(async move {
            while let Ok(event) = receiver.recv_async().await {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let device_id = get_prop(&info, "device_id");
                    if device_id == own_device {
                        continue;
                    }
                    let peer_org = get_prop(&info, "org_id");
                    if peer_org != org_id {
                        continue;
                    }
                    let host = info
                        .get_addresses()
                        .iter()
                        .find(|a| a.is_ipv4())
                        .map(|a| a.to_string())
                        .unwrap_or_default();
                    let port = info.get_port();
                    let peer = DiscoveredPeer {
                        device_id: device_id.clone(),
                        user_id: get_prop(&info, "user_id"),
                        organization_id: peer_org,
                        public_key: get_prop(&info, "pubkey"),
                        host,
                        port,
                    };
                    debug!(device_id = %peer.device_id, host = %peer.host, "peer discovered via mDNS");
                    handle_bg.upsert(peer).await;
                }
            }
        });

        Self::udp_fallback_broadcast(config.clone(), handle);
        Ok(())
    }

    fn udp_fallback_broadcast(config: DaemonConfig, handle: DiscoveryHandle) {
        tokio::spawn(async move {
            let socket = match tokio::net::UdpSocket::bind(("0.0.0.0", UDP_DISCOVERY_PORT)).await
            {
                Ok(s) => s,
                Err(e) => {
                    warn!(?e, "UDP discovery bind failed");
                    return;
                }
            };
            let _ = socket.set_broadcast(true);

            let mut buf = [0u8; 2048];
            loop {
                let packet = serde_json::json!({
                    "type": "lockal.discovery",
                    "organization_id": config.organization_id,
                    "device_id": config.device_id,
                    "user_id": config.user_id,
                    "public_key": config.public_key,
                    "port": config.lan_port,
                });
                if let Ok(bytes) = serde_json::to_vec(&packet) {
                    let _ = socket
                        .send_to(&bytes, ("255.255.255.255", UDP_DISCOVERY_PORT))
                        .await;
                }

                if let Ok(Ok((len, addr))) = tokio::time::timeout(
                    std::time::Duration::from_millis(800),
                    socket.recv_from(&mut buf),
                )
                .await
                {
                    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&buf[..len]) {
                        if value.get("type").and_then(|v| v.as_str()) != Some("lockal.discovery") {
                            continue;
                        }
                        let device_id = value
                            .get("device_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if device_id == config.device_id {
                            continue;
                        }
                        if value.get("organization_id").and_then(|v| v.as_str())
                            != Some(config.organization_id.as_str())
                        {
                            continue;
                        }
                        let peer = DiscoveredPeer {
                            device_id,
                            user_id: value
                                .get("user_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .into(),
                            organization_id: config.organization_id.clone(),
                            public_key: value
                                .get("public_key")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .into(),
                            host: addr.ip().to_string(),
                            port: value
                                .get("port")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(config.lan_port as u64) as u16,
                        };
                        handle.upsert(peer).await;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });
    }
}

/// mDNS requires a host name ending with `.local.` (not raw Windows `COMPUTERNAME`).
fn mdns_host_fqdn() -> String {
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "lockalchat".into());
    let base: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let base = base.trim_matches('-');
    let base = if base.is_empty() { "lockalchat" } else { base };
    if base.ends_with(".local.") {
        base.to_string()
    } else if base.ends_with(".local") {
        format!("{base}.")
    } else {
        format!("{base}.local.")
    }
}

fn get_prop(info: &ServiceInfo, key: &str) -> String {
    info.get_properties()
        .get(key)
        .map(|v| v.val_str().into())
        .unwrap_or_default()
}
