import imzx_core
import asyncio

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
    asyncio.run(test_agent_logic())
