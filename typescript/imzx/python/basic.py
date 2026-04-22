# Basic agent with common features
from claude_agent_sdk import ClaudeAgent, Tool
from datetime import datetime

# Define a simple tool
def get_time_execute(**kwargs):
    return {"content": datetime.now().isoformat()}

get_time_tool = Tool(
    name="get_time",
    description="Returns the current time.",
    parameters={
        "type": "object",
        "properties": {},
    },
    execute=get_time_execute,
)

# Create a basic agent with common features
agent = ClaudeAgent(
    name="BasicAgent",
    system_prompt="You are a helpful assistant that can provide the current time.",
    tools=[get_time_tool],
)

# Simple query example
def main():
    try:
        response = agent.query("What time is it right now?")
        print(f"Response: {response.content}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
