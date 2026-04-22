import os
import sys
import asyncio
import subprocess
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def run_test_case(name, prompt, expected_substring=None):
    print(f"🧪 Testing: {name}")
    try:
        # Run the CLI via subprocess to test the full end-to-end flow
        process = await asyncio.create_subprocess_exec(
            'python3', 'main.py', prompt, 'general-purpose',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        output = stdout.decode().strip()
        error = stderr.decode().strip()

        if process.returncode != 0:
            print(f"  ❌ FAILED: Process exited with code {process.returncode}")
            if error: print(f"     Error: {error}")
            return False

        if expected_substring and expected_substring not in output:
            print(f"  ❌ FAILED: Expected substring '{expected_substring}' not found in output.")
            print(f"     Actual Output: {output}")
            return False

        print(f"  ✅ PASSED")
        return True
    except Exception as e:
        print(f"  ❌ FAILED: Exception occurred: {e}")
        return False

async def main():
    print("================================================")
    print("🚀 STARTING INTEGRATION TEST SUITE")
    print("================================================\n")

    tests = [
        {
            "name": "Basic Response",
            "prompt": "Hello, how are you?",
            "expected": "Hello!"
        },
        {
            "name": "Filesystem: Write and Read",
            "prompt": "Create a file named 'test_imzx.txt' with content 'imzx is awesome' and then read it back.",
            "expected": "imzx is awesome"
        },
        {
            "name": "Shell: List Directory",
            "prompt": "Run the command 'ls' and tell me the files in this directory.",
            "expected": "STDOUT:"
        },
        {
            "name": "ReAct Loop: Multi-step Task",
            "prompt": "Create a file named 'complex_task.txt', write 'task completed' to it, and then list the files in this directory to confirm it exists.",
            "expected": "complex_task.txt"
        },
        {
            "name": "Error Handling: Non-existent file",
            "prompt": "Read the file 'non_existent_file_xyz.txt' which does not exist.",
            "expected": "Error"
        }
    ]

    passed = 0
    for test in tests:
        if await run_test_case(test["name"], test["prompt"], test.get("expected")):
            passed += 1
        print("-" * 48)

    print(f"\nSummary: {passed}/{len(tests)} tests passed.")
    if passed == len(tests):
        print("\n✨ ALL TESTS PASSED! The system is solid.")
        sys.exit(0)
    else:
        print("\n❌ SOME TESTS FAILED. Please check the logs.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
