import imzxCore from '../bindings/typescript/src/index'; // Sesuaikan path jika perlu

async function runTest() {
    console.log("--- Starting TypeScript Binding Test ---");

    const name = "TS-Test-Agent";
    const description = "A test agent for TS";
    const prompt = "You are a test agent";

    console.log(`Initializing: ${name}`);
    // Note: In real Neon, agentNew might return a pointer/object
    const initMsg = imzxCore.agentNew(name, description, prompt);
    console.log(`Status: ${initMsg}`);

    const testInput = "Hello from TypeScript!";
    console.log(`Sending Input: '${testInput}'`);

    try {
        const response = imzxCore.agentRun(testInput);
        console.log(`Received Response: '${response}'`);

        // Validation
        if (response.includes("Rust-powered response") && response.includes(testInput)) {
            console.log("✅ SUCCESS: Agent responded correctly via Rust Core.");
        } else {
            console.error("❌ FAILED: Response content mismatch.");
            process.exit(1);
        }
    } catch (error) {
        console.error(`❌ FAILED: An error occurred: ${error}`);
        process.exit(1);
    }

    console.log("--- Test Completed Successfully ---");
}

runTest();
