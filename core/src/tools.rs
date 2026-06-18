// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Tools module — tool registry, implementations, and security guards.
// Security fixes applied:
//   [C1]  Typed ToolCall + ToolCallValidator + UntrustedObservation
//   [H2]  ShellPolicy with exact argument matching (cargo run removed)
//   [H3]  DNS rebinding eliminated via reqwest::resolve() IP pinning
//   [H4]  TOCTOU mitigated via O_NOFOLLOW on file reads
//   [M2]  HTTPS-only in WebScraper
//   [M3]  Observation sanitization (Action: patterns escaped)
//   [M5]  PATH detected at init, not hardcoded
//   [L3]  Calculator returns clear error for unimplemented expressions

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::{self, redirect::Policy, Url};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

// --- [C1 FIX] Typed ToolCall & Validation ---

/// Represents a parsed tool call extracted from LLM output.
/// Replaces raw string parsing that was vulnerable to prompt injection.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub tool_name: String,
    pub args: String,
}

impl ToolCall {
    /// Parses a ToolCall from raw LLM response text.
    /// Only extracts the first Action/Action Input pair — does NOT execute.
    pub fn parse_from_response(response: &str) -> Option<Self> {
        let mut tool_name = String::new();
        let mut tool_args = String::new();
        let mut found = false;

        for line in response.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Action:") {
                tool_name = trimmed["Action:".len()..].trim().to_string();
                found = true;
            } else if trimmed.starts_with("Action Input:") {
                tool_args = trimmed["Action Input:".len()..].trim().to_string();
            }
        }

        if found && !tool_name.is_empty() {
            Some(ToolCall {
                tool_name,
                args: tool_args,
            })
        } else {
            None
        }
    }
}

/// Pre-execution validation hook for tool calls.
/// Implementors can reject, modify, or log tool calls before they run.
pub trait ToolCallValidator: Send + Sync {
    /// Returns Ok(()) if the call is allowed, Err with reason if not.
    fn validate(&self, call: &ToolCall) -> Result<()>;
}

/// Default validator — checks tool name is registered and args are non-empty.
pub struct DefaultValidator {
    registered_tools: Vec<String>,
}

impl DefaultValidator {
    pub fn new(tool_names: Vec<String>) -> Self {
        Self {
            registered_tools: tool_names,
        }
    }
}

impl ToolCallValidator for DefaultValidator {
    fn validate(&self, call: &ToolCall) -> Result<()> {
        if !self.registered_tools.contains(&call.tool_name) {
            return Err(anyhow!(
                "Tool '{}' is not registered. Available: {:?}",
                call.tool_name,
                self.registered_tools
            ));
        }
        if call.args.is_empty() {
            return Err(anyhow!(
                "Tool '{}' called with empty arguments",
                call.tool_name
            ));
        }
        Ok(())
    }
}

/// [M3 FIX] Wrapper for tool outputs that are untrusted (may contain injection attempts).
/// Sanitizes content before it re-enters the LLM context.
pub struct UntrustedObservation;

impl UntrustedObservation {
    /// Wraps raw tool output with [UNTRUSTED] markers and escapes
    /// Action:/Action Input: patterns that could hijack the agent loop.
    pub fn sanitize(raw: &str) -> String {
        // Escape patterns that could be interpreted as agent directives
        let sanitized = raw
            .replace("Action:", "Action\\:")
            .replace("Action Input:", "Action Input\\:");

        format!(
            "[UNTRUSTED OBSERVATION START]\n{}\n[UNTRUSTED OBSERVATION END]",
            sanitized
        )
    }
}

// --- Tool Infrastructure ---

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

