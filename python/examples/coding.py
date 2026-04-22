# Coding agent example (Professional Code Reviewer)
import asyncio
import os
from dotenv import load_dotenv
from claude_agent_sdk import query
from imzx.tools import read_file_execute, list_files_execute, search_code_execute, write_file_execute

load_dotenv()
CLAUDE_PATH = os.getenv('CLAUDE_BRIDGE_PATH', './claude_bridge.py')

# --- Agent Execution ---

async def main():
    try:
        query_stream = await query({
            "prompt": "Please explore the current project directory, find the Python examples, and suggest one improvement to the hello.py file.",
            "options": {
                "path_to_claude_code_executable": CLAUDE_PATH,
                "agent": "code-reviewer",
                "agents": {
                    "code-reviewer": {
                        "description": "Expert code reviewer and project architect",
                        "prompt": "You are an expert code reviewer. You have access to tools to explore the filesystem, read code, search for patterns, and write files. Always explore the directory structure first using list_files before attempting to read specific files."
                    }
                }
            }
        })

        async for message in query_stream:
            print(f"Agent Response: {message}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
