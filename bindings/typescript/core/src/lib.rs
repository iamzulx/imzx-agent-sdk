import { Neon } from '@neon-bindings/neon';
import { Agent, ModelRegistry, AnthropicProvider } from 'imzx-core';

#[neon::wrap]
pub struct TsAgent {
    pub inner: Agent,
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("agentNew", ts_agent_new)?;
    cx.export_function("registerModel", ts_agent_register_model)?;
    cx.export_function("setModel", ts_agent_set_model)?;
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

fn ts_agent_register_model(mut cx: FunctionContext) -> JsResult<()> {
    let mut ts_agent = cx.argument::<TsAgent>(0)
        .map_err(|_| neon::Error::new("Missing agent instance"))?;
    
    let model_name = cx.argument::<JsString>(1)
        .map_err(|_| neon::Error::new("Missing model name"))?
        .to_string(&mut cx);
    
    let api_key = cx.argument::<JsString>(2)
        .map_err(|_| neon::Error::new("Missing api key"))?
        .to_string(&mut cx);

    let provider = std::sync::Arc::new(AnthropicProvider {
        api_key,
        model_name,
    });
    
    ts_agent.inner.llm_registry.register(provider);
    Ok(())
}

fn ts_agent_set_model(mut cx: FunctionContext) -> JsResult<()> {
    let mut ts_agent = cx.argument::<TsAgent>(0)
        .map_err(|_| neon::Error::new("Missing agent instance"))?;
    
    let model_name = cx.argument::<JsString>(1)
        .map_err(|_| neon::Error::new("Missing model name"))?
        .to_string(&mut cx);
        
    ts_agent.inner.set_model(&model_name);
    Ok(())
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
