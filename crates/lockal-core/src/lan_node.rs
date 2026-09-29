use crate::config::DaemonConfig;
use crate::discovery::{DiscoveredPeer, DiscoveryHandle, DiscoveryService};
use crate::protocol::{
    parse_envelope, read_frame, serialize_envelope, write_frame, DeviceHelloPayload, WireEnvelope,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::net::{tcp::OwnedWriteHalf, TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

type PeerWriter = mpsc::Sender<Vec<u8>>;

#[derive(Clone)]
pub struct LanNode {
    config: DaemonConfig,
    discovery: DiscoveryHandle,
    connected: Arc<RwLock<HashSet<String>>>,
    peer_writers: Arc<RwLock<HashMap<String, PeerWriter>>>,
    /// UI subscribers. A bounded channel applies backpressure so a fast file
    /// transfer cannot drop chunks when the webview is still parsing the previous one.
    inbound_subs: Arc<RwLock<Vec<mpsc::Sender<(String, WireEnvelope)>>>>,
    dial_lock: Arc<Mutex<()>>,
}

impl LanNode {
    pub fn new(config: DaemonConfig) -> Self {
        Self {
            config,
            discovery: DiscoveryHandle::new(),
            connected: Arc::new(RwLock::new(HashSet::new())),
            peer_writers: Arc::new(RwLock::new(HashMap::new())),
            inbound_subs: Arc::new(RwLock::new(Vec::new())),
            dial_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn run(self: Arc<Self>) -> Result<(), String> {
        DiscoveryService::start(&self.config, self.discovery.clone()).await?;

        let listener = TcpListener::bind(("0.0.0.0", self.config.lan_port))
            .await
            .map_err(|e| e.to_string())?;
        info!(port = self.config.lan_port, "LAN TCP listener started");

        let node_accept = self.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, addr)) => {
                        let node = node_accept.clone();
                        tokio::spawn(async move {
                            if let Err(e) = node.handle_inbound(stream).await {
                                warn!(?addr, ?e, "inbound peer error");
                            }
                        });
                    }
                    Err(e) => error!(?e, "accept failed"),
                }
            }
        });

        let node_dial = self.clone();
        tokio::spawn(async move {
            loop {
                node_dial.refresh_connections().await;
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        });

        self.run_ui_websocket().await
    }

    async fn refresh_connections(&self) {
        let peers = self.discovery.list().await;
        for peer in peers {
            if peer.device_id == self.config.device_id {
                continue;
            }
            if peer.host.is_empty() {
                continue;
            }
            if self.connected.read().await.contains(&peer.device_id) {
                continue;
            }
            // Deterministic dialer avoids duplicate TCP sessions
            if self.config.device_id > peer.device_id {
                continue;
            }
            let _guard = self.dial_lock.lock().await;
            if self.connected.read().await.contains(&peer.device_id) {
                continue;
            }
            let addr = format!("{}:{}", peer.host, peer.port);
            match TcpStream::connect(&addr).await {
                Ok(stream) => {
                    info!(device_id = %peer.device_id, %addr, "outbound peer connected");
                    let node = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = node.handle_outbound_session(stream, peer).await {
                            warn!(?e, "outbound session ended");
                        }
                    });
                }
                Err(e) => {
                    warn!(device_id = %peer.device_id, %addr, ?e, "dial failed");
                }
            }
        }
    }

    async fn handle_inbound(&self, stream: TcpStream) -> Result<(), String> {
        let (mut reader, writer) = stream.into_split();
        let hello = self.read_hello(&mut reader).await?;
        self.validate_hello(&hello)?;
        let peer_device = hello.device_id.clone();
        self.register_session(&peer_device, writer).await?;
        self.send_hello_to_peer(&peer_device).await?;
        info!(device_id = %peer_device, "inbound hello accepted");
        self.read_loop(peer_device, reader).await
    }

    async fn handle_outbound_session(
        &self,
        stream: TcpStream,
        peer: DiscoveredPeer,
    ) -> Result<(), String> {
        let (mut reader, writer) = stream.into_split();
        self.register_session(&peer.device_id, writer).await?;
        self.send_hello_to_peer(&peer.device_id).await?;
        let hello = self.read_hello(&mut reader).await?;
        self.validate_hello(&hello)?;
        if hello.device_id != peer.device_id {
            return Err("device id mismatch".into());
        }
        self.read_loop(peer.device_id, reader).await
    }

    async fn register_session(
        &self,
        device_id: &str,
        writer: OwnedWriteHalf,
    ) -> Result<(), String> {
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(64);
        self.peer_writers
            .write()
            .await
            .insert(device_id.to_string(), tx);
        self.connected.write().await.insert(device_id.to_string());

        let device_id_owned = device_id.to_string();
        let peer_writers = self.peer_writers.clone();
        let connected = self.connected.clone();
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(bytes) = rx.recv().await {
                if write_frame(&mut writer, &bytes).await.is_err() {
                    break;
                }
            }
            peer_writers.write().await.remove(&device_id_owned);
            connected.write().await.remove(&device_id_owned);
        });
        Ok(())
    }

    async fn read_loop(
        &self,
        peer_device: String,
        mut reader: tokio::net::tcp::OwnedReadHalf,
    ) -> Result<(), String> {
        loop {
            let frame = read_frame(&mut reader).await.map_err(|e| e.to_string())?;
            let envelope = parse_envelope(&frame).map_err(|e| e.to_string())?;
            if envelope.message_type == "device.hello" {
                continue;
            }
            self.publish_inbound(peer_device.clone(), envelope).await;
        }
    }

    async fn publish_inbound(&self, peer: String, envelope: WireEnvelope) {
        let subs = self.inbound_subs.read().await.clone();
        let mut dead = Vec::new();
        for tx in subs {
            if tx.send((peer.clone(), envelope.clone())).await.is_err() {
                dead.push(tx);
            }
        }
        if dead.is_empty() {
            return;
        }
        let mut guard = self.inbound_subs.write().await;
        guard.retain(|tx| !dead.iter().any(|gone| gone.same_channel(tx)));
    }

    async fn read_hello(
        &self,
        reader: &mut (impl AsyncReadExt + Unpin),
    ) -> Result<DeviceHelloPayload, String> {
        let frame = read_frame(reader).await.map_err(|e| e.to_string())?;
        let envelope = parse_envelope(&frame).map_err(|e| e.to_string())?;
        if envelope.message_type != "device.hello" {
            return Err("expected device.hello".into());
        }
        serde_json::from_value(envelope.payload).map_err(|e| e.to_string())
    }

    async fn send_hello_to_peer(&self, peer_device: &str) -> Result<(), String> {
        let payload = DeviceHelloPayload {
            organization_id: self.config.organization_id.clone(),
            device_id: self.config.device_id.clone(),
            user_id: self.config.user_id.clone(),
            public_key: self.config.public_key.clone(),
            device_name: self.config.device_name.clone(),
            app_version: self.config.app_version.clone(),
        };
        let envelope = WireEnvelope {
            protocol_version: 1,
            message_type: "device.hello".into(),
            message_id: format!("hello_{}", uuid_simple()),
            sender_device_id: self.config.device_id.clone(),
            timestamp: chrono_now(),
            nonce: uuid_simple(),
            payload: serde_json::to_value(payload).map_err(|e| e.to_string())?,
            signature: None,
        };
        self.send_to_peer(peer_device, envelope).await
    }

    fn validate_hello(&self, hello: &DeviceHelloPayload) -> Result<(), String> {
        if hello.organization_id != self.config.organization_id {
            return Err("organization mismatch".into());
        }
        if hello.device_id == self.config.device_id {
            return Err("self connection".into());
        }
        Ok(())
    }

    pub async fn send_to_peer(&self, device_id: &str, envelope: WireEnvelope) -> Result<(), String> {
        let bytes = serialize_envelope(&envelope).map_err(|e| e.to_string())?;
        let tx = self
            .peer_writers
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(|| format!("peer {device_id} not connected"))?;
        tx.send(bytes)
            .await
            .map_err(|_| format!("peer {device_id} write channel closed"))
    }

    async fn run_ui_websocket(self: &Arc<Self>) -> Result<(), String> {
        let addr = format!("127.0.0.1:{}", self.config.ui_ws_port);
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| e.to_string())?;
        info!(%addr, "UI websocket listening");

        loop {
            let (stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let node_conn = self.clone();
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await;
                let Ok(mut ws) = ws else {
                    return;
                };
                let (tx, mut rx) = mpsc::channel::<(String, WireEnvelope)>(8);
                node_conn.inbound_subs.write().await.push(tx.clone());
                loop {
                    tokio::select! {
                        msg = ws.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                        node_conn.handle_ui_command(&v, &mut ws).await;
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => break,
                                _ => {}
                            }
                        }
                        evt = rx.recv() => {
                            let Some((peer, envelope)) = evt else { break };
                            let payload = serde_json::json!({
                                "type": "envelope.received",
                                "peerDeviceId": peer,
                                "envelope": envelope,
                            });
                            if ws.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                let mut guard = node_conn.inbound_subs.write().await;
                guard.retain(|sub| !sub.same_channel(&tx));
            });
        }
    }

    async fn handle_ui_command(
        &self,
        cmd: &serde_json::Value,
        ws: &mut (impl SinkExt<Message> + Unpin),
    ) {
        match cmd.get("type").and_then(|v| v.as_str()) {
            Some("peers.list") => {
                let peers = self.discovery.list().await;
                let connected: Vec<_> = self.connected.read().await.iter().cloned().collect();
                let resp = serde_json::json!({
                    "type": "peers.list.result",
                    "peers": peers,
                    "connected": connected,
                });
                let _ = ws.send(Message::Text(resp.to_string().into())).await;
            }
            Some("envelope.send") => {
                let device_id = cmd.get("deviceId").and_then(|v| v.as_str()).unwrap_or("");
                let parse_result = serde_json::from_value::<WireEnvelope>(
                    cmd.get("envelope").cloned().unwrap_or_default(),
                );
                let result = match parse_result {
                    Ok(envelope) => self.send_to_peer(device_id, envelope).await,
                    Err(e) => Err(format!("invalid envelope: {e}")),
                };
                let resp = serde_json::json!({
                    "type": "envelope.send.result",
                    "ok": result.is_ok(),
                    "error": result.err().map(|s| s.to_string()),
                });
                let _ = ws.send(Message::Text(resp.to_string().into())).await;
            }
            Some("discovery.refresh") => {
                self.refresh_connections().await;
            }
            _ => {}
        }
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}")
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", dur.as_secs(), dur.subsec_millis())
}
