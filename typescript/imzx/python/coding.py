# Coding agent example (Code Reviewer)
from claude_agent_sdk import ClaudeAgent, Tool

# Define a tool to "read" a file for the agent
def read_file_execute(**kwargs):
    path = kwargs.get("path")
    # In a real scenario, this would use the filesystem
    return {"content": f"// Mock content for {path}\\nfunction add(a, b) {{ return a + b; }}"}

read_file_tool = Tool(
    name="read_file",
    description="Reads the content of a file for code review.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file to read."},
        },
        "required": ["path"],
    },
    execute=read_file_execute,
)

# Create a coding agent specialized in code review
agent = ClaudeAgent(
    name="CodingReviewAgent",
    system_prompt="""You are an expert code reviewer.
    Analyze the provided code for bugs, security vulnerabilities, and adherence to best practices.
    Provide constructive feedback and suggestions for improvement.""",
    tools=[read_file_tool],
)

# Simple query example
def main():
    try:
        response = agent.query('Please review the file "src/utils.ts"')
        print(f"Response: {response.content}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