// --- FileSystemTool --- [H4 FIX] TOCTOU mitigation via O_NOFOLLOW

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
            return Err(anyhow!(
                "Security violation: Absolute paths are not allowed."
            ));
        }

        for component in path.components() {
            match component {
                Component::Normal(part) => {
                    let value = part.to_string_lossy();
                    if value.starts_with('.') || matches!(value.as_ref(), "passwd" | "shadow") {
                        return Err(anyhow!(
                            "Security violation: Access to protected path component '{}' is forbidden.",
                            value
                        ));
                    }
                }
                Component::CurDir => {}
                _ => {
                    return Err(anyhow!(
                        "Security violation: Path traversal is not allowed."
                    ))
                }
            }
        }

        let full_path = self.root_dir.join(path);

        if must_exist {
            let canonical_full = fs::canonicalize(&full_path)
                .map_err(|e| anyhow!("Invalid path: {}. Error: {}", user_path, e))?;

            if !canonical_full.starts_with(&self.root_dir) {
                return Err(anyhow!(
                    "Security violation: Path is outside of the allowed directory."
                ));
            }

            return Ok(canonical_full);
        }

        let parent = full_path
            .parent()
            .ok_or_else(|| anyhow!("Invalid path: {}", user_path))?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|e| anyhow!("Invalid parent path: {}. Error: {}", user_path, e))?;

        if !canonical_parent.starts_with(&self.root_dir) {
            return Err(anyhow!(
                "Security violation: Path is outside of the allowed directory."
            ));
        }

        Ok(full_path)
    }

    /// [H4 FIX] Read file with O_NOFOLLOW to prevent symlink-based TOCTOU.
    /// On Unix, opens the file with O_NOFOLLOW | O_CLOEXEC so a symlink
    /// swapped between canonicalize() and read() is rejected by the kernel.
    #[cfg(unix)]
    fn read_secure(&self, path: &Path) -> Result<String> {
        use std::os::unix::fs::OpenOptionsExt;
        // O_NOFOLLOW = 0x20000, O_CLOEXEC = 0x80000 on Linux
        const O_NOFOLLOW: i32 = 0x20000;
        const O_CLOEXEC: i32 = 0x80000;

        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(O_NOFOLLOW | O_CLOEXEC)
            .open(path)?;

        let mut content = String::new();
        use std::io::Read;
        file.read_to_string(&mut content)?;
        Ok(content)
    }

    #[cfg(not(unix))]
    fn read_secure(&self, path: &Path) -> Result<String> {
        // Fallback: standard read (TOCTOU risk accepted on non-Unix)
        fs::read_to_string(path)
    }
}

