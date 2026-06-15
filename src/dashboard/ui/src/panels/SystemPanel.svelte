<script>
  import { appState, activeTab } from '../lib/stores.js';
  import { api } from '../lib/api.js';
  import { shortId, getPlatform, platformLabel } from '../lib/utils.js';

  const LIST_LIMIT = 100;
  const GROUP_OVERVIEW_LIMIT = 200;
  const EMPTY_SCHEDULER = { reminders: [], crons: [], summary: {} };

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
  let scheduler = EMPTY_SCHEDULER;
  let showTriggeredReminders = false;

  $: groups = $appState.groups;
  $: activeReminders = (scheduler.reminders || []).filter(r => !r.triggered);
  $: triggeredReminders = (scheduler.reminders || []).filter(r => r.triggered);
  $: visibleActiveReminders = activeReminders.slice(0, LIST_LIMIT);
  $: visibleTriggeredReminders = triggeredReminders.slice(0, LIST_LIMIT);
  $: visibleCrons = (scheduler.crons || []).slice(0, LIST_LIMIT);
  $: poolInstances = (pool.instances || []).slice(0, LIST_LIMIT);
  $: visibleGroups = groups.slice(0, GROUP_OVERVIEW_LIMIT);
  $: if ($activeTab === 'system') refreshSystem();

  async function refreshSystem() {
    const seq = ++refreshSeq;
    systemLoading = true;
    systemError = '';
    try {
      const [summary, poolStats, tracking, callbackItems, schedulerState] = await Promise.all([
        api('/global-state/summary'),
        api('/sandbox/pool'),
        api('/dispatch-tracking'),
        api('/callbacks'),
        api('/scheduler'),
      ]);
      if (seq !== refreshSeq) return;

      globalStateSummary = summary || { sections: [], recent: {} };
      pool = poolStats || {};
      trackingWindows = tracking?.activeWindows || [];
      callbacks = callbackItems || [];
      scheduler = schedulerState || EMPTY_SCHEDULER;
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

  function timeUntil(isoDate) {
    if (!isoDate) return '-';
    const diff = new Date(isoDate).getTime() - Date.now();
    if (diff <= 0) return '已到期';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分钟后`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时${mins % 60}分后`;
    const days = Math.floor(hours / 24);
    return `${days}天后`;
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

  async function cancelEvent(id) {
    if (!confirm('确认取消此调度？')) return;
    await api(`/scheduler/${id}`, { method: 'DELETE' });
    await refreshSystem();
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

  <!-- Scheduler -->
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <h3 class="card-title text-sm">
        <i class="fa-solid fa-clock opacity-50 mr-1"></i>定时调度
        <span class="badge badge-sm badge-ghost ml-auto">
          {(scheduler.summary || {}).activeReminders || 0} 提醒 / {(scheduler.summary || {}).totalCrons || 0} 周期
        </span>
      </h3>

      <!-- Reminders -->
      {#if (scheduler.reminders || []).length}
        <div class="text-xs font-bold mt-2 mb-1 opacity-70">
          <i class="fa-solid fa-bell mr-1"></i>Reminders
        </div>
        <div class="space-y-1">
          {#each visibleActiveReminders as r}
            <div class="flex items-start gap-2 text-xs px-2 py-1.5 bg-base-200 rounded">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1">
                  <span class="badge badge-xs badge-success">⏳</span>
                  {#if getPlatform(r.chatId)}<span class="platform-badge platform-{getPlatform(r.chatId)}">{platformLabel(getPlatform(r.chatId))}</span>{/if}
                  <span class="font-mono">{shortId(r.chatId)}</span>
                  <span class="opacity-50 ml-auto whitespace-nowrap">{timeUntil(r.triggerAt)}</span>
                </div>
                <div class="mt-0.5 truncate" title={r.description}>{r.description}</div>
              </div>
              <button class="btn btn-xs btn-ghost text-error flex-shrink-0" title="取消" on:click={() => cancelEvent(r.id)}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          {/each}
          {#if activeReminders.length > visibleActiveReminders.length}
            <div class="text-[10px] opacity-50 px-2">仅显示前 {LIST_LIMIT} 个未触发提醒，共 {activeReminders.length} 个</div>
          {/if}
        </div>
        {#if triggeredReminders.length > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex items-center gap-1 text-xs opacity-50 mt-2 cursor-pointer select-none hover:opacity-80"
            on:click={() => showTriggeredReminders = !showTriggeredReminders}
          >
            <i class="fa-solid fa-chevron-right text-[10px] transition-transform" style:transform={showTriggeredReminders ? "rotate(90deg)" : ""}></i>
            <span>已触发 ({triggeredReminders.length})</span>
          </div>
          {#if showTriggeredReminders}
            <div class="space-y-1 mt-1">
              {#each visibleTriggeredReminders as r}
                <div class="flex items-start gap-2 text-xs px-2 py-1.5 bg-base-200 rounded opacity-40">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1">
                      <span class="badge badge-xs badge-ghost">✓</span>
                      {#if getPlatform(r.chatId)}<span class="platform-badge platform-{getPlatform(r.chatId)}">{platformLabel(getPlatform(r.chatId))}</span>{/if}
                      <span class="font-mono">{shortId(r.chatId)}</span>
                      <span class="opacity-50 ml-auto whitespace-nowrap">已触发</span>
                    </div>
                    <div class="mt-0.5 truncate" title={r.description}>{r.description}</div>
                  </div>
                </div>
              {/each}
              {#if triggeredReminders.length > visibleTriggeredReminders.length}
                <div class="text-[10px] opacity-50 px-2">仅显示前 {LIST_LIMIT} 个已触发提醒，共 {triggeredReminders.length} 个</div>
              {/if}
            </div>
          {/if}
        {/if}
      {/if}

      <!-- Crons -->
      {#if (scheduler.crons || []).length}
        <div class="text-xs font-bold mt-3 mb-1 opacity-70">
          <i class="fa-solid fa-repeat mr-1"></i>Crons
        </div>
        <div class="space-y-1">
          {#each visibleCrons as c}
            <div class="flex items-start gap-2 text-xs px-2 py-1.5 bg-base-200 rounded">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1">
                  <span class="badge badge-xs badge-info">⟳</span>
                  {#if getPlatform(c.chatId)}<span class="platform-badge platform-{getPlatform(c.chatId)}">{platformLabel(getPlatform(c.chatId))}</span>{/if}
                  <span class="font-mono">{shortId(c.chatId)}</span>
                  <code class="text-[10px] opacity-60 ml-1">{c.cronExpr}</code>
                  <span class="opacity-50 ml-auto whitespace-nowrap">
                    {c.lastTriggeredAt ? timeAgo(c.lastTriggeredAt) : '未触发'}
                  </span>
                </div>
                <div class="mt-0.5 font-semibold">{c.description}</div>
                {#if c.taskTemplate && c.taskTemplate !== c.description}
                  <div class="mt-0.5 truncate opacity-60" title={c.taskTemplate}>{c.taskTemplate}</div>
                {/if}
              </div>
              <button class="btn btn-xs btn-ghost text-error flex-shrink-0" title="取消" on:click={() => cancelEvent(c.id)}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          {/each}
          {#if (scheduler.crons || []).length > visibleCrons.length}
            <div class="text-[10px] opacity-50 px-2">仅显示前 {LIST_LIMIT} 个周期任务，共 {(scheduler.crons || []).length} 个</div>
          {/if}
        </div>
      {/if}

      {#if !(scheduler.reminders || []).length && !(scheduler.crons || []).length}
        <div class="text-xs opacity-60 mt-2">无调度事件</div>
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
