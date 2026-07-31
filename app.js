const STATUS = {
  PENDING: { label: '待處理' }, IN_PROGRESS: { label: '進行中' },
  WAITING_CONTACT: { label: '待聯繫' }, WAITING_REPLY: { label: '等待回覆' },
  PENDING_CONFIRMATION: { label: '待確認' }, COMPLETED: { label: '已完成' },
  ON_HOLD: { label: '暫緩' }, CANCELLED: { label: '取消' }
};
const TODAY = '2026-07-31';
const defaultCategories = ['公文往來','防災演練','導護志工','宣導講座','教育訓練','例行行政'];
const defaultTasks = [
  {id:'t1',title:'防災演練工作會議',category:'',status:'PENDING',date:'2026-07-31',due:'2026-07-31',next:'確認各處室出席名單',note:'Google Calendar 新匯入，尚待判斷主題。',calendar:'生教 · 上午 10:00'},
  {id:'t2',title:'導護志工招募',category:'',status:'WAITING_CONTACT',date:'2026-08-01',due:'2026-08-04',next:'聯絡家長會確認招募公告',note:'需在開學前確認第一梯次名單。',calendar:'生教 · 全天'},
  {id:'t3',title:'回覆教育部公文',category:'公文往來',status:'IN_PROGRESS',date:'2026-07-30',due:'2026-07-31',next:'等待主任確認內容',note:'彙整校內回覆後，以公文系統送件。',calendar:'校務行政 · 下午 3:00'},
  {id:'t4',title:'資安稽核公文',category:'公文往來',status:'WAITING_CONTACT',date:'2026-08-01',due:'2026-08-02',next:'聯絡資訊組提供附件',note:'附件格式請依稽核清單整理。',calendar:'校務行政 · 全天'},
  {id:'t5',title:'友善校園成果彙整',category:'公文往來',status:'COMPLETED',date:'2026-07-29',due:'2026-07-30',next:'',note:'已於 7/29 送出。',calendar:'生教 · 上午 9:00',completedAt:'2026-07-29'},
  {id:'t6',title:'演練計畫確認',category:'防災演練',status:'COMPLETED',date:'2026-07-28',due:'2026-07-30',next:'',note:'校長已核定演練流程。',calendar:'防災演練 · 下午 2:00',completedAt:'2026-07-30'},
  {id:'t7',title:'各單位名單彙整',category:'防災演練',status:'WAITING_REPLY',date:'2026-07-30',due:'2026-08-01',next:'等待各處室回覆窗口名單',note:'已寄發名單填寫表。',calendar:'防災演練 · 全天'},
  {id:'t8',title:'消防演練成果報告',category:'防災演練',status:'IN_PROGRESS',date:'2026-07-22',due:'2026-07-29',next:'補上現場照片與檢討紀錄',note:'照片尚未由總務處提供。',calendar:'防災演練 · 下午 4:00'},
  {id:'t9',title:'導護志工排班確認',category:'導護志工',status:'PENDING_CONFIRMATION',date:'2026-07-31',due:'2026-07-31',next:'請家長會確認排班表',note:'先確認開學第一週。',calendar:'導護 · 上午 8:20'},
  {id:'t10',title:'交通安全宣導講座',category:'宣導講座',status:'PENDING',date:'2026-08-06',due:'2026-08-08',next:'確認講師檔期',note:'候選講師共三位。',calendar:'生教 · 下午 1:30'},
  {id:'t11',title:'新進教師校安教育',category:'教育訓練',status:'ON_HOLD',date:'2026-08-18',due:'2026-08-20',next:'待人事室公告名單',note:'依到職名單安排。',calendar:'教育訓練 · 上午 9:00'}
];
let categories = JSON.parse(localStorage.getItem('work-tracker-categories') || 'null') || defaultCategories;
let tasks = JSON.parse(localStorage.getItem('work-tracker-tasks') || 'null') || defaultTasks;
let selectedCategory = 'all', selectedQuick = 'open', searchTerm = '';
const $ = (s) => document.querySelector(s);
const save = () => { localStorage.setItem('work-tracker-categories', JSON.stringify(categories)); localStorage.setItem('work-tracker-tasks', JSON.stringify(tasks)); };
const statusOptions = (current) => Object.entries(STATUS).map(([key, value]) => `<option value="${key}" ${key===current?'selected':''}>${value.label}</option>`).join('');
const dateText = (date) => { if(!date) return '未設定'; if(date===TODAY) return '今天'; const d = new Date(`${date}T00:00:00`); return `${d.getMonth()+1}/${d.getDate()}`; };
const isOpen = task => !['COMPLETED','CANCELLED'].includes(task.status);
const isOverdue = task => isOpen(task) && task.due && task.due < TODAY;
const isToday = task => isOpen(task) && task.due === TODAY;
function matches(task){
  const haystack = [task.title,task.category,task.note,task.next,STATUS[task.status].label].join(' ').toLowerCase();
  if(searchTerm && !haystack.includes(searchTerm.toLowerCase())) return false;
  if(selectedCategory==='unclassified' && task.category) return false;
  if(!['all','unclassified'].includes(selectedCategory) && task.category !== selectedCategory) return false;
  if(selectedQuick==='open' && !isOpen(task)) return false;
  if(selectedQuick==='today' && !isToday(task)) return false;
  if(selectedQuick==='overdue' && !isOverdue(task)) return false;
  return !task.archived;
}
function card(task){
  const overdue = isOverdue(task) ? ' overdue':''; const done = !isOpen(task) ? ' is-complete':'';
  const due = task.due ? `<span class="${isOverdue(task)?'due-overdue':''}">截止 ${dateText(task.due)}</span>` : '';
  return `<article class="task-card${overdue}${done}" data-task-id="${task.id}"><div><div class="task-title-row"><span class="task-indicator"></span><h3 class="task-title">${escapeHTML(task.title)}</h3></div><div class="task-meta"><span>${dateText(task.date)}</span>${due}<span>${task.calendar.split(' · ')[0]}</span></div>${task.next?`<p class="task-next"><b>下一步</b>　${escapeHTML(task.next)}</p>`:''}</div><div class="task-actions"><select class="status-select" data-status="${task.status}" data-update-status="${task.id}" aria-label="${task.title} 的工作狀態">${statusOptions(task.status)}</select><button class="edit-task" data-edit="${task.id}" aria-label="編輯 ${task.title}">•••</button></div></article>`;
}
function escapeHTML(text=''){return text.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderFilters(){
  $('#categoryFilters').innerHTML = `<button class="filter-chip ${selectedCategory==='all'?'active':''}" data-category="all">全部</button><button class="filter-chip ${selectedCategory==='unclassified'?'active':''}" data-category="unclassified">未分類 <small>${tasks.filter(t=>!t.category && !t.archived).length}</small></button>${categories.map(c=>`<button class="filter-chip ${selectedCategory===c?'active':''}" data-category="${c}">${c}</button>`).join('')}`;
  document.querySelectorAll('[data-category]').forEach(btn=>btn.onclick=()=>{selectedCategory=btn.dataset.category;render();});
  document.querySelectorAll('[data-filter]').forEach(btn=>{btn.classList.toggle('active',btn.dataset.filter===selectedQuick);btn.onclick=()=>{selectedQuick=btn.dataset.filter;render();};});
}
function group(title, taskList, unclassified=false){
  const counts = Object.entries(STATUS).filter(([key])=>taskList.some(t=>t.status===key)).map(([key,val])=>`<span class="mini-stat">${val.label} ${taskList.filter(t=>t.status===key).length}</span>`).join('');
  return `<section class="task-group${unclassified?' unclassified':''}" data-group="${title}"><header class="group-header"><div class="group-header-left"><span class="category-accent"></span><div><h2 class="group-name">${title} <small>(${taskList.length})</small></h2><p class="group-subtitle">${taskList.filter(isOpen).length} 項未完成　${counts}</p></div></div><button class="collapse-button" aria-label="收合 ${title}">⌄</button></header><div class="task-list">${taskList.map(card).join('')}</div></section>`;
}
function renderTasks(){
  const list = tasks.filter(matches); const groupData=[];
  const uncategorized=list.filter(t=>!t.category); if(uncategorized.length) groupData.push(group('未分類',uncategorized,true));
  categories.forEach(c=>{ const cTasks=list.filter(t=>t.category===c); if(cTasks.length) groupData.push(group(c,cTasks));});
  const other = list.filter(t=>t.category && !categories.includes(t.category)); if(other.length) groupData.push(group('其他',other));
  $('#taskGroups').innerHTML=groupData.join(''); $('#emptyState').classList.toggle('hidden',list.length>0);
  $('#visibleSummary').textContent=`顯示 ${list.length} 項工作`;
  document.querySelectorAll('.collapse-button').forEach(btn=>btn.onclick=()=>btn.closest('.task-group').classList.toggle('collapsed'));
  document.querySelectorAll('[data-update-status]').forEach(select=>select.onchange=e=>changeStatus(select.dataset.updateStatus,e.target.value));
  document.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openTask(btn.dataset.edit));
}
const reminders = [
  {key:'overdue',title:'已逾期',className:'overdue',filter:isOverdue},
  {key:'today',title:'今天到期',className:'today',filter:isToday},
  {key:'contact',title:'待聯繫',filter:t=>t.status==='WAITING_CONTACT'},
  {key:'reply',title:'等待回覆',filter:t=>t.status==='WAITING_REPLY'},
  {key:'confirm',title:'待確認',filter:t=>t.status==='PENDING_CONFIRMATION'}
];
function renderReminders(){
  const html=reminders.map(section=>{const list=tasks.filter(t=>!t.archived&&section.filter(t));return `<section class="reminder-section ${section.className||''}"><h3 class="reminder-title">${section.title}<span class="reminder-count">${String(list.length).padStart(2,'0')}</span></h3>${list.length?list.slice(0,4).map(t=>`<div class="reminder-item" data-reminder-task="${t.id}"><span class="reminder-bullet"></span><div><p class="reminder-task">${escapeHTML(t.title)}</p><p class="reminder-meta">${t.category||'未分類'} · ${STATUS[t.status].label}</p></div><time class="reminder-date">${dateText(t.due)}</time></div>`).join(''):`<p class="reminder-empty">目前沒有需要處理的工作</p>`}</section>`;}).join('');
  $('#reminderLists').innerHTML=html; document.querySelectorAll('[data-reminder-task]').forEach(el=>el.onclick=()=>openTask(el.dataset.reminderTask));
  $('#todayCount').textContent=tasks.filter(t=>!t.archived&&(isToday(t)||isOverdue(t))).length;
}
function render(){renderFilters();renderTasks();renderReminders();}
function showToast(message){const el=$('#toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.add('hidden'),2600);}
function changeStatus(id,status){const task=tasks.find(t=>t.id===id);if(!task||task.status===status)return;task.status=status;task.lastUpdated=new Date().toISOString();if(status==='COMPLETED')task.completedAt=TODAY;else if(task.completedAt)delete task.completedAt;save();render();showToast(`「${task.title}」已更新為${STATUS[status].label}`);}
function updateTaskCategoryOptions(current=''){ $('#taskCategory').innerHTML=`<option value="">未分類</option>${categories.map(c=>`<option value="${c}" ${c===current?'selected':''}>${c}</option>`).join('')}`; }
function openTask(id){const task=tasks.find(t=>t.id===id);if(!task)return;$('#taskForm').reset();$('#taskId').value=task.id;$('#taskTitle').value=task.title;updateTaskCategoryOptions(task.category);$('#taskStatus').innerHTML=statusOptions(task.status);$('#taskDate').value=task.date;$('#taskDueDate').value=task.due||'';$('#taskNextAction').value=task.next||'';$('#taskNote').value=task.note||'';$('#taskArchived').checked=!!task.archived;$('#calendarOrigin').textContent=task.calendar || '尚未連接 Google Calendar';$('#modalTitle').textContent='工作詳細資料';$('#taskModalBackdrop').classList.remove('hidden');$('#taskTitle').focus();}
function closeTask(){ $('#taskModalBackdrop').classList.add('hidden'); }
function openNewTask(){$('#taskForm').reset();$('#taskId').value='';$('#modalTitle').textContent='新增追蹤工作';updateTaskCategoryOptions();$('#taskStatus').innerHTML=statusOptions('PENDING');$('#taskDate').value=TODAY;$('#calendarOrigin').textContent='手動建立的追蹤工作';$('#taskModalBackdrop').classList.remove('hidden');$('#taskTitle').focus();}
function saveTask(event){event.preventDefault();const id=$('#taskId').value;let task=tasks.find(t=>t.id===id);const isNew=!task;if(!task){task={id:`manual-${Date.now()}`,calendar:'手動建立'};tasks.unshift(task);}const oldStatus=task.status;Object.assign(task,{title:$('#taskTitle').value.trim(),category:$('#taskCategory').value,status:$('#taskStatus').value,date:$('#taskDate').value,due:$('#taskDueDate').value,next:$('#taskNextAction').value.trim(),note:$('#taskNote').value.trim(),archived:$('#taskArchived').checked,lastUpdated:new Date().toISOString()});if(task.status==='COMPLETED'&&oldStatus!=='COMPLETED')task.completedAt=TODAY;if(task.status!=='COMPLETED')delete task.completedAt;save();closeTask();render();showToast(isNew?'已建立新的追蹤工作':'工作內容已自動儲存');}
function renderCategorySettings(){ $('#categorySettings').innerHTML=categories.map((c,i)=>`<div class="category-setting-row"><span class="category-handle">⠿</span><input value="${c}" data-category-name="${i}" aria-label="分類名稱"/><span class="category-enabled">啟用中</span><button class="category-delete" data-delete-category="${i}" aria-label="刪除 ${c}">×</button></div>`).join('');document.querySelectorAll('[data-category-name]').forEach(input=>input.onchange=()=>{const i=Number(input.dataset.categoryName), previous=categories[i],next=input.value.trim();if(!next||categories.includes(next)&&next!==previous){input.value=previous;showToast('分類名稱不可重複或空白');return;}categories[i]=next;tasks.forEach(t=>{if(t.category===previous)t.category=next;});save();render();renderCategorySettings();});document.querySelectorAll('[data-delete-category]').forEach(btn=>btn.onclick=()=>{const i=Number(btn.dataset.deleteCategory),name=categories[i], assigned=tasks.filter(t=>t.category===name).length;if(assigned&&!confirm(`「${name}」有 ${assigned} 項工作，刪除後會移至未分類。是否繼續？`))return;tasks.forEach(t=>{if(t.category===name)t.category='';});categories.splice(i,1);if(selectedCategory===name)selectedCategory='all';save();render();renderCategorySettings();showToast(`已刪除分類「${name}」`);});}
function openSettings(){renderCategorySettings();$('#settingsBackdrop').classList.remove('hidden');}
function closeSettings(){$('#settingsBackdrop').classList.add('hidden');}
function sync(){const btn=$('#syncButton');btn.disabled=true;btn.innerHTML='↻ 同步中…';setTimeout(()=>{btn.disabled=false;btn.innerHTML='<span>↻</span> 立即同步';$('#lastSync').textContent='剛剛';showToast('同步完成：目前為介面示範資料，Google Calendar 連線待設定');},850);}
$('#searchInput').oninput=e=>{searchTerm=e.target.value;renderTasks();};$('#newTaskButton').onclick=openNewTask;$('#settingsButton').onclick=openSettings;$('#syncButton').onclick=sync;$('#taskForm').onsubmit=saveTask;document.querySelectorAll('.close-modal').forEach(x=>x.onclick=closeTask);document.querySelectorAll('.close-settings').forEach(x=>x.onclick=closeSettings);$('#taskModalBackdrop').onclick=e=>{if(e.target===e.currentTarget)closeTask();};$('#settingsBackdrop').onclick=e=>{if(e.target===e.currentTarget)closeSettings();};$('#categoryForm').onsubmit=e=>{e.preventDefault();const input=$('#newCategoryInput'),name=input.value.trim();if(!name||categories.includes(name)){showToast('請輸入尚未使用的分類名稱');return;}categories.push(name);input.value='';save();render();renderCategorySettings();showToast(`已新增分類「${name}」`);};
render();
