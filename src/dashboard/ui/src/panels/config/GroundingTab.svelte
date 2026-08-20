<script>
  import { api } from "../../lib/api.js";

  export let config;
  export let pwFocus;
  export let pwBlur;

  let testText = "User 1: 今天世界上发生了什么大事？";
  let testing = false;
  let testResult = null;

  async function testGrounding() {
    testing = true;
    testResult = null;
    try {
      const res = await api("/grounding/test", {
        method: "POST",
        body: {
          provider: config.grounding.provider,
          apiKey: config.grounding.apiKey,
          baseUrl: config.grounding.baseUrl,
          model: config.grounding.model,
          testText,
        },
      });
      testResult = res;
    } catch (err) {
      testResult = { ok: false, error: String(err) };
    } finally {
      testing = false;
    }
  }
</script>

<h3 class="card-title text-sm">
  <i class="fa-solid fa-globe opacity-50 mr-1"></i> Grounding (联网事实查证)
  <label class="flex items-center gap-1 ml-2 cursor-pointer">
    <input type="checkbox" class="toggle toggle-xs toggle-primary" bind:checked={config.grounding.enabled} />
    <span class="text-xs {config.grounding.enabled ? 'text-success' : 'opacity-50'}">
      {config.grounding.enabled ? '已启用' : '已关闭'}
    </span>
  </label>
</h3>
<p class="text-xs opacity-50 mb-3">
  在主 Agent 决策时并行查询真实世界信息，用于事实查证和知识补充。关闭后生产消息流程不再触发（Dashboard 手动测试不受影响）。
</p>

<div class="cfg-grid-2">
  <label class="cfg-field">
    <span class="cfg-label">搜索引擎</span>
    <select
      class="select select-xs select-bordered w-full"
      bind:value={config.grounding.provider}
    >
      <option value="google">Google (Gemini)</option>
      <option value="grok">Grok (xAI)</option>
      <option value="custom">Custom (OpenAI 兼容)</option>
    </select>
  </label>

  <label class="cfg-field">
    <span class="cfg-label">API Key</span>
    <input
      type="password"
      class="input input-xs input-bordered w-full"
      bind:value={config.grounding.apiKey}
      placeholder="输入 API Key"
      on:focus={pwFocus}
      on:blur={pwBlur}
    />
  </label>

  <label class="cfg-field">
    <span class="cfg-label">Base URL <span class="opacity-40">(custom 必填)</span></span>
    <input
      type="text"
      class="input input-xs input-bordered w-full"
      bind:value={config.grounding.baseUrl}
      placeholder={config.grounding.provider === 'grok' ? 'https://api.x.ai/v1' : config.grounding.provider === 'custom' ? 'https://网关地址/v1' : '(Google 无需设置)'}
    />
  </label>

  <label class="cfg-field">
    <span class="cfg-label">模型 <span class="opacity-40">(custom 必填)</span></span>
    <input
      type="text"
      class="input input-xs input-bordered w-full"
      bind:value={config.grounding.model}
      placeholder={config.grounding.provider === 'grok' ? 'grok-3-mini-fast' : config.grounding.provider === 'custom' ? '支持联网搜索的模型，如 google/gemini-3-flash-preview' : 'gemini-2.0-flash-lite'}
    />
  </label>
</div>

<div class="mt-3 p-2 rounded bg-base-200 text-xs opacity-60">
  <i class="fa-solid fa-circle-info mr-1"></i>
  {#if config.grounding.provider === 'google'}
    使用 <b>Gemini API</b> 的原生 Google Search Grounding 工具。需在 <a href="https://aistudio.google.com/apikey" target="_blank" class="link">AI Studio</a> 获取 API Key。
  {:else if config.grounding.provider === 'grok'}
    使用 <b>xAI Grok</b> 的 Web Search 工具（Responses API）。需在 <a href="https://console.x.ai" target="_blank" class="link">xAI Console</a> 获取 API Key。
  {:else}
    使用任意 <b>OpenAI 兼容端点</b>（ZenMux / OpenRouter / cliproxy 等网关），请求 <code>chat/completions</code> 并携带 <code>web_search_options</code> 触发联网搜索。网关需支持联网搜索能力，且响应带 <code>url_citation</code> 引用。
  {/if}
</div>

<div class="mt-3 p-2 rounded bg-base-200">
  <div class="text-xs font-semibold mb-1">
    <i class="fa-solid fa-flask mr-1"></i> 测试 Grounding
  </div>
  <textarea
    class="textarea textarea-xs textarea-bordered w-full font-mono text-xs"
    rows="3"
    bind:value={testText}
    placeholder="输入测试文本（至少 10 个字符）"
  ></textarea>
  <div class="flex items-center gap-2 mt-2">
    <button
      class="btn btn-primary btn-xs"
      on:click={testGrounding}
      disabled={testing}
    >
      {#if testing}
        <span class="loading loading-spinner loading-xs"></span> 测试中...
      {:else}
        <i class="fa-solid fa-flask"></i> 运行测试
      {/if}
    </button>
    {#if testResult?.elapsedMs != null}
      <span class="text-xs opacity-60">耗时 {testResult.elapsedMs}ms</span>
    {/if}
  </div>
  {#if testResult}
    <div
      class="mt-2 p-2 rounded text-xs whitespace-pre-wrap max-h-64 overflow-auto
        {testResult.ok && !testResult.dropped
          ? 'bg-success/10 text-success'
          : 'bg-error/10 text-error'}"
    >
      {#if testResult.ok && !testResult.dropped}
        <div class="font-semibold mb-1"><i class="fa-solid fa-circle-check mr-1"></i>搜索成功，返回 {testResult.result.length} 字符</div>
        {testResult.result}
      {:else}
        <div class="font-semibold mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>{testResult.error ?? '测试失败'}</div>
        {testResult.error ?? ''}
      {/if}
    </div>
  {/if}
</div>
