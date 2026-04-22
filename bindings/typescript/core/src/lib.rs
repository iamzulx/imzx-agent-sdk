use neon::prelude::*;
use imzx_core::Agent;
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    Idle,
    Thinking,
    CallingTool { tool_name: String, args: String },
    Responding,
    Error(String),
}

pub static RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to initialize global Tokio runtime")
});

#[neon::wrap]
pub struct TsAgent {
    pub inner: Agent,
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("agentNew", ts_agent_new)?;
    cx.export_function("agentRun", ts_agent_run)?;
    Ok(())
}

fn ts_agent_new(mut cx: FunctionContext) -> JsResult<JsValue> {
    let name = cx.argument::<JsString>(0)
        .map_err(|_| neon::Error::new("Missing name"))?
        .to_string(&mut cx);

    let description = cx.argument::<JsString>(1)
        .map_err(|_| neon::Error::new("Missing description"))?
        .to_string(&mut cx);

    let prompt = cx.argument::<JsString>(2)
        .map_err(|_| neon::Error::new("Missing prompt"))?
        .to_string(&mut cx);

    let agent = Agent::new(name, description, prompt);

    Ok(TsAgent { inner: agent }.into_js_value(cx))
}

fn ts_agent_run(mut cx: FunctionContext) -> JsResult<JsValue> {
    let mut ts_agent = cx.argument::<TsAgent>(0)
        .map_err(|_| neon::Error::new("Missing agent instance"))?;

    let input = cx.argument::<JsString>(1)
        .map_err(|_| neon::Error::new("Missing input"))?
        .to_string(&mut cx);

    let result = RUNTIME.block_on(async {
        ts_agent.inner.run(&input).await
    }).map_err(|e| neon::Error::new(e.to_string()))?;

    Ok(cx.string(&result).into())
}
