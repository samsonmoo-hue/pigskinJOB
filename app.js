const STATUS = {
  PENDING: { label: '待處理' },
  IN_PROGRESS: { label: '進行中' },
  WAITING_CONTACT: { label: '待聯繫' },
  WAITING_REPLY: { label: '等待回覆' },
  PENDING_CONFIRMATION: { label: '待確認' },
  COMPLETED: { label: '已完成' },
  ON_HOLD: { label: '暫緩' },
  CANCELLED: { label: '取消' }
};

const APP_CONFIG = Object.freeze({
  googleClientId: '1057281566344-0t43l9e1t3k6encu5qqrgdi4337ct3dh.apps.googleusercontent.com',
  calendarScope: 'https://www.googleapis.com/auth/calendar.readonly',
  targetCalendarName: '芝蘋景興工作',
  calendarApiBase: 'https://www.googleapis.com/calendar/v3'
});

const STORAGE = Object.freeze({
  categories: 'ps-chairman-categories-v1',
  manualTasks: 'ps-chairman-manual-tasks-v1',
  eventMetadata: 'ps-chairman-event-metadata-v1',
  selectedCalendarId: 'ps-chairman-selected-calendar-v1'
});

const defaultCategories = ['公文往來', '防災演練', '導護志工', '宣導講座', '教育訓練', '例行行政'];
const finalStatuses = ['COMPLETED', 'CANCELLED'];

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    console.warn('無法讀取本機資料：', key, error);
    return fallback;
  }
}

