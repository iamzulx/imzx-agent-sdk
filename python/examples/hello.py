# Minimal Hello World example
import asyncio
import os
from dotenv import load_dotenv
from claude_agent_sdk import query

load_dotenv()
CLAUDE_PATH = os.getenv('CLAUDE_BRIDGE_PATH', './claude_bridge.py')

# Simple query example using the functional API
async def main():
    try:
        query_stream = await query({
            "prompt": "Hello! What is your name?",
            "options": {
                "path_to_claude_code_executable": CLAUDE_PATH,
                "agent": "friendly-assistant",
                "agents": {
                    "friendly-assistant": {
                        "description": "A friendly assistant",
                        "prompt": "You are a friendly assistant.",
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
