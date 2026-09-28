use bytes::{BufMut, BytesMut};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const PROTOCOL_VERSION: u32 = 1;

/// JSON on the wire matches TypeScript `ProtocolEnvelope` (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireEnvelope {
    pub protocol_version: u32,
    pub message_type: String,
    pub message_id: String,
    pub sender_device_id: String,
    pub timestamp: String,
    pub nonce: String,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHelloPayload {
    pub organization_id: String,
    pub device_id: String,
    pub user_id: String,
    pub public_key: String,
    pub device_name: String,
    pub app_version: String,
}

pub async fn write_frame(
    writer: &mut (impl AsyncWriteExt + Unpin),
    json: &[u8],
) -> io::Result<()> {
    let mut frame = BytesMut::with_capacity(4 + json.len());
    frame.put_u32(json.len() as u32);
    frame.extend_from_slice(json);
    writer.write_all(&frame).await
}

pub async fn read_frame(reader: &mut (impl AsyncReadExt + Unpin)) -> io::Result<Vec<u8>> {
    let len = reader.read_u32().await? as usize;
    if len > 16 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(buf)
}

pub fn parse_envelope(bytes: &[u8]) -> serde_json::Result<WireEnvelope> {
    serde_json::from_slice(bytes)
}

pub fn serialize_envelope(envelope: &WireEnvelope) -> serde_json::Result<Vec<u8>> {
    serde_json::to_vec(envelope)
}
