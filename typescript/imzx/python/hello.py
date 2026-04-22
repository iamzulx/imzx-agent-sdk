# Minimal Hello World example
from claude_agent_sdk import ClaudeAgent

# Create a minimal agent instance
agent = ClaudeAgent(
    name="HelloWorldAgent",
    system_prompt="You are a friendly assistant.",
)

# Simple query example
def main():
    try:
        response = agent.query("Hello! What is your name?")
        print(f"Response: {response.content}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
