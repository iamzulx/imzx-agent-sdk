import imzx_core
import asyncio
import sys

async def test_agent_logic():
    print("--- Starting Python Binding Test ---")

    name = "TestAgent"
    description = "A test agent"
    prompt = "You are a test agent"

    print(f"Initializing: {name}")
    agent = imzx_core.PyAgent(name, description, prompt)

    test_input = "Hello, Rust!"
    print(f"Sending Input: '{test_input}'")

    # No try-except here to allow AssertionError to bubble up
    response = agent.run(test_input)
    print(f"Received Response: '{response}'")

    # Validation
    print("Validating response content...")
    assert "Hello! I received your message" in response
    assert test_input in response
    print("✅ SUCCESS: Agent responded correctly via Rust Core.")

    print("--- Test Completed Successfully ---")

if __name__ == "__main__":
    try:
        asyncio.run(test_agent_logic())
    except Exception as e:
        print(f"❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
