<script>
  import { activeTab } from '../lib/stores.js';
  import { api } from '../lib/api.js';
  import { shortId, getPlatform, platformLabel } from '../lib/utils.js';

  const LIST_LIMIT = 200;
  const EMPTY_SCHEDULER = { reminders: [], crons: [], summary: {} };

  let scheduler = EMPTY_SCHEDULER;
  let todoItems = [];
  let loading = false;
  let error = '';
  let refreshSeq = 0;
  let includeExpiredTodos = false;
  let selectedTodoBinding = '';
  let showTriggeredReminders = false;
  let editModal;
  let editType = '';
  let editTitle = '';
  let form = {};
  let dataText = '';
  let saveError = '';
  let saving = false;

  $: activeReminders = (scheduler.reminders || [])
    .filter((item) => !item.triggered)
    .sort((a, b) => String(a.triggerAt || '').localeCompare(String(b.triggerAt || '')));
  $: triggeredReminders = (scheduler.reminders || [])
    .filter((item) => item.triggered)
    .sort((a, b) => String(b.triggerAt || '').localeCompare(String(a.triggerAt || '')));
  $: visibleActiveReminders = activeReminders.slice(0, LIST_LIMIT);
  $: visibleTriggeredReminders = triggeredReminders.slice(0, LIST_LIMIT);
  $: visibleCrons = (scheduler.crons || []).slice(0, LIST_LIMIT);
  $: todoBindingOptions = [...new Set(todoItems.map((item) => item.bindingId).filter(Boolean))]
    .sort((a, b) => (a === 'meta' ? -1 : b === 'meta' ? 1 : a.localeCompare(b)));
  $: filteredTodoItems = selectedTodoBinding
    ? todoItems.filter((item) => item.bindingId === selectedTodoBinding)
    : todoItems;
  $: visibleTodos = filteredTodoItems.slice(0, LIST_LIMIT);
  $: if ($activeTab === 'scheduler') refreshAll();

  async function refreshAll() {
    const seq = ++refreshSeq;
    loading = true;
    error = '';
    try {
      const [schedulerState, todoState] = await Promise.all([
        api('/scheduler'),
        api(`/todos?includeExpired=${includeExpiredTodos ? 'true' : 'false'}`),
      ]);
      if (seq !== refreshSeq) return;
      checkApi(schedulerState);
      checkApi(todoState);
      scheduler = schedulerState || EMPTY_SCHEDULER;
      todoItems = todoState?.items || [];
    } catch (err) {
      if (seq === refreshSeq) error = String(err);
    } finally {
      if (seq === refreshSeq) loading = false;
    }
  }

  function checkApi(result) {
    if (result?.error) throw new Error(result.error);
    return result;
  }

  function formatTime(isoDate) {
    if (!isoDate) return '-';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleString();
  }

  function timeUntil(isoDate) {
    if (!isoDate) return '-';
    const diff = new Date(isoDate).getTime() - Date.now();
    if (!Number.isFinite(diff)) return '-';
    if (diff <= 0) return '已到期';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分钟后`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时${mins % 60}分后`;
    return `${Math.floor(hours / 24)}天后`;
  }

  function timeAgo(isoDate) {
    if (!isoDate) return '未触发';
    const diff = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(diff)) return '-';
    if (diff < 60000) return '刚刚';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }

  function isoToLocalInput(isoDate) {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function localInputToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  function dataToText(data) {
    if (data === undefined || data === null) return '';
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  function applyDataPatch(body) {
    const trimmed = dataText.trim();
    if (trimmed) {
      body.data = JSON.parse(trimmed);
    } else if (form.dataWasPresent) {
      body.data = null;
    }
  }

  function bindingDisplay(id) {
    return id === 'meta' ? 'meta' : shortId(id);
  }

  function openReminder(item) {
    editType = 'reminder';
    editTitle = '编辑提醒';
    saveError = '';
    form = {
      id: item.id,
      name: item.name || item.description || '',
      bindingId: item.bindingId || item.chatId || 'meta',
      triggerAt: isoToLocalInput(item.triggerAt),
      callback: item.callback || item.description || '',
      dataWasPresent: item.data !== undefined && item.data !== null,
    };
    dataText = dataToText(item.data);
    editModal?.showModal();
  }

  function openCron(item) {
    editType = 'cron';
    editTitle = '编辑 Cron';
    saveError = '';
    form = {
      id: item.id,
      name: item.name || item.description || '',
      bindingId: item.bindingId || item.chatId || 'meta',
      cronExpr: item.cronExpr || '',
      callback: item.callback || item.taskTemplate || item.description || '',
      dataWasPresent: item.data !== undefined && item.data !== null,
    };
    dataText = dataToText(item.data);
    editModal?.showModal();
  }

  function openTodo(item = null) {
    editType = 'todo';
    editTitle = item ? '编辑 Todo 规则' : '新增 Todo 规则';
    saveError = '';
    form = {
      oldBindingId: item?.bindingId || '',
      oldKey: item?.key || '',
      bindingId: item?.bindingId || selectedTodoBinding || 'meta',
      key: item?.key || '',
      content: item?.content || '',
      dueAt: isoToLocalInput(item?.dueAt),
      forever: item ? !item.dueAt : false,
    };
    dataText = '';
    editModal?.showModal();
  }

  async function saveEdit() {
    saving = true;
    saveError = '';
    try {
      if (editType === 'reminder') {
        if (!form.triggerAt) throw new Error('triggerAt 不能为空');
        const body = {
          name: form.name,
          bindingId: form.bindingId,
          triggerAt: localInputToIso(form.triggerAt),
          callback: form.callback,
        };
        applyDataPatch(body);
        checkApi(await api(`/scheduler/${form.id}`, { method: 'PUT', body }));
      } else if (editType === 'cron') {
        const body = {
          name: form.name,
          bindingId: form.bindingId,
          cronExpr: form.cronExpr,
          callback: form.callback,
        };
        applyDataPatch(body);
        checkApi(await api(`/scheduler/${form.id}`, { method: 'PUT', body }));
      } else if (editType === 'todo') {
        const body = {
          oldBindingId: form.oldBindingId,
          oldKey: form.oldKey,
          bindingId: form.bindingId || 'meta',
          key: form.key,
          content: form.content,
          dueAt: form.forever ? null : localInputToIso(form.dueAt),
          forever: !!form.forever,
        };
        checkApi(await api('/todos', { method: 'PUT', body }));
      }
      editModal?.close();
      await refreshAll();
    } catch (err) {
      saveError = String(err);
    } finally {
      saving = false;
    }
  }

  async function deleteScheduler(item) {
    if (!confirm(`确认删除调度 ${item.name || item.id}？`)) return;
    try {
      checkApi(await api(`/scheduler/${item.id}`, { method: 'DELETE' }));
      await refreshAll();
    } catch (err) {
      error = String(err);
    }
  }

  async function deleteTodo(item) {
    if (!confirm(`确认删除 Todo ${item.key}？`)) return;
    try {
      checkApi(await api('/todos', { method: 'DELETE', body: { bindingId: item.bindingId, key: item.key } }));
      await refreshAll();
    } catch (err) {
      error = String(err);
    }
  }
</script>

<div class="space-y-4">
  <div class="card bg-base-100">
    <div class="card-body p-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="card-title text-sm">
          <i class="fa-solid fa-calendar-check opacity-50 mr-1"></i>定时调度
          {#if loading}<span class="loading loading-spinner loading-xs ml-1"></span>{/if}
        </h3>
        <button class="btn btn-xs btn-ghost ml-auto" title="刷新" on:click={refreshAll}>
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>

      {#if error}
        <div class="alert alert-error py-2 text-xs mt-3">{error}</div>
      {/if}

      <div class="grid grid-cols-4 gap-2 scheduler-summary mt-3">
        <div class="rounded bg-base-200 p-3">
          <div class="text-[10px] uppercase opacity-60">未触发提醒</div>
          <div class="text-xl font-bold leading-tight">{(scheduler.summary || {}).activeReminders || 0}</div>
        </div>
        <div class="rounded bg-base-200 p-3">
          <div class="text-[10px] uppercase opacity-60">已触发提醒</div>
          <div class="text-xl font-bold leading-tight">{(scheduler.summary || {}).triggeredReminders || 0}</div>
        </div>
        <div class="rounded bg-base-200 p-3">
          <div class="text-[10px] uppercase opacity-60">Cron</div>
          <div class="text-xl font-bold leading-tight">{(scheduler.summary || {}).totalCrons || 0}</div>
        </div>
        <div class="rounded bg-base-200 p-3">
          <div class="text-[10px] uppercase opacity-60">Todo 规则</div>
          <div class="text-xl font-bold leading-tight">{todoItems.length}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4 scheduler-grid">
    <div class="card bg-base-100">
      <div class="card-body p-4">
        <h3 class="card-title text-sm">
          <i class="fa-solid fa-bell opacity-50 mr-1"></i>Reminders
          <span class="badge badge-sm badge-ghost ml-auto">{activeReminders.length}</span>
        </h3>
        <div class="overflow-x-auto mt-2">
          <table class="table table-xs">
            <thead>
              <tr><th>名称</th><th>绑定</th><th>触发</th><th>Callback</th><th>操作</th></tr>
            </thead>
            <tbody>
              {#if !visibleActiveReminders.length}
                <tr><td colspan="5" class="text-center opacity-60">无未触发提醒</td></tr>
              {:else}
                {#each visibleActiveReminders as item}
                  <tr>
                    <td class="max-w-32 truncate" title={item.name || item.description}>{item.name || item.description}</td>
                    <td class="font-mono text-xs">
                      {#if getPlatform(item.bindingId)}<span class="platform-badge platform-{getPlatform(item.bindingId)}">{platformLabel(getPlatform(item.bindingId))}</span>{/if}
                      {bindingDisplay(item.bindingId)}
                    </td>
                    <td title={formatTime(item.triggerAt)}>
                      <span class="whitespace-nowrap">{timeUntil(item.triggerAt)}</span>
                    </td>
                    <td class="max-w-64 truncate" title={item.callback || item.description}>{item.callback || item.description}</td>
                    <td>
                      <div class="flex gap-1">
                        <button class="btn btn-xs btn-ghost" title="编辑" on:click={() => openReminder(item)}>
                          <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="btn btn-xs btn-ghost text-error" title="删除" on:click={() => deleteScheduler(item)}>
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
        {#if activeReminders.length > visibleActiveReminders.length}
          <div class="text-[10px] opacity-50 mt-1">仅显示前 {LIST_LIMIT} 个未触发提醒，共 {activeReminders.length} 个</div>
        {/if}

        {#if triggeredReminders.length}
          <button class="btn btn-xs btn-ghost mt-2" on:click={() => showTriggeredReminders = !showTriggeredReminders}>
            <i class="fa-solid fa-chevron-right transition-transform" style:transform={showTriggeredReminders ? 'rotate(90deg)' : ''}></i>
            已触发 ({triggeredReminders.length})
          </button>
          {#if showTriggeredReminders}
            <div class="overflow-x-auto mt-2">
              <table class="table table-xs">
                <thead>
                  <tr><th>名称</th><th>绑定</th><th>触发时间</th><th>Callback</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {#each visibleTriggeredReminders as item}
                    <tr class="opacity-60">
                      <td class="max-w-32 truncate" title={item.name || item.description}>{item.name || item.description}</td>
                      <td class="font-mono text-xs">{bindingDisplay(item.bindingId)}</td>
                      <td>{formatTime(item.triggerAt)}</td>
                      <td class="max-w-64 truncate" title={item.callback || item.description}>{item.callback || item.description}</td>
                      <td>
                        <div class="flex gap-1">
                          <button class="btn btn-xs btn-ghost" title="编辑并重新激活" on:click={() => openReminder(item)}>
                            <i class="fa-solid fa-pen-to-square"></i>
                          </button>
                          <button class="btn btn-xs btn-ghost text-error" title="删除" on:click={() => deleteScheduler(item)}>
                            <i class="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="card bg-base-100">
      <div class="card-body p-4">
        <h3 class="card-title text-sm">
          <i class="fa-solid fa-repeat opacity-50 mr-1"></i>Crons
          <span class="badge badge-sm badge-ghost ml-auto">{(scheduler.crons || []).length}</span>
        </h3>
        <div class="overflow-x-auto mt-2">
          <table class="table table-xs">
            <thead>
              <tr><th>名称</th><th>绑定</th><th>表达式</th><th>上次触发</th><th>Callback</th><th>操作</th></tr>
            </thead>
            <tbody>
              {#if !visibleCrons.length}
                <tr><td colspan="6" class="text-center opacity-60">无 Cron</td></tr>
              {:else}
                {#each visibleCrons as item}
                  <tr>
                    <td class="max-w-32 truncate" title={item.name || item.description}>{item.name || item.description}</td>
                    <td class="font-mono text-xs">
                      {#if getPlatform(item.bindingId)}<span class="platform-badge platform-{getPlatform(item.bindingId)}">{platformLabel(getPlatform(item.bindingId))}</span>{/if}
                      {bindingDisplay(item.bindingId)}
                    </td>
                    <td><code class="text-[10px]">{item.cronExpr}</code></td>
                    <td class="whitespace-nowrap" title={formatTime(item.lastTriggeredAt)}>{timeAgo(item.lastTriggeredAt)}</td>
                    <td class="max-w-64 truncate" title={item.callback || item.taskTemplate || item.description}>{item.callback || item.taskTemplate || item.description}</td>
                    <td>
                      <div class="flex gap-1">
                        <button class="btn btn-xs btn-ghost" title="编辑" on:click={() => openCron(item)}>
                          <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="btn btn-xs btn-ghost text-error" title="删除" on:click={() => deleteScheduler(item)}>
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
        {#if (scheduler.crons || []).length > visibleCrons.length}
          <div class="text-[10px] opacity-50 mt-1">仅显示前 {LIST_LIMIT} 个 Cron，共 {(scheduler.crons || []).length} 个</div>
        {/if}
      </div>
    </div>
  </div>

  <div class="card bg-base-100">
    <div class="card-body p-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="card-title text-sm">
          <i class="fa-solid fa-list-check opacity-50 mr-1"></i>Todo 规则
          <span class="badge badge-sm badge-ghost">{selectedTodoBinding || '全部绑定'}</span>
        </h3>
        <select class="select select-xs select-bordered ml-auto max-w-64" bind:value={selectedTodoBinding}>
          <option value="">全部绑定</option>
          {#each todoBindingOptions as bindingId}
            <option value={bindingId}>{bindingId === 'meta' ? 'meta' : bindingId}</option>
          {/each}
        </select>
        <label class="label cursor-pointer gap-2 py-0">
          <span class="label-text text-xs">包含过期</span>
          <input type="checkbox" class="toggle toggle-xs" bind:checked={includeExpiredTodos} on:change={refreshAll} />
        </label>
        <button class="btn btn-xs btn-primary" on:click={() => openTodo()}>
          <i class="fa-solid fa-plus"></i>新增
        </button>
      </div>
      <div class="overflow-x-auto mt-2">
        <table class="table table-xs">
          <thead>
            <tr><th>Binding</th><th>Key</th><th>内容</th><th>到期</th><th>更新时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {#if !visibleTodos.length}
              <tr><td colspan="6" class="text-center opacity-60">无 Todo 规则</td></tr>
            {:else}
              {#each visibleTodos as item}
                <tr class:opacity-50={item.expired}>
                  <td class="font-mono max-w-40 truncate" title={item.bindingId}>
                    {#if getPlatform(item.bindingId)}<span class="platform-badge platform-{getPlatform(item.bindingId)}">{platformLabel(getPlatform(item.bindingId))}</span>{/if}
                    {bindingDisplay(item.bindingId)}
                  </td>
                  <td class="font-mono max-w-40 truncate" title={item.key}>{item.key}</td>
                  <td class="max-w-[32rem] truncate" title={item.content}>{item.content}</td>
                  <td class="whitespace-nowrap">{item.dueAt ? formatTime(item.dueAt) : '永久'}</td>
                  <td class="whitespace-nowrap">{formatTime(item.updatedAt)}</td>
                  <td>
                    <div class="flex gap-1">
                      <button class="btn btn-xs btn-ghost" title="编辑" on:click={() => openTodo(item)}>
                        <i class="fa-solid fa-pen-to-square"></i>
                      </button>
                      <button class="btn btn-xs btn-ghost text-error" title="删除" on:click={() => deleteTodo(item)}>
                        <i class="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
      {#if filteredTodoItems.length > visibleTodos.length}
        <div class="text-[10px] opacity-50 mt-1">仅显示前 {LIST_LIMIT} 个 Todo，共 {filteredTodoItems.length} 个</div>
      {/if}
    </div>
  </div>
</div>

<dialog bind:this={editModal} class="modal">
  <div class="modal-box max-w-3xl">
    <h3 class="text-lg font-bold">{editTitle}</h3>

    {#if saveError}
      <div class="alert alert-error py-2 text-xs mt-3">{saveError}</div>
    {/if}

    <div class="py-4 space-y-3">
      {#if editType === 'todo'}
        <div class="grid grid-cols-2 gap-3 modal-grid">
          <label>
            <span class="label text-xs">Binding</span>
            <input type="text" class="input input-sm input-bordered w-full font-mono" bind:value={form.bindingId} />
          </label>
          <label>
            <span class="label text-xs">Key</span>
            <input type="text" class="input input-sm input-bordered w-full font-mono" bind:value={form.key} />
          </label>
          <label class="col-span-2">
            <span class="label text-xs">Content</span>
            <textarea class="textarea textarea-bordered textarea-sm w-full" rows="5" bind:value={form.content}></textarea>
          </label>
          <label>
            <span class="label text-xs">Due At</span>
            <input type="datetime-local" class="input input-sm input-bordered w-full" bind:value={form.dueAt} disabled={form.forever} />
          </label>
          <label class="label cursor-pointer justify-start gap-2 mt-6">
            <input type="checkbox" class="checkbox checkbox-sm" bind:checked={form.forever} />
            <span class="label-text text-xs">永久保留</span>
          </label>
        </div>
      {:else if editType === 'reminder'}
        <div class="grid grid-cols-2 gap-3 modal-grid">
          <label>
            <span class="label text-xs">Name</span>
            <input type="text" class="input input-sm input-bordered w-full" bind:value={form.name} />
          </label>
          <label>
            <span class="label text-xs">Binding</span>
            <input type="text" class="input input-sm input-bordered w-full font-mono" bind:value={form.bindingId} />
          </label>
          <label>
            <span class="label text-xs">Trigger At</span>
            <input type="datetime-local" class="input input-sm input-bordered w-full" bind:value={form.triggerAt} />
          </label>
          <label class="col-span-2">
            <span class="label text-xs">Callback</span>
            <textarea class="textarea textarea-bordered textarea-sm w-full" rows="5" bind:value={form.callback}></textarea>
          </label>
          <label class="col-span-2">
            <span class="label text-xs">Data JSON</span>
            <textarea class="textarea textarea-bordered textarea-sm w-full font-mono" rows="4" bind:value={dataText}></textarea>
          </label>
        </div>
      {:else if editType === 'cron'}
        <div class="grid grid-cols-2 gap-3 modal-grid">
          <label>
            <span class="label text-xs">Name</span>
            <input type="text" class="input input-sm input-bordered w-full" bind:value={form.name} />
          </label>
          <label>
            <span class="label text-xs">Binding</span>
            <input type="text" class="input input-sm input-bordered w-full font-mono" bind:value={form.bindingId} />
          </label>
          <label>
            <span class="label text-xs">Cron Expr</span>
            <input type="text" class="input input-sm input-bordered w-full font-mono" bind:value={form.cronExpr} />
          </label>
          <label class="col-span-2">
            <span class="label text-xs">Callback</span>
            <textarea class="textarea textarea-bordered textarea-sm w-full" rows="5" bind:value={form.callback}></textarea>
          </label>
          <label class="col-span-2">
            <span class="label text-xs">Data JSON</span>
            <textarea class="textarea textarea-bordered textarea-sm w-full font-mono" rows="4" bind:value={dataText}></textarea>
          </label>
        </div>
      {/if}
    </div>

    <div class="modal-action">
      <button class="btn btn-primary" disabled={saving} on:click={saveEdit}>
        {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
        保存
      </button>
      <form method="dialog"><button class="btn">取消</button></form>
    </div>
  </div>
</dialog>

<style>
  @media (max-width: 1024px) {
    .scheduler-grid { grid-template-columns: 1fr !important; }
    .scheduler-summary { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  }

  @media (max-width: 640px) {
    .modal-grid { grid-template-columns: 1fr !important; }
    .modal-grid .col-span-2 { grid-column: span 1 !important; }
  }
</style>