function normaliseManualTask(task) {
  const safeStatus = STATUS[task && task.status] ? task.status : 'PENDING';
  return {
    id: String(task && task.id || 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
    source: 'manual',
    title: String(task && task.title || '未命名工作'),
    category: String(task && task.category || ''),
    status: safeStatus,
    date: String(task && task.date || getTodayISO()),
    due: String(task && task.due || ''),
    next: String(task && task.next || ''),
    note: String(task && task.note || ''),
    calendarName: '手動建立',
    calendarDetail: '手動建立的追蹤工作',
    archived: Boolean(task && task.archived),
    completedAt: task && task.completedAt ? String(task.completedAt) : '',
    lastUpdated: task && task.lastUpdated ? String(task.lastUpdated) : ''
  };
}

let categories = readJSON(STORAGE.categories, null);
if (!Array.isArray(categories)) {
  categories = readJSON('work-tracker-categories', defaultCategories);
}
categories = Array.isArray(categories)
  ? categories.map(function (category) { return String(category).trim(); }).filter(Boolean)
  : defaultCategories.slice();

let manualTasks = readJSON(STORAGE.manualTasks, []);
manualTasks = Array.isArray(manualTasks) ? manualTasks.map(normaliseManualTask) : [];

let eventMetadata = readJSON(STORAGE.eventMetadata, {});
eventMetadata = eventMetadata && typeof eventMetadata === 'object' && !Array.isArray(eventMetadata)
  ? eventMetadata
  : {};

let calendarTasks = [];
let tasks = manualTasks.slice();
let selectedCategory = 'all';
let selectedQuick = 'open';
let searchTerm = '';
let accessToken = '';
let tokenExpiresAt = 0;
let tokenClient = null;
let googleIdentityReady = false;
let availableCalendars = [];
let currentCalendar = null;
let syncInProgress = false;
let connectionKind = 'loading';

const $ = function (selector) { return document.querySelector(selector); };

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[character];
  });
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateISO(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function getTodayISO() {
  return toLocalDateISO(new Date());
}

function setTodayLabel() {
  const today = new Date();
  const date = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(today);
  const weekday = new Intl.DateTimeFormat('zh-TW', { weekday: 'long' }).format(today);
  $('#todayLabel').textContent = date + ' · ' + weekday;
}

function statusOptions(current) {
  const safeCurrent = STATUS[current] ? current : 'PENDING';
  return Object.entries(STATUS).map(function (entry) {
    const key = entry[0];
    const value = entry[1];
    return '<option value="' + key + '" ' + (key === safeCurrent ? 'selected' : '') + '>' + value.label + '</option>';
  }).join('');
}

function dateText(date) {
  if (!date) return '未設定';
  if (date === getTodayISO()) return '今天';
  const parsed = new Date(date + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return date;
  return (parsed.getMonth() + 1) + '/' + parsed.getDate();
}

function isOpen(task) {
  return !finalStatuses.includes(task.status);
}

function isOverdue(task) {
  return !task.archived && isOpen(task) && task.due && task.due < getTodayISO();
}

function isToday(task) {
  return !task.archived && isOpen(task) && task.due === getTodayISO();
}

function matches(task) {
  const status = STATUS[task.status] ? STATUS[task.status].label : '';
  const haystack = [task.title, task.category, task.note, task.next, status].join(' ').toLowerCase();
  if (searchTerm && !haystack.includes(searchTerm.toLowerCase())) return false;
  if (selectedCategory === 'unclassified' && task.category) return false;
  if (!['all', 'unclassified'].includes(selectedCategory) && task.category !== selectedCategory) return false;

  if (selectedQuick === 'archived') return Boolean(task.archived);
  if (task.archived) return false;
  if (selectedQuick === 'open' && !isOpen(task)) return false;
  if (selectedQuick === 'today' && !isToday(task)) return false;
  if (selectedQuick === 'overdue' && !isOverdue(task)) return false;
  if (selectedQuick === 'completed' && task.status !== 'COMPLETED') return false;
  return true;
}

function rebuildTasks() {
  tasks = calendarTasks.concat(manualTasks);
}

function persistCalendarMetadata(task) {
  if (!task.eventKey) return;
  eventMetadata[task.eventKey] = {
    category: task.category || '',
    status: STATUS[task.status] ? task.status : 'PENDING',
    due: task.due || '',
    next: task.next || '',
    note: task.note || '',
    archived: Boolean(task.archived),
    completedAt: task.completedAt || '',
    lastUpdated: task.lastUpdated || ''
  };
}

function saveLocalState() {
  localStorage.setItem(STORAGE.categories, JSON.stringify(categories));
  localStorage.setItem(STORAGE.manualTasks, JSON.stringify(manualTasks));
  localStorage.setItem(STORAGE.eventMetadata, JSON.stringify(eventMetadata));
}

function saveTaskState(task) {
  if (task.source === 'google') persistCalendarMetadata(task);
  saveLocalState();
}

function card(task) {
  const overdue = isOverdue(task) ? ' overdue' : '';
  const done = !isOpen(task) ? ' is-complete' : '';
  const due = task.due
    ? '<span class="' + (isOverdue(task) ? 'due-overdue' : '') + '">截止 ' + escapeHTML(dateText(task.due)) + '</span>'
    : '';
  const calendarName = task.calendarName || (task.source === 'google' ? APP_CONFIG.targetCalendarName : '手動建立');
  const sourceLabel = task.source === 'google' ? 'Google 日曆' : '手動';
  const next = task.next
    ? '<p class="task-next"><b>下一步</b>　' + escapeHTML(task.next) + '</p>'
    : '';

  return '<article class="task-card' + overdue + done + '" data-task-id="' + escapeHTML(task.id) + '">' +
    '<div><div class="task-title-row"><span class="task-indicator"></span><h3 class="task-title">' +
    escapeHTML(task.title) + '</h3></div><div class="task-meta"><span>' + escapeHTML(dateText(task.date)) +
    '</span>' + due + '<span>' + escapeHTML(calendarName) + '</span><span class="task-source">' +
    sourceLabel + '</span></div>' + next + '</div><div class="task-actions"><select class="status-select" data-status="' +
    escapeHTML(task.status) + '" data-update-status="' + escapeHTML(task.id) + '" aria-label="' +
    escapeHTML(task.title) + ' 的工作狀態">' + statusOptions(task.status) +
    '</select><button class="edit-task" data-edit="' + escapeHTML(task.id) + '" aria-label="編輯 ' +
    escapeHTML(task.title) + '">•••</button></div></article>';
}

function renderFilters() {
  const categoryButtons = categories.map(function (category, index) {
    return '<button class="filter-chip ' + (selectedCategory === category ? 'active' : '') +
      '" data-category-index="' + index + '">' + escapeHTML(category) + '</button>';
  }).join('');

  $('#categoryFilters').innerHTML =
    '<button class="filter-chip ' + (selectedCategory === 'all' ? 'active' : '') +
    '" data-category-index="-1">全部</button>' +
    '<button class="filter-chip ' + (selectedCategory === 'unclassified' ? 'active' : '') +
    '" data-category-index="-2">未分類 <small>' +
    tasks.filter(function (task) { return !task.category && !task.archived; }).length +
    '</small></button>' + categoryButtons;

  document.querySelectorAll('[data-category-index]').forEach(function (button) {
    button.onclick = function () {
      const index = Number(button.dataset.categoryIndex);
      selectedCategory = index === -1 ? 'all' : index === -2 ? 'unclassified' : categories[index];
      render();
    };
  });

  document.querySelectorAll('[data-filter]').forEach(function (button) {
    button.classList.toggle('active', button.dataset.filter === selectedQuick);
    button.onclick = function () {
      selectedQuick = button.dataset.filter;
      render();
    };
  });
}

function group(title, taskList, unclassified) {
  const counts = Object.entries(STATUS).filter(function (entry) {
    return taskList.some(function (task) { return task.status === entry[0]; });
  }).map(function (entry) {
    return '<span class="mini-stat">' + entry[1].label + ' ' +
      taskList.filter(function (task) { return task.status === entry[0]; }).length + '</span>';
  }).join('');

  return '<section class="task-group' + (unclassified ? ' unclassified' : '') + '">' +
    '<header class="group-header"><div class="group-header-left"><span class="category-accent"></span><div>' +
    '<h2 class="group-name">' + escapeHTML(title) + ' <small>(' + taskList.length + ')</small></h2>' +
    '<p class="group-subtitle">' + taskList.filter(isOpen).length + ' 項未完成　' + counts +
    '</p></div></div><button class="collapse-button" aria-label="收合 ' + escapeHTML(title) +
    '">⌄</button></header><div class="task-list">' + taskList.map(card).join('') + '</div></section>';
}

function renderTasks() {
  const list = tasks.filter(matches).slice().sort(function (left, right) {
    return String(left.date || '9999-12-31').localeCompare(String(right.date || '9999-12-31')) ||
      String(left.title).localeCompare(String(right.title), 'zh-Hant');
  });
  const groups = [];
  const uncategorized = list.filter(function (task) { return !task.category; });
  if (uncategorized.length) groups.push(group('未分類', uncategorized, true));

  categories.forEach(function (category) {
    const categoryTasks = list.filter(function (task) { return task.category === category; });
    if (categoryTasks.length) groups.push(group(category, categoryTasks, false));
  });

  const other = list.filter(function (task) {
    return task.category && !categories.includes(task.category);
  });
  if (other.length) groups.push(group('其他', other, false));

  $('#taskGroups').innerHTML = groups.join('');
  $('#emptyState').classList.toggle('hidden', list.length > 0);
  $('#visibleSummary').textContent = '顯示 ' + list.length + ' 項工作';

  const emptyTitle = $('#emptyState h3');
  const emptyCopy = $('#emptyState p');
  if (!accessToken && tasks.length === 0) {
    emptyTitle.textContent = '尚未連結 Google 日曆';
    emptyCopy.textContent = '請先連結 Google 帳戶，或手動新增一筆追蹤工作。';
  } else {
    emptyTitle.textContent = '找不到相符的工作';
    emptyCopy.textContent = '請調整搜尋文字或篩選條件。';
  }

  document.querySelectorAll('.collapse-button').forEach(function (button) {
    button.onclick = function () { button.closest('.task-group').classList.toggle('collapsed'); };
  });
  document.querySelectorAll('[data-update-status]').forEach(function (select) {
    select.onchange = function (event) { changeStatus(select.dataset.updateStatus, event.target.value); };
  });
  document.querySelectorAll('[data-edit]').forEach(function (button) {
    button.onclick = function () { openTask(button.dataset.edit); };
  });
}

const reminders = [
  { title: '已逾期', className: 'overdue', filter: isOverdue },
  { title: '今天到期', className: 'today', filter: isToday },
  { title: '待聯繫', filter: function (task) { return task.status === 'WAITING_CONTACT'; } },
  { title: '等待回覆', filter: function (task) { return task.status === 'WAITING_REPLY'; } },
  { title: '待確認', filter: function (task) { return task.status === 'PENDING_CONFIRMATION'; } }
];

function renderReminders() {
  const html = reminders.map(function (section) {
    const list = tasks.filter(function (task) {
      return !task.archived && section.filter(task);
    });
    const items = list.length
      ? list.slice(0, 4).map(function (task) {
        return '<div class="reminder-item" data-reminder-task="' + escapeHTML(task.id) +
          '"><span class="reminder-bullet"></span><div><p class="reminder-task">' +
          escapeHTML(task.title) + '</p><p class="reminder-meta">' +
          escapeHTML(task.category || '未分類') + ' · ' +
          escapeHTML(STATUS[task.status] ? STATUS[task.status].label : '待處理') +
          '</p></div><time class="reminder-date">' + escapeHTML(dateText(task.due)) +
          '</time></div>';
      }).join('')
      : '<p class="reminder-empty">目前沒有需要處理的工作</p>';

    return '<section class="reminder-section ' + (section.className || '') +
      '"><h3 class="reminder-title">' + section.title +
      '<span class="reminder-count">' + String(list.length).padStart(2, '0') +
      '</span></h3>' + items + '</section>';
  }).join('');

  $('#reminderLists').innerHTML = html;
  document.querySelectorAll('[data-reminder-task]').forEach(function (element) {
    element.onclick = function () { openTask(element.dataset.reminderTask); };
  });
  $('#todayCount').textContent = tasks.filter(function (task) {
    return !task.archived && (isToday(task) || isOverdue(task));
  }).length;
}

function render() {
  renderFilters();
  renderTasks();
  renderReminders();
  updateConnectionUI();
}

function showToast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(window.toastTimer);
  window.toastTimer = window.setTimeout(function () {
    element.classList.add('hidden');
  }, 3200);
}

function changeStatus(id, status) {
  const task = tasks.find(function (item) { return item.id === id; });
  if (!task || !STATUS[status] || task.status === status) return;
  task.status = status;
  task.lastUpdated = new Date().toISOString();
  if (status === 'COMPLETED') task.completedAt = getTodayISO();
  else delete task.completedAt;
  saveTaskState(task);
  render();
  showToast('「' + task.title + '」已更新為' + STATUS[status].label);
}

function updateTaskCategoryOptions(current) {
  const selected = current || '';
  $('#taskCategory').innerHTML = '<option value="">未分類</option>' +
    categories.map(function (category) {
      return '<option value="' + escapeHTML(category) + '" ' +
        (category === selected ? 'selected' : '') + '>' +
        escapeHTML(category) + '</option>';
    }).join('');
}

function openTask(id) {
  const task = tasks.find(function (item) { return item.id === id; });
  if (!task) return;

  $('#taskForm').reset();
  $('#taskId').value = task.id;
  $('#taskTitle').value = task.title;
  $('#taskTitle').readOnly = task.source === 'google';
  updateTaskCategoryOptions(task.category);
  $('#taskStatus').innerHTML = statusOptions(task.status);
  $('#taskDate').value = task.date;
  $('#taskDate').disabled = task.source === 'google';
  $('#taskDueDate').value = task.due || '';
  $('#taskNextAction').value = task.next || '';
  $('#taskNote').value = task.note || '';
  $('#taskArchived').checked = Boolean(task.archived);
  $('#calendarOriginLabel').textContent = task.source === 'google'
    ? 'Google Calendar 原始資料（標題與日期為唯讀）'
    : '工作來源';
  $('#calendarOrigin').textContent = task.calendarDetail || task.calendarName || '手動建立';

  const calendarLink = $('#calendarLink');
  if (task.source === 'google' && task.eventLink) {
    calendarLink.href = task.eventLink;
    calendarLink.classList.remove('hidden');
  } else {
    calendarLink.removeAttribute('href');
    calendarLink.classList.add('hidden');
  }

  $('#modalTitle').textContent = '工作詳細資料';
  $('#taskModalBackdrop').classList.remove('hidden');
  $('#taskTitle').focus();
}

function closeTask() {
  $('#taskModalBackdrop').classList.add('hidden');
}

function openNewTask() {
  $('#taskForm').reset();
  $('#taskId').value = '';
  $('#taskTitle').readOnly = false;
  $('#taskDate').disabled = false;
  $('#modalTitle').textContent = '新增追蹤工作';
  updateTaskCategoryOptions('');
  $('#taskStatus').innerHTML = statusOptions('PENDING');
  $('#taskDate').value = getTodayISO();
  $('#calendarOriginLabel').textContent = '工作來源';
  $('#calendarOrigin').textContent = '手動建立的追蹤工作';
  $('#calendarLink').classList.add('hidden');
  $('#taskModalBackdrop').classList.remove('hidden');
  $('#taskTitle').focus();
}

function saveTask(event) {
  event.preventDefault();
  const id = $('#taskId').value;
  let task = tasks.find(function (item) { return item.id === id; });
  const isNew = !task;

  if (!task) {
    task = normaliseManualTask({
      id: 'manual-' + Date.now(),
      title: $('#taskTitle').value.trim(),
      date: $('#taskDate').value
    });
    manualTasks.unshift(task);
    rebuildTasks();
  }

  const previousStatus = task.status;
  const editableFields = {
    category: $('#taskCategory').value,
    status: $('#taskStatus').value,
    due: $('#taskDueDate').value,
    next: $('#taskNextAction').value.trim(),
    note: $('#taskNote').value.trim(),
    archived: $('#taskArchived').checked,
    lastUpdated: new Date().toISOString()
  };

  if (task.source === 'manual') {
    editableFields.title = $('#taskTitle').value.trim();
    editableFields.date = $('#taskDate').value;
  }

  Object.assign(task, editableFields);
  if (task.status === 'COMPLETED' && previousStatus !== 'COMPLETED') task.completedAt = getTodayISO();
  if (task.status !== 'COMPLETED') delete task.completedAt;

  saveTaskState(task);
  closeTask();
  render();
  showToast(isNew ? '已建立新的手動追蹤工作' : '工作追蹤內容已儲存');
}

function renderCategorySettings() {
  $('#categorySettings').innerHTML = categories.map(function (category, index) {
    return '<div class="category-setting-row"><span class="category-handle">⠿</span>' +
      '<input value="' + escapeHTML(category) + '" data-category-name="' + index +
      '" aria-label="分類名稱"/><span class="category-enabled">啟用中</span>' +
      '<button class="category-delete" data-delete-category="' + index +
      '" aria-label="刪除 ' + escapeHTML(category) + '">×</button></div>';
  }).join('');

  document.querySelectorAll('[data-category-name]').forEach(function (input) {
    input.onchange = function () {
      const index = Number(input.dataset.categoryName);
      const previous = categories[index];
      const next = input.value.trim();
      if (!next || (categories.includes(next) && next !== previous)) {
        input.value = previous;
        showToast('分類名稱不可重複或空白');
        return;
      }

      categories[index] = next;
      tasks.forEach(function (task) {
        if (task.category === previous) {
          task.category = next;
          if (task.source === 'google') persistCalendarMetadata(task);
        }
      });
      Object.values(eventMetadata).forEach(function (metadata) {
        if (metadata && metadata.category === previous) metadata.category = next;
      });
      if (selectedCategory === previous) selectedCategory = next;
      saveLocalState();
      render();
      renderCategorySettings();
    };
  });

  document.querySelectorAll('[data-delete-category]').forEach(function (button) {
    button.onclick = function () {
      const index = Number(button.dataset.deleteCategory);
      const name = categories[index];
      const assigned = tasks.filter(function (task) { return task.category === name; }).length;
      if (assigned && !confirm('「' + name + '」有 ' + assigned + ' 項工作，刪除後會移至未分類。是否繼續？')) return;

      tasks.forEach(function (task) {
        if (task.category === name) {
          task.category = '';
          if (task.source === 'google') persistCalendarMetadata(task);
        }
      });
      Object.values(eventMetadata).forEach(function (metadata) {
        if (metadata && metadata.category === name) metadata.category = '';
      });
      categories.splice(index, 1);
      if (selectedCategory === name) selectedCategory = 'all';
      saveLocalState();
      render();
      renderCategorySettings();
      showToast('已刪除分類「' + name + '」');
    };
  });
}

function openSettings() {
  renderCategorySettings();
  $('#settingsBackdrop').classList.remove('hidden');
}

function closeSettings() {
  $('#settingsBackdrop').classList.add('hidden');
}

function eventDateISO(event) {
  if (event.start && event.start.date) return event.start.date;
  if (event.start && event.start.dateTime) return toLocalDateISO(new Date(event.start.dateTime));
  return getTodayISO();
}

function formatTime(dateTime) {
  if (!dateTime) return '';
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return '';
  const options = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (currentCalendar && currentCalendar.timeZone) options.timeZone = currentCalendar.timeZone;
  try {
    return new Intl.DateTimeFormat('zh-TW', options).format(date);
  } catch (error) {
    delete options.timeZone;
    return new Intl.DateTimeFormat('zh-TW', options).format(date);
  }
}

function formatEventTime(event) {
  if (event.start && event.start.date) return '全天';
  const start = formatTime(event.start && event.start.dateTime);
  const end = formatTime(event.end && event.end.dateTime);
  return start && end ? start + '–' + end : start || '時間未設定';
}

function eventHasEnded(event) {
  if (event.end && event.end.date) return event.end.date <= getTodayISO();
  if (event.end && event.end.dateTime) return new Date(event.end.dateTime).getTime() < Date.now();
  return false;
}

function eventDetail(event, calendarName) {
  const parts = [calendarName + ' · ' + formatEventTime(event)];
  if (event.location) parts.push('地點：' + event.location);
  if (event.description) {
    const compact = String(event.description).replace(/\s+/g, ' ').trim();
    if (compact) parts.push('說明：' + (compact.length > 220 ? compact.slice(0, 220) + '…' : compact));
  }
  return parts.join('｜');
}

function calendarTaskFromEvent(event) {
  const eventKey = currentCalendar.id + '::' + event.id;
  const metadata = eventMetadata[eventKey] && typeof eventMetadata[eventKey] === 'object'
    ? eventMetadata[eventKey]
    : {};
  const defaultStatus = eventHasEnded(event) ? 'COMPLETED' : 'PENDING';
  const status = STATUS[metadata.status] ? metadata.status : defaultStatus;
  const date = eventDateISO(event);

  return {
    id: 'gcal-' + event.id,
    eventKey: eventKey,
    source: 'google',
    title: event.summary || '私人活動或未命名活動',
    category: String(metadata.category || ''),
    status: status,
    date: date,
    due: Object.prototype.hasOwnProperty.call(metadata, 'due') ? String(metadata.due || '') : date,
    next: String(metadata.next || ''),
    note: String(metadata.note || ''),
    archived: Boolean(metadata.archived),
    completedAt: metadata.completedAt || (status === 'COMPLETED' ? date : ''),
    lastUpdated: metadata.lastUpdated || '',
    calendarName: currentCalendar.summaryOverride || currentCalendar.summary || APP_CONFIG.targetCalendarName,
    calendarDetail: eventDetail(event, currentCalendar.summaryOverride || currentCalendar.summary || APP_CONFIG.targetCalendarName),
    eventLink: event.htmlLink || ''
  };
}

async function apiRequest(resource, parameters) {
  const url = new URL(APP_CONFIG.calendarApiBase + resource);
  Object.entries(parameters || {}).forEach(function (entry) {
    if (entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
      url.searchParams.set(entry[0], String(entry[1]));
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken }
  });

  if (!response.ok) {
    let message = 'Google Calendar API 回應 ' + response.status;
    try {
      const data = await response.json();
      message = data.error && data.error.message ? data.error.message : message;
    } catch (error) {
      // Keep the HTTP status message when the response is not JSON.
    }
    const requestError = new Error(message);
    requestError.status = response.status;
    throw requestError;
  }
  return response.json();
}

async function listAll(resource, parameters) {
  const items = [];
  let pageToken = '';
  do {
    const pageParameters = Object.assign({}, parameters, pageToken ? { pageToken: pageToken } : {});
    const page = await apiRequest(resource, pageParameters);
    if (Array.isArray(page.items)) items.push.apply(items, page.items);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items;
}

function setCalendarStatus(message, kind) {
  $('#calendarStatus').textContent = message;
  connectionKind = kind || 'idle';
  $('#calendarStatusDot').className = 'calendar-status-dot ' + connectionKind;
}

function updateConnectionUI() {
  const connected = Boolean(accessToken);
  $('#googleConnectButton').classList.toggle('hidden', connected);
  $('#googleDisconnectButton').classList.toggle('hidden', !connected);
  $('#changeCalendarButton').classList.toggle('hidden', !connected || availableCalendars.length < 2);
  $('#googleConnectButton').disabled = !googleIdentityReady || syncInProgress;
  $('#syncButton').disabled = !currentCalendar || !accessToken || syncInProgress;

  if (syncInProgress) {
    $('#syncButton').innerHTML = '↻ 同步中…';
  } else {
    $('#syncButton').innerHTML = '<span>↻</span> 立即同步';
  }
}

function renderCalendarChooser() {
  $('#calendarOptions').innerHTML = availableCalendars.map(function (calendar, index) {
    const name = calendar.summaryOverride || calendar.summary || '未命名日曆';
    const role = calendar.accessRole === 'reader' ? '唯讀' : calendar.accessRole === 'writer' ? '可編輯' : calendar.accessRole;
    return '<button class="calendar-option" data-calendar-option="' + index + '"><span>' +
      escapeHTML(name) + '</span><small>' + escapeHTML(role || '') + '</small></button>';
  }).join('');

  document.querySelectorAll('[data-calendar-option]').forEach(function (button) {
    button.onclick = function () {
      const calendar = availableCalendars[Number(button.dataset.calendarOption)];
      if (!calendar) return;
      currentCalendar = calendar;
      localStorage.setItem(STORAGE.selectedCalendarId, calendar.id);
      closeCalendarChooser();
      syncCalendar();
    };
  });
}

function openCalendarChooser() {
  renderCalendarChooser();
  $('#calendarBackdrop').classList.remove('hidden');
}

function closeCalendarChooser() {
  $('#calendarBackdrop').classList.add('hidden');
}

async function loadCalendars() {
  syncInProgress = true;
  setCalendarStatus('正在確認可存取的 Google 日曆…', 'busy');
  updateConnectionUI();

  try {
    availableCalendars = await listAll('/users/me/calendarList', {
      minAccessRole: 'reader',
      maxResults: 250,
      showHidden: true
    });

    const savedId = localStorage.getItem(STORAGE.selectedCalendarId);
    const normalisedTarget = APP_CONFIG.targetCalendarName.replace(/\s+/g, '').toLowerCase();
    currentCalendar = availableCalendars.find(function (calendar) {
      return savedId && calendar.id === savedId;
    }) || availableCalendars.find(function (calendar) {
      const names = [calendar.summary, calendar.summaryOverride].filter(Boolean);
      return names.some(function (name) {
        return String(name).replace(/\s+/g, '').toLowerCase() === normalisedTarget;
      });
    }) || null;

    if (currentCalendar) {
      localStorage.setItem(STORAGE.selectedCalendarId, currentCalendar.id);
      await syncCalendar();
    } else {
      setCalendarStatus('已授權，請選擇要使用的工作日曆。', 'connected');
      openCalendarChooser();
    }
  } catch (error) {
    handleCalendarError(error);
  } finally {
    syncInProgress = false;
    updateConnectionUI();
  }
}

function calendarRange() {
  const today = new Date();
  return {
    timeMin: new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString(),
    timeMax: new Date(today.getFullYear(), today.getMonth() + 7, 1).toISOString()
  };
}

async function syncCalendar() {
  if (!accessToken || !currentCalendar) return;
  syncInProgress = true;
  setCalendarStatus('正在同步「' + (currentCalendar.summaryOverride || currentCalendar.summary) + '」…', 'busy');
  updateConnectionUI();

  try {
    const range = calendarRange();
    const events = await listAll('/calendars/' + encodeURIComponent(currentCalendar.id) + '/events', {
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 2500
    });

    calendarTasks = events.filter(function (event) {
      return event.status !== 'cancelled';
    }).map(calendarTaskFromEvent);
    rebuildTasks();
    render();

    const calendarName = currentCalendar.summaryOverride || currentCalendar.summary || APP_CONFIG.targetCalendarName;
    setCalendarStatus('已連結「' + calendarName + '」，已載入 ' + calendarTasks.length + ' 筆活動。', 'connected');
    $('#lastSync').textContent = new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
    showToast('Google 日曆同步完成');
  } catch (error) {
    handleCalendarError(error);
  } finally {
    syncInProgress = false;
    updateConnectionUI();
  }
}

function handleCalendarError(error) {
  console.error(error);
  if (error && error.status === 401) {
    accessToken = '';
    tokenExpiresAt = 0;
    currentCalendar = null;
    calendarTasks = [];
    rebuildTasks();
    setCalendarStatus('Google 授權已過期，請重新連結。', 'error');
    render();
    return;
  }

  const message = error && error.status === 403
    ? '目前帳號或學校管理員禁止此應用程式讀取日曆。'
    : '無法讀取 Google 日曆：' + (error && error.message ? error.message : '未知錯誤');
  setCalendarStatus(message, 'error');
  showToast(message);
}

function requestGoogleAccess(promptValue) {
  if (!tokenClient) {
    showToast('Google 登入服務尚未載入完成');
    return;
  }

  tokenClient.callback = async function (response) {
    if (response.error) {
      setCalendarStatus('Google 授權未完成：' + response.error, 'error');
      showToast('未能取得 Google 日曆授權');
      return;
    }

    accessToken = response.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 60) * 1000;
    setCalendarStatus('Google 授權完成，正在尋找工作日曆…', 'busy');
    updateConnectionUI();

    if (currentCalendar && availableCalendars.length) await syncCalendar();
    else await loadCalendars();
  };

  tokenClient.requestAccessToken({ prompt: promptValue || '' });
}

function connectGoogle() {
  requestGoogleAccess('consent');
}

function manualSync() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    requestGoogleAccess('');
    return;
  }
  syncCalendar();
}

