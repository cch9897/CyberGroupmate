<script>
  import { appState, activeTab } from '../lib/stores.js';
  import { api } from '../lib/api.js';
  import { shortId, getPlatform, platformLabel } from '../lib/utils.js';

  const LIST_LIMIT = 100;
  const GROUP_OVERVIEW_LIMIT = 200;

  let globalStateSummary = { sections: [], recent: {} };
  let rawGlobalStateText = '';
  let rawGlobalStateLoading = false;
  let rawGlobalStateError = '';
  let showRawGlobalState = false;
  let systemLoading = false;
  let systemError = '';
  let refreshSeq = 0;
  let pool = {};
  let trackingWindows = [];
  let callbacks = [];

  $: groups = $appState.groups;
  $: poolInstances = (pool.instances || []).slice(0, LIST_LIMIT);
  $: visibleGroups = groups.slice(0, GROUP_OVERVIEW_LIMIT);
  $: if ($activeTab === 'system') refreshSystem();

  async function refreshSystem() {
    const seq = ++refreshSeq;
    systemLoading = true;
    systemError = '';
    try {
      const [summary, poolStats, tracking, callbackItems] = await Promise.all([
        api('/global-state/summary'),
        api('/sandbox/pool'),
        api('/dispatch-tracking'),
        api('/callbacks'),
      ]);
      if (seq !== refreshSeq) return;

      globalStateSummary = summary || { sections: [], recent: {} };
      pool = poolStats || {};
      trackingWindows = tracking?.activeWindows || [];
      callbacks = callbackItems || [];
    } catch (err) {
      if (seq === refreshSeq) systemError = String(err);
    } finally {
      if (seq === refreshSeq) systemLoading = false;
    }
  }

  async function toggleRawGlobalState() {
    showRawGlobalState = !showRawGlobalState;
    if (showRawGlobalState && !rawGlobalStateText && !rawGlobalStateLoading) {
      await loadRawGlobalState();
    }
  }

  async function loadRawGlobalState() {
    rawGlobalStateLoading = true;
    rawGlobalStateError = '';
    try {
      const gs = await api('/global-state');
      rawGlobalStateText = JSON.stringify(gs, null, 2);
    } catch (err) {
      rawGlobalStateError = String(err);
    } finally {
      rawGlobalStateLoading = false;
    }
  }

  function timeAgo(isoDate) {
    if (!isoDate) return '-';
    const diff = Date.now() - new Date(isoDate).getTime();
    if (diff < 60000) return '刚刚';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }
</script>

