<script>
  export let config;

  $: if (!config.metrics) {
    config.metrics = {
      enabled: false,
      host: "127.0.0.1",
      port: 9091,
      path: "/metrics",
    };
  }
</script>

<h3 class="card-title text-sm">
  <i class="fa-solid fa-chart-line opacity-50 mr-1"></i> Metrics
  <span class="restart-hint"
    ><i class="fa-solid fa-rotate-right"></i> 修改需重启</span
  >
</h3>
<p class="text-xs opacity-50 mb-3">
  Prometheus exporter 默认关闭；启用后暴露 scrape 端点。
</p>

<label class="cfg-check mb-3">
  <input
    type="checkbox"
    class="toggle toggle-xs"
    bind:checked={config.metrics.enabled}
  />
  <span>启用</span>
</label>

<div class="cfg-grid-3">
  <label class="cfg-field">
    <span class="cfg-label">主机名 / IP</span>
    <input
      type="text"
      class="input input-xs input-bordered w-full"
      bind:value={config.metrics.host}
      placeholder="127.0.0.1"
    />
  </label>
  <label class="cfg-field">
    <span class="cfg-label">端口</span>
    <input
      type="number"
      class="input input-xs input-bordered w-full"
      bind:value={config.metrics.port}
      placeholder="9091"
    />
  </label>
  <label class="cfg-field">
    <span class="cfg-label">路径</span>
    <input
      type="text"
      class="input input-xs input-bordered w-full"
      bind:value={config.metrics.path}
      placeholder="/metrics"
    />
  </label>
</div>
