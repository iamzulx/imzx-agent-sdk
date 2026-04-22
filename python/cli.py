#!/usr/bin/env python3
import asyncio
import argparse
import json
import os
from claude_agent_sdk import query, ClaudeAgentOptions, InMemorySessionStore

CLAUDE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'claude_bridge.py'))
PERSONA_DIR = os.path.join(os.path.dirname(__file__), '..', 'personas')

async def main():
    parser = argparse.ArgumentParser(description="Claude Agent SDK Python CLI")
    parser.add_argument("prompt", help="The prompt to send to the agent")
    parser.add_argument("persona", nargs="?", default="general-purpose", help="The persona to use (defaults to general-purpose)")
    args = parser.parse_args()

    # Load persona from JSON
    persona_path = os.path.join(PERSONA_DIR, f"{args.persona}.json")
    try:
        with open(persona_path, 'r') as f:
            persona_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Persona '{args.persona}' not found in {PERSONA_DIR}")
        return

    print(f"\\n🚀 Querying agent [{args.persona}] with prompt: \"{args.prompt}\"\\n")

    try:
        options = ClaudeAgentOptions(
            cli_path=CLAUDE_PATH,
            system_prompt=persona_data.get('prompt', ''),
            session_store=InMemorySessionStore()
        )
        query_stream = query(
            prompt=args.prompt,
            options=options
        )

        async for message in query_stream:
            print(f"Agent Response: {message}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
