import os
import asyncio
import json
import argparse
import sys
from dotenv import load_dotenv
import imzx_core

load_dotenv()

# Navigate 3 levels up from app/python-cli/main.py to reach project root
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PERSONA_DIR = os.getenv('PERSONA_DIR', os.path.join(BASE_DIR, 'personas'))

async def run_agent(prompt, agent_name):
    """The core logic for running an agent."""
    try:
        # 1. Load and Validate Persona
        persona_path = os.path.join(PERSONA_DIR, f"{agent_name}.json")
        with open(persona_path, 'r') as f:
            persona_data = json.load(f)

        if 'description' not in persona_data or 'prompt' not not in persona_data:
            raise ValueError(f"Invalid persona format in {persona_path}")

        print(f"[imzx] Loaded persona: {agent_name}")

        # 2. Initialize Agent via Rust Bindings
        print(f"[imzx] Initializing agent: {agent_name}...")
        agent = imzx_core.PyAgent(
            agent_name,
            persona_data['description'],
            persona_data['prompt']
        )
        print(f"Status: Agent initialized via Rust Core")

        # 3. Run Agent via Rust Bindings
        print(f"[imzx] Querying: '{prompt}'")
        response = agent.run(prompt)

        print('\n--- Agent Response ---')
        print(response)
        print('----------------------\n')

    except FileNotFoundError:
        print(f"[ERROR] Persona '{agent_name}.json' not found in {PERSONA_DIR}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        sys.exit(1)

async def cmd_persona_list(args):
    """List all available personas."""
    print(f"[imzx] Available personas in {PERSONA_DIR}:")
    files = [f[:-5] for f in os.listdir(PERSONA_DIR) if f.endswith('.json')]
    if not files:
        print("  (No personas found)")
    for f in sorted(files):
        print(f"  - {f}")

async def cmd_persona_add(args):
    """Add a new persona."""
    persona_path = os.path.join(PERSONA_DIR, f"{args.name}.json")
    if os.path.exists(persona_path):
        print(f"[ERROR] Persona '{args.name}' already exists.")
        sys.exit(1)

    data = {
        "description": args.desc,
        "prompt": args.prompt
    }
    with open(persona_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"[imzx] Persona '{args.name}' created successfully.")

async def cmd_persona_delete(args):
    """Delete a persona."""
    persona_path = os.path.join(PERSONA_DIR, f"{args.name}.json")
    if os.path.exists(persona_path):
        os.remove(persona_path)
        print(f"[imzx] Persona '{args.name}' deleted.")
    else:
        print(f"[ERROR] Persona '{args.name}' not found.")
        sys.exit(1)

async def main():
    parser = argparse.ArgumentParser(description="imzx Python CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Subcommand: run (default behavior)
    # We use a special name 'run' but we can make it the default if no command is provided
    run_parser = subparsers.add_parser('run', help='Run an agent')
    run_parser.add_argument('prompt', help='The prompt to send to the agent')
    run_parser.add_argument('agent_name', nargs='?', default='general-purpose', help='Name of the persona to use')

    # Subcommand: persona
    persona_parser = subparsers.add_parser('persona', help='Manage agent personalities')
    persona_subparsers = persona_parser.add_subparsers(dest="subcommand", help="Persona subcommands")

    # persona list
    persona_subparsers.add_parser('list', help='List all personas')

    # persona add
    add_parser = persona_subparsers.add_parser('add', help='Add a new persona')
    add_parser.add_argument('name', help='Name of the new persona')
    add_parser.add_argument('--desc', required=True, help='Description of the persona')
    add_parser.add_argument('--prompt', required=True, help='System prompt for the persona')

    # persona delete
    del_parser = persona_subparsers.add_parser('delete', help='Delete a persona')
    del_parser.add_argument('name', help='Name of the persona to delete')

    # Parse arguments
    args = parser.parse_args()

    # Handle the case where no subcommand is provided (default to 'run')
    if args.command is None:
        # If no subcommand, treat as positional arguments for 'run'
        # This is a bit tricky with argparse, so we'll re-parse manually for simplicity
        # or just use positional args at the top level.
        # For simplicity in this implementation, we'll require 'run' or use positional.

        # Let's re-implement to allow "python main.py <prompt> [persona]"
        # We'll check if the first arg looks like a subcommand.
        if len(sys.argv) > 1 and sys.argv[1] in ['run', 'persona']:
            # Let argparse handle it
            pass
        else:
            # Manually simulate 'run' command
            if len(sys.argv) < 2:
                parser.print_help()
                sys.exit(1)
            # Re-parse as if 'run' was passed
            sys.argv.insert(1, 'run')
            args = parser.parse_args()

    # Dispatch commands
    if args.command == 'run':
        await run_agent(args.prompt, args.agent_name)
    elif args.command == 'persona':
        if args.subcommand == 'list':
            await cmd_persona_list(args)
        elif args.subcommand == 'add':
            await cmd_persona_add(args)
        elif args.subcommand == 'delete':
            await cmd_persona_delete(args)
        else:
            persona_parser.print_help()
    else:
        parser.print_help()

if __name__ == "__main__":
    asyncio.run(main())
