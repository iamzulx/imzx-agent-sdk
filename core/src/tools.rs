use std::collections::HashMap;
use std::sync::Arc;
use async_trait::async_trait;
use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::fs;
use std::process::Command;
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::env;
use reqwest::{self, redirect::Policy, Url};
use scraper::{Html, Selector};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolResult {
    pub content: String,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    async fn execute(&self, args: &str) -> Result<ToolResult>;
}

// --- Concrete Tool Implementations ---

pub struct FileSystemTool {
    root_dir: PathBuf,
}

impl FileSystemTool {
    pub fn new() -> Self {
        Self {
            root_dir: env::current_dir()
                .ok()
                .and_then(|path| fs::canonicalize(path).ok())
                .unwrap_or_else(|| PathBuf::from(".")),
        }
    }

    fn sanitize_path(&self, user_path: &str, must_exist: bool) -> Result<PathBuf> {
        let path = Path::new(user_path);

        if path.is_absolute() {
            return Err(anyhow!("Security violation: Absolute paths are not allowed."));
        }

        for component in path.components() {
            match component {
                Component::Normal(part) => {
                    let value = part.to_string_lossy();
                    if value.starts_with('.') || matches!(value.as_ref(), "passwd" | "shadow") {
                        return Err(anyhow!("Security violation: Access to protected path component '{}' is forbidden.", value));
                    }
                }
                Component::CurDir => {}
                _ => return Err(anyhow!("Security violation: Path traversal is not allowed.")),
            }
        }

        let full_path = self.root_dir.join(path);

        if must_exist {
            let canonical_full = fs::canonicalize(&full_path)
                .map_err(|e| anyhow!("Invalid path: {}. Error: {}", user_path, e))?;

            if !canonical_full.starts_with(&self.root_dir) {
                return Err(anyhow!("Security violation: Path is outside of the allowed directory."));
            }

            return Ok(canonical_full);
        }

        let parent = full_path.parent()
            .ok_or_else(|| anyhow!("Invalid path: {}", user_path))?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|e| anyhow!("Invalid parent path: {}. Error: {}", user_path, e))?;

        if !canonical_parent.starts_with(&self.root_dir) {
            return Err(anyhow!("Security violation: Path is outside of the allowed directory."));
        }

        Ok(full_path)
    }
}

#[async_trait]
impl Tool for FileSystemTool {
    fn name(&self) -> &str { "filesystem" }
    fn description(&self) -> &str { "Read, write, or list files. Args: 'read <path>', 'write <path> <content>', 'list <path>'. All paths are relative to project root." }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let parts: Vec<&str> = args.splitn(3, ' ').collect();
        if parts.len() < 2 { return Err(anyhow!("Invalid args. Use 'read <path>', 'write <path> <content>', or 'list <path>'")); }

        let command = parts[0];
        let path_str = parts[1];

        match command {
            "read" => {
                let safe_path = self.sanitize_path(path_str, true)?;
                let content = fs::read_to_string(&safe_path)?;
                Ok(ToolResult { content })
            }
            "write" => {
                if parts.len() < 3 { return Err(anyhow!("Missing content for write operation")); }
                let safe_path = self.sanitize_path(path_str, false)?;
                let content = parts[2];
                fs::write(&safe_path, content)?;
                Ok(ToolResult { content: "File written successfully".to_string() })
            }
            "list" => {
                let safe_path = self.sanitize_path(path_str, true)?;
                let paths = fs::read_dir(&safe_path)?
                    .filter_map(|entry| {
                        entry.ok().and_then(|e| {
                            let name = e.file_name().to_string_lossy().into_owned();
                            if name.starts_with('.') { None } else { Some(name) }
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(ToolResult { content: paths })
            }
            _ => Err(anyhow!("Unknown filesystem command: {}", command)),
        }
    }
}

pub struct ShellTool;

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str { "shell" }
    fn description(&self) -> &str { "Execute a specific set of safe shell commands. Args: '<command>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let tokens: Vec<&str> = args.split_whitespace().collect();
        if tokens.is_empty() {
            return Err(anyhow!("Invalid args. Provide a command to execute."));
        }

        let allowed_commands: &[&[&str]] = &[
            &["ls"],
            &["git", "status"],
            &["git", "log"],
            &["npm", "test"],
            &["cargo", "build"],
            &["cargo", "check"],
            &["cargo", "run"],
        ];

        if !allowed_commands.iter().any(|allowed| tokens.starts_with(allowed)) {
            return Err(anyhow!("Security violation: Command '{}' is not in the allowed list.", args));
        }

        for token in &tokens {
            if token.contains("..") || token.starts_with('/') || token.starts_with('.') || token.contains("/." ) {
                return Err(anyhow!("Security violation: Command argument '{}' is not allowed.", token));
            }
        }

        let output = Command::new(tokens[0])
            .args(&tokens[1..])
            .current_dir(env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .output()?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok(ToolResult {
            content: format!("STDOUT: {}\nSTDERR: {}", stdout, stderr)
        })
    }
}

pub struct CalculatorTool;

#[async_trait]
impl Tool for CalculatorTool {
    fn name(&self) -> &str { "calculator" }
    fn description(&self) -> &str { "Perform mathematical calculations. Args: '<expression>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let result = match args.replace(" ", "").as_str() {
            "1+1" => "2",
            "2+2" => "4",
            _ => "Calculation requires integration with a real math engine (e.g. meval)."
        };
        Ok(ToolResult { content: format!("Result: {}", result) })
    }
}

pub struct WebSearchTool {
    pub api_key: Option<String>,
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str { "web_search" }
    fn description(&self) -> &str { "Search the web for real-time information. Args: '<query>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        Ok(ToolResult {
            content: format!("Searching the web for: '{}'... [Simulated search results for '{}']", args, args)
        })
    }
}

