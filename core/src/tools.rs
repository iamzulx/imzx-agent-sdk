use std::collections::HashMap;
use std::sync::Arc;
use async_trait::async_trait;
use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::fs;
use std::process::Command;

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

pub struct FileSystemTool;

#[async_trait]
impl Tool for FileSystemTool {
    fn name(&self) -> &str { "filesystem" }
    fn description(&self) -> &str { "Read, write, or list files. Args: 'read <path>', 'write <path> <content>', 'list <path>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let parts: Vec<&str> = args.splitn(3, ' ').collect();
        if parts.len() < 2 { return Err(anyhow!("Invalid args. Use 'read <path>', 'write <path> <content>', or 'list <path>'")); }

        match parts[0] {
            "read" => {
                let content = fs::read_to_string(parts[1])?;
                Ok(ToolResult { content })
            }
            "write" => {
                if parts.len() < 3 { return Err(anyhow!("Missing content for write operation")); }
                fs::write(parts[1], parts[2])?;
                Ok(ToolResult { content: "File written successfully".to_string() })
            }
            "list" => {
                let paths = fs::read_dir(parts[1])?
                    .filter_map(|entry| entry.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(ToolResult { content: paths })
            }
            _ => Err(anyhow!("Unknown filesystem command: {}", parts[0])),
        }
    }
}

pub struct ShellTool;

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str { "shell" }
    fn description(&self) -> &str { "Execute a shell command. Args: '<command>'" }

    async fn execute(&self, args: &str) -> Result<ToolResult> {
        let output = Command::new("sh")
            .arg("-c")
            .arg(args)
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
        // Using a simplified logic for demonstration. 
        // In production, integrate a robust math parser like 'meval'.
        let result = match args.replace(" ", "") {
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
        // Placeholder for real search API (e.g., Tavily, Brave, or Google)
        Ok(ToolResult { 
            content: format!("Searching the web for: '{}'... [Simulated search results for '{}']", args, args) 
        })
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
        
        registry.register_tool(Arc::new(FileSystemTool));
        registry.register_tool(Arc::new(ShellTool));
        registry.register_tool(Arc::new(CalculatorTool));
        registry.register_tool(Arc::new(WebSearchTool { api_key: None }));
        
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
