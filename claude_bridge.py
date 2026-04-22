#!/usr/bin/env python3
import sys
import json

# This is a Mock Bridge that mimics the Claude CLI for SDK testing on Android
def main():
    # Keep the bridge open to handle multiple requests in a loop
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            # In a real scenario, this would communicate with the Claude API
            # For now, we return a mock response to verify the SDK's orchestration
            response = {
                "status": "success",
                "content": f"Mock Bridge Response: I received your prompt: '{line[:50]}...'"
            }
            print(json.dumps(response), flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)

if __name__ == "__main__":
    main()