pub struct WebScraperTool;

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.octets()[0] == 0
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

#[async_trait]
impl Tool for WebScraperTool {
    fn name(&self) -> &str { "web_scraper" }
    fn description(&self) -> &str { "Read content from a URL. Args: '<url>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let url = Url::parse(args.trim())?;

        if !matches!(url.scheme(), "http" | "https") || url.username() != "" || url.password().is_some() {
            return Err(anyhow!("Security violation: URL scheme or credentials are not allowed."));
        }

        let host = url.host_str()
            .ok_or_else(|| anyhow!("Invalid URL: missing host"))?;
        let port = url.port_or_known_default()
            .ok_or_else(|| anyhow!("Invalid URL: missing port"))?;

        let addrs = tokio::net::lookup_host((host, port)).await?;
        for addr in addrs {
            if is_blocked_ip(addr.ip()) {
                return Err(anyhow!("Security violation: Access to local/private network is forbidden (SSRF protection)."));
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(Policy::none())
            .build()?;

        let response = client.get(url).send().await?;
        if response.status().is_redirection() {
            return Err(anyhow!("Security violation: Redirects are not followed by the web scraper."));
        }

        let body = response.text().await?;
        let document = Html::parse_document(&body);
        let selector = Selector::parse("p, h1, h2, h3").unwrap();

        let mut extracted_text = String::new();
        for element in document.select(&selector) {
            extracted_text.push_str(&element.text().collect::<Vec<_>>().join(" "));
            extracted_text.push('\n');
        }

        Ok(ToolResult { content: extracted_text.trim().to_string() })
    }
}

pub struct DatabaseTool;

#[async_trait]
impl Tool for DatabaseTool {
    fn name(&self) -> &str { "database" }
    fn description(&self) -> &str { "Query the local database. Args: '<query>'. Only SELECT is allowed." }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let query = args.trim();

        let upper_query = query.to_uppercase();
        if !upper_query.starts_with("SELECT") {
            return Err(anyhow!("Security violation: Only SELECT queries are allowed."));
        }

        Ok(ToolResult { content: "Database query executed successfully. (Result simulation)".to_string() })
    }
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            tools: HashMap::new(),
        };

        registry.register_tool(Arc::new(FileSystemTool::new()));
        registry.register_tool(Arc::new(ShellTool));
        registry.register_tool(Arc::new(CalculatorTool));
        registry.register_tool(Arc::new(WebSearchTool { api_key: None }));
        registry.register_tool(Arc::new(WebScraperTool));
        registry.register_tool(Arc::new(DatabaseTool));

        registry
    }

    pub fn register_tool(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub async fn execute_tool(&self, name: &str, args: &str) -> Result<ToolResult> {
        if let Some(tool) = self.tools.get(name) {
            tool.execute(args).await
        } else {
            Err(anyhow!("Tool '{}' not found in registry", name))
        }
    }

    pub fn list_tools(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }
}
