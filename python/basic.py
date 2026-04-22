# Basic agent with common features
import asyncio
from claude_agent_sdk import query

CLAUDE_PATH = '/data/data/com.termux/files/home/projects/xxx/claude_bridge.py'

# Simple query example using the functional API
async def main():
    try:
        query_stream = await query({
            "prompt": "What time is it right now?",
            "options": {
                "path_to_claude_code_executable": CLAUDE_PATH,
                "agent": "time-assistant",
                "agents": {
                    "time-assistant": {
                        "description": "An assistant that can provide the current time.",
                        "prompt": "You are a helpful assistant that can provide the current time.",
                    }
                }
            }
        })

        async for message in query_stream:
            print(f"Message: {message}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