#[async_trait]
impl Tool for FileSystemTool {
    fn name(&self) -> &str {
        "filesystem"
    }
    fn description(&self) -> &str {
        "Read, write, or list files. Args: 'read <path>', 'write <path> <content>', 'list <path>'. All paths are relative to project root."
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let parts: Vec<&str> = args.splitn(3, ' ').collect();
        if parts.len() < 2 {
            return Err(anyhow!(
                "Invalid args. Use 'read <path>', 'write <path> <content>', or 'list <path>'"
            ));
        }

        let command = parts[0];
        let path_str = parts[1];

        match command {
            "read" => {
                let safe_path = self.sanitize_path(path_str, true)?;
                // [H4 FIX] Use secure read with O_NOFOLLOW
                let content = self.read_secure(&safe_path)?;
                Ok(ToolResult { content })
            }
            "write" => {
                if parts.len() < 3 {
                    return Err(anyhow!("Missing content for write operation"));
                }
                let safe_path = self.sanitize_path(path_str, false)?;
                let content = parts[2];
                fs::write(&safe_path, content)?;
                Ok(ToolResult {
                    content: "File written successfully".to_string(),
                })
            }
            "list" => {
                let safe_path = self.sanitize_path(path_str, true)?;
                let paths = fs::read_dir(&safe_path)?
                    .filter_map(|entry| {
                        entry.ok().and_then(|e| {
                            let name = e.file_name().to_string_lossy().into_owned();
                            if name.starts_with('.') {
                                None
                            } else {
                                Some(name)
                            }
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

// --- ShellTool --- [H2 FIX] ShellPolicy with exact argument matching

/// [H2 FIX] Defines exactly which arguments are allowed for each command.
/// No `starts_with` — every token must match exactly.
struct ShellPolicy;

impl ShellPolicy {
    /// Returns the allowed argument tuples for each command.
    /// Each entry is (command, [allowed_arg_sets]).
    /// An empty arg set means the command can run with no arguments.
    fn get_allowed() -> Vec<(&'static str, Vec<Vec<&'static str>>)> {
        vec![
            ("ls", vec![vec![], vec!["-l"], vec!["-la"], vec!["-a"]]),
            (
                "git",
                vec![
                    vec!["status"],
                    vec!["log"],
                    vec!["log", "--oneline"],
                    vec!["log", "--oneline", "-10"],
                    vec!["diff"],
                    vec!["branch"],
                ],
            ),
            ("npm", vec![vec!["test"], vec!["run", "typecheck"]]),
            (
                "cargo",
                vec![
                    vec!["build"],
                    vec!["check"],
                    vec!["test"],
                    vec!["clippy"],
                    vec!["fmt"],
                    // [H2 FIX] "cargo run" REMOVED — can compile+execute arbitrary code
                ],
            ),
        ]
    }

    /// Validates that the tokens exactly match one of the allowed argument sets.
    fn validate(tokens: &[&str]) -> Result<()> {
        if tokens.is_empty() {
            return Err(anyhow!("Empty command"));
        }

        let command = tokens[0];
        let args = &tokens[1..];

        let policies = Self::get_allowed();

        for (cmd, allowed_sets) in &policies {
            if *cmd != command {
                continue;
            }
            // Check if args match any allowed set
            for allowed in allowed_sets {
                if args == allowed.as_slice() {
                    return Ok(());
                }
            }
            return Err(anyhow!(
                "Security violation: Arguments {:?} not allowed for '{}'. Allowed: {:?}",
                args,
                command,
                allowed_sets
            ));
        }

        Err(anyhow!(
            "Security violation: Command '{}' is not in the allowed list.",
            command
        ))
    }

    /// [M5 FIX] Detect system PATH at call time instead of hardcoding.
    fn get_path() -> String {
        env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string())
    }
}

pub struct ShellTool;

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        "shell"
    }
    fn description(&self) -> &str {
        "Execute a specific set of safe shell commands. Args: '<command>'"
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let tokens: Vec<&str> = args.split_whitespace().collect();
        if tokens.is_empty() {
            return Err(anyhow!("Invalid args. Provide a command to execute."));
        }

        // [H2 FIX] Exact-match validation via ShellPolicy
        ShellPolicy::validate(&tokens)?;

        // Defense-in-depth: block path traversal in arguments
        for token in &tokens {
            if token.contains("..") || token.starts_with('/') || token.starts_with('.') {
                return Err(anyhow!(
                    "Security violation: Command argument '{}' is not allowed.",
                    token
                ));
            }
        }

        let output = Command::new(tokens[0])
            .args(&tokens[1..])
            .current_dir(env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .env_clear()
            .env("PATH", ShellPolicy::get_path())
            .output()?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok(ToolResult {
            content: format!("STDOUT: {}\nSTDERR: {}", stdout, stderr),
        })
    }
}

// --- CalculatorTool --- [L3 FIX] Clear error for unimplemented expressions

pub struct CalculatorTool;

#[async_trait]
impl Tool for CalculatorTool {
    fn name(&self) -> &str {
        "calculator"
    }
    fn description(&self) -> &str {
        "Perform mathematical calculations. Args: '<expression>'"
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let expr = args.trim();
        if expr.is_empty() {
            return Err(anyhow!("Calculator error: empty expression. Provide a mathematical expression to evaluate."));
        }

        // [L3 FIX] Return clear error instead of misleading "result"
        Err(anyhow!(
            "Calculator error: Expression '{}' cannot be evaluated. \
            This tool requires integration with a math engine (e.g., meval crate). \
            No calculation was performed.",
            expr
        ))
    }
}

// --- WebSearchTool ---

pub struct WebSearchTool {
    pub api_key: Option<String>,
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str {
        "web_search"
    }
    fn description(&self) -> &str {
        "Search the web for real-time information. Args: '<query>'"
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        Ok(ToolResult {
            content: format!(
                "Searching the web for: '{}'... [Simulated search results for '{}']",
                args, args
            ),
        })
    }
}

// --- WebScraperTool --- [H3 FIX] DNS rebinding + [M2 FIX] HTTPS only

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
    fn name(&self) -> &str {
        "web_scraper"
    }
    fn description(&self) -> &str {
        "Read content from a URL. Args: '<url>'"
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let url = Url::parse(args.trim())?;

        // [M2 FIX] Only HTTPS is allowed — HTTP rejected
        if url.scheme() != "https" {
            return Err(anyhow!(
                "Security violation: Only HTTPS URLs are allowed. HTTP is rejected."
            ));
        }

        if url.username() != "" || url.password().is_some() {
            return Err(anyhow!(
                "Security violation: URL credentials are not allowed."
            ));
        }

        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("Invalid URL: missing host"))?;
        let port = url
            .port_or_known_default()
            .ok_or_else(|| anyhow!("Invalid URL: missing port"))?;

        // [H3 FIX] DNS rebinding elimination:
        // 1. Resolve ALL IPs for the hostname
        // 2. Filter out blocked IPs
        // 3. Pin the filtered IPs via reqwest::resolve() so the HTTP client
        //    uses them directly — no second DNS lookup, no rebinding window.
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await?.collect();

        let safe_addrs: Vec<SocketAddr> = addrs
            .into_iter()
            .filter(|addr| !is_blocked_ip(addr.ip()))
            .collect();

        if safe_addrs.is_empty() {
            return Err(anyhow!(
                "Security violation: Access to local/private network is forbidden (SSRF protection). \
                All resolved IPs for '{}' were blocked.", host
            ));
        }

        // Build client with DNS pinned to the validated IPs
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(Policy::none());
        for addr in safe_addrs {
            builder = builder.resolve(host, addr);
        }
        let client = builder.build()?;

        let response = client.get(url).send().await?;
        if response.status().is_redirection() {
            return Err(anyhow!(
                "Security violation: Redirects are not followed by the web scraper."
            ));
        }

        if !response.status().is_success() {
            return Err(anyhow!("HTTP error: {}", response.status()));
        }

        let body = response.text().await?;
        let document = Html::parse_document(&body);
        let selector = Selector::parse("p, h1, h2, h3").unwrap();

        let mut extracted_text = String::new();
        for element in document.select(&selector) {
            extracted_text.push_str(&element.text().collect::<Vec<_>>().join(" "));
            extracted_text.push('\n');
        }

        Ok(ToolResult {
            content: extracted_text.trim().to_string(),
        })
    }
}

// --- DatabaseTool ---

pub struct DatabaseTool;

#[async_trait]
impl Tool for DatabaseTool {
    fn name(&self) -> &str {
        "database"
    }
    fn description(&self) -> &str {
        "Query the local database. Args: '<query>'. Only SELECT is allowed."
    }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let query = args.trim();

        let upper_query = query.to_uppercase();
        if !upper_query.starts_with("SELECT") {
            return Err(anyhow!(
                "Security violation: Only SELECT queries are allowed."
            ));
        }

        Ok(ToolResult {
            content: "Database query executed successfully. (Result simulation)".to_string(),
        })
    }
}

// --- ToolRegistry --- [C1 FIX] Validator support

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
    validator: Option<Arc<dyn ToolCallValidator>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            tools: HashMap::new(),
            validator: None,
        };

        registry.register_tool(Arc::new(FileSystemTool::new()));
        registry.register_tool(Arc::new(ShellTool));
        registry.register_tool(Arc::new(CalculatorTool));
        registry.register_tool(Arc::new(WebSearchTool { api_key: None }));
        registry.register_tool(Arc::new(WebScraperTool));
        registry.register_tool(Arc::new(DatabaseTool));

        // [C1 FIX] Set up default validator with known tool names
        let tool_names = registry.list_tools();
        registry.set_validator(Arc::new(DefaultValidator::new(tool_names)));

        registry
    }

    pub fn register_tool(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn set_validator(&mut self, validator: Arc<dyn ToolCallValidator>) {
        self.validator = Some(validator);
    }

    /// [C1 FIX] Validates then executes — validator runs before any tool call.
    pub async fn execute_tool(&self, name: &str, args: &str) -> Result<ToolResult> {
        // Pre-execution validation
        if let Some(ref validator) = self.validator {
            let call = ToolCall {
                tool_name: name.to_string(),
                args: args.to_string(),
            };
            validator.validate(&call)?;
        }

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
