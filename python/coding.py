# Coding agent example (Professional Code Reviewer)
import asyncio
import os
import subprocess
from claude_agent_sdk import query

CLAUDE_PATH = '/data/data/com.termux/files/home/projects/xxx/claude_bridge.py'

# --- Tool Implementations ---

def read_file_execute(**kwargs):
    file_path = kwargs.get("path")
    try:
        with open(os.path.abspath(file_path), 'r') as f:
            return {"content": f.read()}
    except Exception as e:
        return {"content": f"Error reading file: {str(e)}"}

def list_files_execute(**kwargs):
    directory = kwargs.get("dir", ".")
    try:
        files = os.listdir(os.path.abspath(directory))
        return {"content": "\n".join(files)}
    except Exception as e:
        return {"content": f"Error listing directory: {str(e)}"}

def search_code_execute(**kwargs):
    pattern = kwargs.get("pattern")
    try:
        # Use grep for searching
        result = subprocess.run(['grep', '-r', pattern, '.'],
                               capture_output=True, text=True)
        if result.returncode == 0:
            return {"content": result.stdout}
        elif result.returncode == 1:
            return {"content": "No matches found."}
        else:
            return {"content": f"Error searching code: {result.stderr}"}
    except Exception as e:
        return {"content": f"Error searching code: {str(e)}"}

def write_file_execute(**kwargs):
    file_path = kwargs.get("path")
    content = kwargs.get("content")
    try:
        abs_path = os.path.abspath(file_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, 'w') as f:
            f.write(content)
        return {"content": f"Successfully wrote to {file_path}"}
    except Exception as e:
        return {"content": f"Error writing file: {str(e)}"}

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