function disconnectGoogle() {
  const tokenToRevoke = accessToken;
  accessToken = '';
  tokenExpiresAt = 0;
  currentCalendar = null;
  availableCalendars = [];
  calendarTasks = [];
  rebuildTasks();
  closeCalendarChooser();
  setCalendarStatus('尚未連結 Google 日曆。', 'idle');
  $('#lastSync').textContent = '尚未同步';
  render();

  if (tokenToRevoke && window.google && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(tokenToRevoke, function () {});
  }
  showToast('已解除 Google 日曆連結');
}

function initialiseGoogleIdentity() {
  return new Promise(function (resolve, reject) {
    function finish() {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: APP_CONFIG.googleClientId,
          scope: APP_CONFIG.calendarScope,
          callback: function () {}
        });
        googleIdentityReady = true;
        setCalendarStatus('尚未連結 Google 日曆。', 'idle');
        updateConnectionUI();
        resolve();
      } catch (error) {
        reject(error);
      }
    }

    if (window.google && google.accounts && google.accounts.oauth2) {
      finish();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = function () {
      reject(new Error('無法載入 Google Identity Services'));
    };
    document.head.appendChild(script);
  });
}

$('#searchInput').oninput = function (event) {
  searchTerm = event.target.value;
  renderTasks();
};
$('#newTaskButton').onclick = openNewTask;
$('#settingsButton').onclick = openSettings;
$('#syncButton').onclick = manualSync;
$('#googleConnectButton').onclick = connectGoogle;
$('#googleDisconnectButton').onclick = disconnectGoogle;
$('#changeCalendarButton').onclick = openCalendarChooser;
$('#taskForm').onsubmit = saveTask;

