use neon::prelude::*;
use imzx_core::Agent;

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

    // Kita butuh runtime tokio untuk menjalankan async Rust di dalam sinkronus Neon
    let rt = tokio::runtime::Runtime::new().map_err(|e| neon::Error::new(e.to_string()))?;

    let result = rt.block_on(async {
        ts_agent.inner.run(&input).await
    }).map_err(|e| neon::Error::new(e.to_string()))?;

    Ok(cx.string(&result).into())
}