<div class="grid grid-cols-2 gap-4 system-grid">
  <!-- Global State -->
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">
        全局状态
        {#if systemLoading}<span class="loading loading-spinner loading-xs ml-1"></span>{/if}
        <button class="btn btn-xs btn-ghost ml-auto" title="刷新" on:click={refreshSystem}>
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button class="btn btn-xs btn-ghost" title="查看完整 JSON" on:click={toggleRawGlobalState}>
          <i class="fa-solid fa-code"></i>
          {showRawGlobalState ? '收起' : 'JSON'}
        </button>
      </h3>

      {#if systemError}
        <div class="alert alert-error py-2 text-xs">{systemError}</div>
      {/if}

      <div class="grid grid-cols-2 gap-2">
        {#each globalStateSummary.sections || [] as section}
          <div class="rounded bg-base-200 p-2">
            <div class="text-[10px] uppercase opacity-60">{section.label}</div>
            <div class="text-lg font-bold leading-tight">{section.count}</div>
            {#if section.detail}
              <div class="text-[10px] opacity-60 truncate" title={section.detail}>{section.detail}</div>
            {/if}
          </div>
        {/each}
      </div>

      {#if globalStateSummary.recent?.metaSessionHistory?.length}
        <div class="mt-3">
          <div class="text-xs font-bold mb-1 opacity-70">最近 Meta History</div>
          <div class="space-y-1">
            {#each globalStateSummary.recent.metaSessionHistory as entry}
              <div class="text-xs px-2 py-1 bg-base-200 rounded">
                <span class="badge badge-xs badge-ghost mr-1">{entry.role}</span>
                <span class="opacity-50 mr-1">{timeAgo(entry.timestamp)}</span>
                <span class="opacity-80">{entry.content}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showRawGlobalState}
        <div class="mt-3">
          {#if rawGlobalStateLoading}
            <div class="text-xs opacity-60">加载完整 JSON...</div>
          {:else if rawGlobalStateError}
            <div class="alert alert-error py-2 text-xs">{rawGlobalStateError}</div>
          {:else}
            <pre class="json-display bg-base-300 p-3 rounded-lg overflow-auto max-h-[30vh] text-xs whitespace-pre-wrap">{rawGlobalStateText}</pre>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Sandbox Pool -->
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">SandboxPool 状态</h3>
      <div class="stats stats-vertical shadow w-full">
        <div class="stat py-2">
          <div class="stat-title text-xs">总实例 / 使用中 / 空闲</div>
          <div class="stat-value text-sm">{pool.total || 0} / {pool.inUse || 0} / {pool.idle || 0}</div>
        </div>
      </div>
      {#if (pool.instances || []).length}
        <div class="mt-2 space-y-1">
          {#each poolInstances as i}
            <div class="flex justify-between text-xs px-2 py-1 bg-base-200 rounded">
              <span class="font-mono">
                {#if getPlatform(i.chatId)}<span class="platform-badge platform-{getPlatform(i.chatId)}">{platformLabel(getPlatform(i.chatId))}</span>{/if}
                {shortId(i.chatId)}
              </span>
              <span class="badge badge-xs" class:badge-error={i.inUse} class:badge-success={!i.inUse}>
                {i.inUse ? '使用中' : '空闲'}
              </span>
            </div>
          {/each}
          {#if (pool.instances || []).length > poolInstances.length}
            <div class="text-[10px] opacity-50 px-2">仅显示前 {LIST_LIMIT} 个实例，共 {(pool.instances || []).length} 个</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Dispatch tracking -->
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">Dispatch 待跟进</h3>
      {#if trackingWindows.length}
        {#each trackingWindows as w}
          <div class="flex justify-between text-xs px-2 py-1 bg-base-200 rounded mb-1">
            <span class="font-mono">
              {#if getPlatform(w.chatId)}<span class="platform-badge platform-{getPlatform(w.chatId)}">{platformLabel(getPlatform(w.chatId))}</span>{/if}
              {shortId(w.chatId)}
            </span>
            <span>剩余 {(w.remainingMs / 1000).toFixed(0)}s</span>
          </div>
        {/each}
      {:else}
        <div class="text-xs opacity-60">无待跟进窗口</div>
      {/if}
    </div>
  </div>

  <!-- Group Overview -->
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">群组概览 (Stickiness + Engagement)</h3>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead><tr>
            <th>ChatId</th><th>Stickiness</th><th>Engagement</th><th>Buffer</th><th>Attend #</th>
          </tr></thead>
          <tbody>
            {#each visibleGroups as g}
              <tr>
                <td class="font-mono text-xs">
                  {#if getPlatform(g.chatId)}<span class="platform-badge platform-{getPlatform(g.chatId)}">{platformLabel(getPlatform(g.chatId))}</span>{/if}
                  {shortId(g.chatId)}
                </td>
                <td class="stickiness-{g.stickiness}">{g.stickiness}</td>
                <td>{(g.engagement || 0).toFixed(1)}</td>
                <td>{g.bufferSize || 0}</td>
                <td>{g.attendCount || 0}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if groups.length > visibleGroups.length}
        <div class="text-[10px] opacity-50 mt-1">仅显示前 {GROUP_OVERVIEW_LIMIT} 个群组，共 {groups.length} 个</div>
      {/if}
    </div>
  </div>

  <!-- Callbacks -->
  <div class="card bg-base-100 col-span-2">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">最近 Callbacks (Q5)</h3>
      <div class="space-y-1 overflow-y-auto max-h-[30vh] text-xs font-mono">
        {#if !callbacks.length}
          <div class="opacity-60">无回调</div>
        {:else}
          {#each callbacks.slice(-20) as cb}
            <div class="decision-item">
              <span class="badge badge-xs" class:badge-success={cb.status === 'COMPLETED'} class:badge-error={cb.status !== 'COMPLETED'}>{cb.status}</span>
              <span class="font-mono">
                {#if getPlatform(cb.chatId)}<span class="platform-badge platform-{getPlatform(cb.chatId)}">{platformLabel(getPlatform(cb.chatId))}</span>{/if}
                {shortId(cb.chatId)}
              </span>
              <span class="badge badge-xs">{cb.executionType}</span>
              {cb.summary || ''}
              <span class="opacity-50">{cb.durationMs}ms</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  @media (max-width: 768px) {
    .system-grid { grid-template-columns: 1fr !important; }
    .system-grid .col-span-2 { grid-column: span 1 !important; }
  }
</style>
