use clap::Parser;
use lockal_core::config::DaemonConfig;
use lockal_core::lan_node::LanNode;
use std::fs;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "lockal-daemon")]
struct Args {
    #[arg(long, default_value = "daemon-config.json")]
    config: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("lockal=info".parse()?))
        .init();

    let args = Args::parse();
    let raw = fs::read_to_string(&args.config)?;
    let config: DaemonConfig = serde_json::from_str(&raw)?;
    let node = Arc::new(LanNode::new(config));
    node.run().await?;
    Ok(())
}