document.querySelectorAll('.close-modal').forEach(function (element) { element.onclick = closeTask; });
document.querySelectorAll('.close-settings').forEach(function (element) { element.onclick = closeSettings; });
document.querySelectorAll('.close-calendar').forEach(function (element) { element.onclick = closeCalendarChooser; });

$('#taskModalBackdrop').onclick = function (event) {
  if (event.target === event.currentTarget) closeTask();
};
$('#settingsBackdrop').onclick = function (event) {
  if (event.target === event.currentTarget) closeSettings();
};
$('#calendarBackdrop').onclick = function (event) {
  if (event.target === event.currentTarget) closeCalendarChooser();
};

$('#categoryForm').onsubmit = function (event) {
  event.preventDefault();
  const input = $('#newCategoryInput');
  const name = input.value.trim();
  if (!name || categories.includes(name)) {
    showToast('請輸入尚未使用的分類名稱');
    return;
  }
  categories.push(name);
  input.value = '';
  saveLocalState();
  render();
  renderCategorySettings();
  showToast('已新增分類「' + name + '」');
};

setTodayLabel();
rebuildTasks();
render();
initialiseGoogleIdentity().catch(function (error) {
  console.error(error);
  setCalendarStatus('Google 登入服務載入失敗，請檢查網路後重新整理。', 'error');
  updateConnectionUI();
});
