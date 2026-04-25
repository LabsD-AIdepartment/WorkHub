(function () {
  const Config = window.DireWolfConfig || window.WolfGridConfig;
  const storageKeys = {
    snapshot: 'wolfgrid_rebuild_snapshot',
    session: 'wolfgrid_rebuild_session',
  };

  function emptyData() {
    return {
      departments: [],
      users: [],
      projects: [],
      tasks: [],
      meetings: [],
      briefs: [],
      notifications: [],
    };
  }

  const state = {
    data: emptyData(),
    dataSource: 'Waiting for database',
    currentUserId: null,
    activePage: 'dashboard',
    activeDepartment: 'all',
    activeProjectDrawerId: null,
    drawerReturnProjectId: null,
    openCommentPanels: new Set(),
    calendarCursor: new Date(),
    filters: {
      taskSearch: '',
      taskProject: 'all',
      taskMine: false,
      taskDept: 'all',
      projectDept: 'all',
      projectVisibility: 'all',
    },
  };

  const pageMeta = {
    dashboard: { title: 'Overview', subtitle: 'Company-wide delivery snapshot', create: { label: '+ New Task', entity: 'task' } },
    onlyme: { title: 'Only me', subtitle: 'Your personal queue of tasks, briefs, and meetings', create: null },
    board: { title: 'Task Board', subtitle: 'Shared workflow with ClickUp-style status lanes', create: { label: '+ New Task', entity: 'task' } },
    calendar: { title: 'Calendar', subtitle: 'Daily timeline for tasks and meetings', create: { label: '+ New Meeting', entity: 'meeting' } },
    projects: { title: 'Projects', subtitle: 'Public and secret projects in one operating view', create: { label: '+ New Project', entity: 'project' } },
    meetings: { title: 'Meetings', subtitle: 'Meeting schedule, attendees, notes, and reminders', create: { label: '+ New Meeting', entity: 'meeting' } },
    briefs: { title: 'CEO Brief', subtitle: 'Restricted briefs that can convert into execution tasks', create: { label: '+ New Brief', entity: 'brief' } },
    team: { title: 'Team', subtitle: 'Manage users, roles, and departments', create: { label: '+ Add User', entity: 'user' } },
    notifications: { title: 'Notifications', subtitle: 'Per-user updates and unread alerts', create: null },
  };

  const DOM = {};
  const projectColorPresets = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#64748b'];

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function canonicalDepartmentName(value) {
    const key = normalizeText(value);
    const known = {
      'ceo': 'CEO Office',
      'ceo office': 'CEO Office',
      'executive': 'Executive',
      'marketing': 'Marketing',
      'tech': 'Tech',
      'technology': 'Tech',
      'branding': 'Branding',
      'production': 'Production',
      'telesale': 'Telesale',
      'sales': 'Telesale',
      'sale': 'Telesale',
    };
    return known[key] || String(value || 'General').trim() || 'General';
  }

  function canonicalDepartmentId(value) {
    const name = canonicalDepartmentName(value);
    return normalizeText(name).replace(/[^a-z0-9]+/g, '-');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // bcryptjs loaded via CDN — exposes window.dcodeIO.bcrypt
  const _bcrypt = (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) || window.bcrypt || null;

  function hashPassword(plain) {
    if (!plain) return plain;
    if (_bcrypt) return _bcrypt.hashSync(plain, 10);
    return plain; // fallback: bcryptjs not loaded (no internet) — keep as-is
  }

  function verifyPassword(entered, stored) {
    const s = stored || '1234';
    if (s.startsWith('$2')) return _bcrypt ? _bcrypt.compareSync(entered, s) : entered === s;
    return entered === s; // legacy plaintext comparison
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function readLocal(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (error) {
      return null;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Could not persist to localStorage', error);
    }
  }

  function hasMockData(snapshot) {
    if (!snapshot) return false;
    const ids = []
      .concat((snapshot.users || []).map((item) => item.id))
      .concat((snapshot.projects || []).map((item) => item.id))
      .concat((snapshot.tasks || []).map((item) => item.id))
      .concat((snapshot.briefs || []).map((item) => item.id));
    return ids.some((id) => ['u_admin', 'u_ceo', 'u_exec', 'p_chatbot', 'p_erp', 'p_sales', 't1', 't2', 'b1', 'b2'].includes(id));
  }

  function purgeMockCache() {
    const snapshot = readLocal(storageKeys.snapshot);
    if (hasMockData(snapshot)) {
      localStorage.removeItem(storageKeys.snapshot);
      localStorage.removeItem(storageKeys.session);
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function localDateIso(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function todayIso() {
    return localDateIso();
  }

  function currentDayRatio() {
    const now = new Date();
    const seconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
    return seconds / 86400;
  }

  function nowLocalInput() {
    const date = new Date();
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  function formatDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return 'No time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function byId(list, id) {
    return list.find((item) => item.id === id) || null;
  }

  function roleMeta(access) {
    return Config.roles[access] || Config.roles.member;
  }

  function roleRank(userOrAccess) {
    const access = typeof userOrAccess === 'string' ? userOrAccess : userOrAccess?.access;
    return roleMeta(access).rank;
  }

  function currentUser() {
    return byId(state.data.users, state.currentUserId);
  }

  function currentDepartment() {
    return state.activeDepartment === 'all' ? null : byId(state.data.departments, state.activeDepartment);
  }

  function getDepartment(id) {
    return byId(state.data.departments, id);
  }

  function getUser(id) {
    return byId(state.data.users, id);
  }

  function getProject(id) {
    return byId(state.data.projects, id);
  }

  function getTask(id) {
    return byId(state.data.tasks, id);
  }

  function getMeeting(id) {
    return byId(state.data.meetings, id);
  }

  function getBrief(id) {
    return byId(state.data.briefs, id);
  }

  function getVisibleProjects(user = currentUser()) {
    return state.data.projects.filter((project) => canViewProject(project, user));
  }

  function getVisibleTasks(user = currentUser()) {
    return state.data.tasks.filter((task) => canViewTask(task, user));
  }

  function getVisibleBriefs(user = currentUser()) {
    return state.data.briefs.filter((brief) => canViewBrief(brief, user));
  }

  function getVisibleNotifications(user = currentUser()) {
    return state.data.notifications
      .filter((notification) => notification.userId === user?.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function assignedOnlyMeItems(user = currentUser()) {
    const items = filterWorkItemsByActiveDepartment(getVisibleWorkItems(user))
      .filter((item) => (item.assigneeIds || []).includes(user?.id));
    const meetings = state.data.meetings
      .filter((meeting) => (meeting.attendeeIds || []).includes(user?.id) || meeting.createdBy === user?.id)
      .filter((meeting) => state.activeDepartment === 'all' || meeting.departmentId === state.activeDepartment || (meeting.attendeeIds || []).includes(user?.id))
      .map((meeting) => ({
        kind: 'meeting',
        id: meeting.id,
        title: meeting.title,
        description: meeting.description || '',
        departmentId: meeting.departmentId,
        priority: 'low',
        status: 'inprogress',
        when: meeting.startAt || meeting.createdAt || '',
        dueDate: (meeting.startAt || '').slice(0, 10),
        openAction: 'meeting-open',
        sourceId: meeting.id,
        location: meeting.location || '',
        startAt: meeting.startAt || '',
        projectId: '',
        createdAt: meeting.createdAt || '',
      }));

    return items
      .map((item) => ({
        kind: item.originLabel === 'CEO Brief' ? 'brief' : 'task',
        id: item.id,
        title: item.title,
        description: item.description || '',
        departmentId: item.departmentId,
        priority: item.priority || 'medium',
        status: item.status,
        when: item.dueDate || item.startDate || item.createdAt || '',
        dueDate: item.dueDate || '',
        startDate: item.startDate || '',
        openAction: item.openAction,
        sourceId: item.sourceId,
        projectId: item.projectId || '',
        originLabel: item.originLabel,
      }))
      .concat(meetings)
      .sort(compareOnlyMeEntries);
  }

  function compareOnlyMeEntries(a, b) {
    const aTime = a.when ? new Date(a.when).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.when ? new Date(b.when).getTime() : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  }

  function normalizeWorkflowStatus(status) {
    const value = normalizeText(status);
    const alias = {
      draft: 'backlog',
      assign: 'backlog',
      assigned: 'backlog',
      none: 'backlog',
      todo: 'backlog',
      backlog: 'backlog',
      progress: 'inprogress',
      'in progress': 'inprogress',
      inprogress: 'inprogress',
      doing: 'inprogress',
      review: 'review',
      qa: 'review',
      blocked: 'review',
      delay: 'review',
      delayed: 'review',
      approve: 'approve',
      approved: 'approve',
      finish: 'approve',
      finished: 'approve',
      completed: 'approve',
      complete: 'approve',
      done: 'approve',
    };
    return alias[value] || 'backlog';
  }

  function isCompleteStatus(status) {
    return normalizeWorkflowStatus(status) === 'approve';
  }

  function inferProgressFromStatus(status) {
    return {
      backlog: 0,
      inprogress: 25,
      review: 75,
      approve: 100,
    }[normalizeWorkflowStatus(status)] ?? 0;
  }

  function nextWorkflowStatus(status) {
    const order = Config.taskStatuses.map((item) => item.id);
    const current = normalizeWorkflowStatus(status);
    const index = order.indexOf(current);
    return order[(index + 1 + order.length) % order.length] || order[0] || 'backlog';
  }

  function deriveTaskStatusFromSubtasks(task) {
    const items = (task.subtasks || []).map(normalizeSubtask);
    if (!items.length) return normalizeWorkflowStatus(task.status);
    if (items.every((item) => normalizeWorkflowStatus(item.status) === 'approve')) return 'approve';
    if (items.some((item) => normalizeWorkflowStatus(item.status) === 'review')) return 'review';
    if (items.some((item) => normalizeWorkflowStatus(item.status) === 'inprogress')) return 'inprogress';
    return 'backlog';
  }

  function priorityRank(priority) {
    return {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }[normalizeText(priority)] ?? 99;
  }

  function urgencyRank(dueDate) {
    if (!dueDate) return 99;
    const startOfToday = new Date(todayIso());
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return 98;
    const diffDays = Math.floor((due - startOfToday) / 86400000);
    if (diffDays < 0) return -10 + diffDays;
    if (diffDays === 0) return 0;
    if (diffDays <= 3) return 1;
    if (diffDays <= 7) return 2;
    return 3 + diffDays;
  }

  function compareWorkItems(a, b) {
    // NOTE: completed items stay in their original position — no completeDiff push-to-bottom.
    // Primary: urgency (overdue first)
    const urgencyDiff = urgencyRank(a.dueDate) - urgencyRank(b.dueDate);
    if (urgencyDiff !== 0) return urgencyDiff;

    // Secondary: priority
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    // Tertiary: due date ascending
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;

    // Final: creation order (oldest first = stable list order)
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  }

  function getUserInitials(user) {
    return (user?.nick || user?.name || '?').slice(0, 2).toUpperCase();
  }

  function avatarHtml(user, sizeClass) {
    return `<span class="avatar ${sizeClass || ''}" style="background:${safeColor(user.color, '#6d28d9')}">${escapeHtml(getUserInitials(user))}</span>`;
  }

  function statusDotClass(status) {
    return ['online', 'busy', 'away', 'offline'].includes(status) ? status : 'offline';
  }

  function priorityChip(priority) {
    const meta = Config.priorities.find((item) => item.id === priority) || Config.priorities[2];
    const c = safeColor(meta.color);
    return `<span class="priority-chip" style="background:${hexToAlpha(c, 0.18)};color:${c};border-color:${hexToAlpha(c, 0.34)};">${escapeHtml(meta.label)}</span>`;
  }

  function statusChip(status, options = {}) {
    const meta = Config.taskStatuses.find((item) => item.id === normalizeWorkflowStatus(status)) || Config.taskStatuses[0];
    const tag = options.action ? 'button' : 'span';
    const attrs = options.action
      ? ` type="button" class="status-chip is-actionable" data-action="${options.action}" ${
        Object.entries(options.data || {}).map(([key, value]) => `data-${key}="${escapeHtml(String(value))}"`).join(' ')
      }`
      : ' class="status-chip"';
    const c = safeColor(meta.color);
    return `<${tag}${attrs} style="background:${hexToAlpha(c, 0.18)};color:${c};border-color:${hexToAlpha(c, 0.34)};">${escapeHtml(meta.label)}</${tag}>`;
  }

  function roleChip(access) {
    const meta = roleMeta(access);
    const c = safeColor(meta.color);
    return `<span class="role-chip" style="background:${hexToAlpha(c, 0.16)};color:${c};border-color:${hexToAlpha(c, 0.32)};">${escapeHtml(meta.label)}</span>`;
  }

  function departmentChip(departmentId) {
    const department = getDepartment(departmentId);
    if (!department) return '';
    const c = safeColor(department.color, '#64748b');
    return `<span class="tag-chip" style="background:${hexToAlpha(c, 0.16)};color:${c};border-color:${hexToAlpha(c, 0.3)};">${escapeHtml(department.name)}</span>`;
  }

  // Defensive: validate color is a safe CSS hex (#abc or #aabbcc) before letting it touch innerHTML/style.
  // Falls back to a neutral default if not. Prevents CSS / style-attr injection from compromised user data.
  function safeColor(value, fallback = '#6d28d9') {
    if (typeof value !== 'string') return fallback;
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim()) ? value.trim() : fallback;
  }

  function hexToAlpha(hex, alpha) {
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return safeColor(hex);
    const value = hex.slice(1);
    const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function isHigher(actor, target) {
    return roleRank(actor) < roleRank(target);
  }

  function sameUser(a, b) {
    return a?.id && b?.id && a.id === b.id;
  }

  function canManageUsers(user = currentUser()) {
    return !!user && user.access === 'admin';
  }

  function canCreateProject(user = currentUser()) {
    return !!user && roleRank(user) <= roleRank('head');
  }

  function canAssign(actor, target) {
    if (!actor || !target) return false;
    if (sameUser(actor, target)) return true;
    if (actor.access === 'admin') return true;
    return isHigher(actor, target);
  }

  function canViewProject(project, user = currentUser()) {
    if (!project || !user) return false;
    if (['admin', 'ceo', 'executive'].includes(user.access)) return true;
    if (!project.isSecret) return true;
    if (project.ownerId === user.id) return true;
    return (project.memberIds || []).includes(user.id);
  }

  function canEditProject(project, user = currentUser()) {
    if (!project || !user) return false;
    if (user.access === 'admin') return true;
    if (project.ownerId === user.id) return true;
    const owner = getUser(project.ownerId);
    return !!owner && canCreateProject(user) && isHigher(user, owner) && canViewProject(project, user);
  }

  function canViewTask(task, user = currentUser()) {
    if (!task || !user) return false;
    const project = getProject(task.projectId);
    if (project && !canViewProject(project, user)) return false;
    if (['admin', 'ceo', 'executive'].includes(user.access)) return true;
    if (project && (project.ownerId === user.id || (project.memberIds || []).includes(user.id))) return true;
    if (task.createdBy === user.id) return true;
    if ((task.assigneeIds || []).includes(user.id)) return true;
    return roleRank(user) <= roleRank('head');
  }

  function canEditTask(task, user = currentUser()) {
    if (!task || !user) return false;
    if (user.access === 'admin') return true;
    if (task.createdBy === user.id) return true;
    const project = getProject(task.projectId);
    if (project && canEditProject(project, user)) return true;
    const creator = getUser(task.createdBy);
    if (creator) return isHigher(user, creator);
    if (project) return canEditProject(project, user);
    return false;
  }

  function canUpdateTask(task, user = currentUser()) {
    if (!task || !user) return false;
    if (canEditTask(task, user)) return true;
    return (task.assigneeIds || []).includes(user.id);
  }

  function canCommentOnTask(task, user = currentUser()) {
    if (!task || !user) return false;
    if (['admin', 'ceo', 'executive'].includes(user.access)) return true;
    const project = getProject(task.projectId);
    if (project) {
      if (!canViewProject(project, user)) return false;
      if (project.ownerId === user.id || (project.memberIds || []).includes(user.id)) return true;
    }
    if (task.createdBy === user.id) return true;
    return (task.assigneeIds || []).includes(user.id);
  }

  function canDeleteTask(task, user = currentUser()) {
    return canEditTask(task, user);
  }

  function canViewBrief(brief, user = currentUser()) {
    if (!brief || !user) return false;
    if (user.access === 'admin' || user.access === 'ceo') return true;
    if (brief.createdBy === user.id) return true;
    return (brief.assigneeIds || []).includes(user.id);
  }

  function canEditBrief(brief, user = currentUser()) {
    if (!brief || !user) return false;
    if (user.access === 'admin' || user.access === 'ceo') return true;
    if (brief.createdBy === user.id) return true;
    const creator = getUser(brief.createdBy);
    return !!creator && isHigher(user, creator);
  }

  function canCreateUser(user = currentUser()) {
    return canManageUsers(user);
  }

  function canDeleteUser(target, actor = currentUser()) {
    if (!actor || !target) return false;
    if (!canManageUsers(actor)) return false;
    return actor.id !== target.id;
  }

  function canEditUser(target, actor = currentUser()) {
    if (!actor || !target) return false;
    if (canManageUsers(actor)) return true;
    return actor.id === target.id;
  }

  function canCreateMeeting(user = currentUser()) {
    return !!user && roleRank(user) <= roleRank('member');
  }

  function isOverdue(task) {
    return !!task.dueDate && !isCompleteStatus(task.status) && new Date(task.dueDate) < new Date(todayIso());
  }

  function taskProgress(task) {
    if (task?.subtasks?.length) {
      return recalcTaskProgress(task);
    }
    const normalized = normalizeWorkflowStatus(task?.status);
    if (normalized === 'approve') return 100;
    const explicit = Number(task?.progress);
    if (Number.isFinite(explicit) && explicit >= 0) return clamp(explicit, 0, 100);
    return inferProgressFromStatus(normalized);
  }

  function subtaskProgress(subtask) {
    if (!subtask) return 0;
    const normalized = normalizeWorkflowStatus(subtask.status);
    if (subtask.done || normalized === 'approve') return 100;
    const explicit = Number(subtask.progress);
    if (Number.isFinite(explicit) && explicit >= 0) return clamp(explicit, 0, 100);
    return inferProgressFromStatus(normalized);
  }

  function normalizeSubtaskStatus(value) {
    return normalizeWorkflowStatus(value || 'backlog');
  }

  function normalizeSubtask(subtask = {}) {
    const normalizedStatus = normalizeSubtaskStatus(subtask.status);
    const progress = subtaskProgress({ ...subtask, status: normalizedStatus });
    return {
      id: subtask.id || uid('st'),
      title: subtask.title || '',
      description: subtask.description || '',
      status: normalizedStatus,
      progress,
      startDate: subtask.startDate || '',
      dueDate: subtask.dueDate || '',
      done: subtask.done === true || normalizedStatus === 'approve' || progress >= 100,
    };
  }

  function isoDayStamp(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function diffDay(from, to) {
    const start = isoDayStamp(from);
    const end = isoDayStamp(to);
    if (!start || !end) return 0;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  function addIsoDays(value, amount) {
    const base = isoDayStamp(value) || isoDayStamp(todayIso());
    base.setDate(base.getDate() + amount);
    return localDateIso(base);
  }

  function formatShortDate(value) {
    if (!value) return 'No date';
    const date = isoDayStamp(value);
    if (!date) return 'No date';
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(date);
  }

  function renderColorPicker(value = '#6d28d9') {
    const current = value || '#6d28d9';
    return `
      <div class="color-picker" data-color-picker>
        <input type="hidden" name="color" value="${escapeHtml(current)}">
        <div class="color-picker-current">
          <span class="color-preview" data-color-preview style="background:${current}"></span>
          <div>
            <strong data-color-label>${escapeHtml(current.toUpperCase())}</strong>
            <div class="muted">Choose a preset color or set a custom color</div>
          </div>
        </div>
        <div class="color-swatch-list">
          ${projectColorPresets.map((color) => `
            <button
              class="color-swatch ${color.toLowerCase() === current.toLowerCase() ? 'active' : ''}"
              type="button"
              data-action="color-pick"
              data-color="${color}"
              style="--swatch:${color}"
              aria-label="Pick ${color}"
            ></button>
          `).join('')}
        </div>
        <label class="field full color-picker-custom">
          <span>Custom color</span>
          <input type="color" value="${escapeHtml(current)}" data-color-custom>
        </label>
      </div>
    `;
  }

  function sprintEntriesForProject(projectId) {
    const tasks = projectTasks(projectId)
      .filter((task) => canViewTask(task))
      .sort(compareWorkItems);
    return tasks.map((task) => ({
      id: `task-group:${task.id}`,
      task: {
        id: `task-row:${task.id}`,
        sourceId: task.id,
        title: task.title,
        description: task.description || '',
        status: normalizeWorkflowStatus(task.status),
        priority: task.priority,
        progress: taskProgress(task),
        startDate: task.startDate || '',
        dueDate: task.dueDate || '',
        assigneeIds: task.assigneeIds || [],
        isSubtask: false,
        parentTitle: '',
        color: getProject(projectId)?.color || '#6d28d9',
      },
      children: (task.subtasks || []).map(normalizeSubtask).map((subtask) => ({
        id: `subtask-row:${task.id}:${subtask.id}`,
        sourceId: subtask.id,
        title: subtask.title,
        description: subtask.description || '',
        status: normalizeWorkflowStatus(subtask.status),
        priority: task.priority,
        progress: subtaskProgress(subtask),
        startDate: subtask.startDate || task.startDate || '',
        dueDate: subtask.dueDate || task.dueDate || '',
        assigneeIds: task.assigneeIds || [],
        isSubtask: true,
        parentTitle: task.title,
        parentTaskId: task.id,
        color: getProject(projectId)?.color || '#6d28d9',
      })),
    }));
  }

  function startOfWeekIso(iso) {
    const date = isoDayStamp(iso);
    date.setDate(date.getDate() - date.getDay());
    return localDateIso(date);
  }

  function endOfWeekIso(iso) {
    return addIsoDays(startOfWeekIso(iso), 6);
  }

  function startOfMonthIso(iso) {
    const date = isoDayStamp(iso);
    date.setDate(1);
    return localDateIso(date);
  }

  function endOfMonthIso(iso) {
    const date = isoDayStamp(startOfMonthIso(iso));
    date.setMonth(date.getMonth() + 1, 0);
    return localDateIso(date);
  }

  function monthDiff(startIso, endIso) {
    const start = isoDayStamp(startIso);
    const end = isoDayStamp(endIso);
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  }

  function sprintBucketIndex(iso, range) {
    if (range.mode === 'monthly') {
      return monthDiff(range.start, startOfMonthIso(iso)) + 1;
    }
    if (range.mode === 'weekly') {
      return Math.floor(diffDay(range.start, startOfWeekIso(iso)) / 7) + 1;
    }
    return diffDay(range.start, iso) + 1;
  }

  function sprintBucketLabel(index, range) {
    if (range.mode === 'monthly') {
      const date = isoDayStamp(range.start);
      date.setMonth(date.getMonth() + index);
      return new Intl.DateTimeFormat('th-TH', { month: 'short', year: index === 0 ? 'numeric' : undefined }).format(date);
    }
    if (range.mode === 'weekly') {
      const bucketStart = addIsoDays(range.start, index * 7);
      const date = isoDayStamp(bucketStart);
      return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: date.getDate() <= 7 ? 'short' : undefined }).format(date);
    }
    const date = isoDayStamp(addIsoDays(range.start, index));
    return index === 0 || date.getDate() === 1
      ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(date)
      : String(date.getDate());
  }

  function sprintTodayRatio(range) {
    const today = todayIso();
    if (!range || today < range.start || today > range.end || !range.days) return null;
    if (range.mode === 'daily') {
      const offsetDays = diffDay(range.start, today) + currentDayRatio();
      return clamp(offsetDays / Math.max(1, range.days), 0, 1);
    }
    if (range.mode === 'weekly') {
      const offsetDays = diffDay(range.start, today) + currentDayRatio();
      if (offsetDays < 0) return null;
      const bucketIndex = Math.floor(offsetDays / 7);
      const intraBucket = offsetDays % 7;
      return clamp((bucketIndex + (intraBucket / 7)) / Math.max(1, range.days), 0, 1);
    }
    const monthStart = startOfMonthIso(today);
    const monthIndex = monthDiff(range.start, monthStart);
    if (monthIndex < 0 || monthIndex >= range.days) return null;
    const currentMonth = isoDayStamp(today);
    const currentDay = currentMonth.getDate() - 1 + currentDayRatio();
    const monthDays = currentMonth.getMonth() === 11
      ? 31
      : isoDayStamp(endOfMonthIso(today)).getDate();
    return clamp((monthIndex + (currentDay / Math.max(1, monthDays))) / Math.max(1, range.days), 0, 1);
  }

  function timelineLineStyle(ratio, offsetVar) {
    if (ratio === null || !Number.isFinite(ratio)) return '';
    return `style="left:calc(${offsetVar} + (100% - ${offsetVar}) * ${ratio.toFixed(6)})"`;
  }

  function getProjectSprintRange(groups = [], fallbackDate = todayIso(), projectStart = '') {
    const entries = groups.flatMap((group) => [group.task].concat(group.children || []));
    const dated = entries.filter((entry) => entry.startDate || entry.dueDate);

    // No task dates → fall back to project-level start/deadline or a 28-day window
    if (!dated.length) {
      const s = projectStart || fallbackDate;
      const e = fallbackDate || addIsoDays(s, 27);
      const d = Math.max(3, diffDay(s, e) + 1);
      if (d > 180) {
        const ms = startOfMonthIso(s); const me = endOfMonthIso(e);
        return { start: ms, end: me, days: monthDiff(ms, me) + 1, mode: 'monthly' };
      }
      if (d > 45) {
        const ws = startOfWeekIso(s); const we = endOfWeekIso(e);
        return { start: ws, end: we, days: Math.floor(diffDay(ws, we) / 7) + 1, mode: 'weekly' };
      }
      return { start: s, end: e, days: d, mode: 'daily' };
    }

    // Use actual task date bounds + project-level hints
    const starts = dated.map((entry) => entry.startDate || entry.dueDate);
    const ends   = dated.map((entry) => entry.dueDate || entry.startDate);
    const minDate = [projectStart, ...starts].filter(Boolean).sort()[0];
    const maxDate = [...ends, fallbackDate].filter(Boolean).sort().slice(-1)[0];
    const totalDays = Math.max(1, diffDay(minDate, maxDate) + 1);

    if (totalDays > 180) {
      const start = startOfMonthIso(minDate);
      const end = endOfMonthIso(maxDate);
      return { start, end, days: monthDiff(start, end) + 1, mode: 'monthly' };
    }

    if (totalDays > 45) {
      const start = startOfWeekIso(minDate);
      const end = endOfWeekIso(maxDate);
      return { start, end, days: Math.floor(diffDay(start, end) / 7) + 1, mode: 'weekly' };
    }

    // Daily: anchor to actual data range (not today)
    const start = addIsoDays(minDate, -1);
    const end   = addIsoDays(maxDate, 2);
    return { start, end, days: Math.max(3, diffDay(start, end) + 1), mode: 'daily' };
  }

  function sprintPhaseTheme(index) {
    const palette = [
      { label: 'Phase 1', color: '#5b9dff' },
      { label: 'Phase 2', color: '#37b98f' },
      { label: 'Phase 3', color: '#c58a2e' },
      { label: 'Phase 4', color: '#df7347' },
      { label: 'Phase 5', color: '#8b7ae6' },
      { label: 'Phase 6', color: '#d96b9c' },
    ];
    return palette[index % palette.length];
  }

  function sprintComplexity(entry) {
    const value = normalizeText(entry.priority);
    if (value === 'critical' || value === 'high') return { label: 'High', className: 'is-high' };
    if (value === 'low') return { label: 'Low', className: 'is-low' };
    return { label: 'Medium', className: 'is-medium' };
  }

  function sprintHeaderCells(range) {
    const marks = [];
    for (let index = 0; index < range.days; index += 1) {
      let day = addIsoDays(range.start, index);
      if (range.mode === 'monthly') {
        const monthDate = isoDayStamp(range.start);
        monthDate.setMonth(monthDate.getMonth() + index, 1);
        day = localDateIso(monthDate);
      } else if (range.mode === 'weekly') {
        day = addIsoDays(range.start, index * 7);
      }
      const date = isoDayStamp(day);
      const showEvery = range.mode === 'daily'
        ? Math.max(7, Math.ceil(range.days / 4))
        : range.mode === 'weekly'
          ? Math.max(1, Math.ceil(range.days / 6))
          : 1;
      const showLabel = index === 0 || index === range.days - 1 || index % showEvery === 0;
      if (!showLabel) continue;
      const todayBucket = sprintBucketIndex(todayIso(), range);
      const isToday = todayBucket === index + 1;
      const label = sprintBucketLabel(index, range);
      marks.push(`
        <div
          class="project-sprint-axis-mark ${isToday ? 'is-today' : ''}"
          style="grid-column:${index + 1}"
          ${isToday ? 'data-sprint-today="true"' : ''}
        >
          ${escapeHtml(label)}
        </div>
      `);
    }
    return marks.join('');
  }

  function focusProjectSprintToday() {
    const scrollHost = DOM.drawer.querySelector('.project-sprint-scroll');
    const todayCell = DOM.drawer.querySelector('[data-sprint-today="true"]');
    const daysHead = DOM.drawer.querySelector('.project-sprint-grid-days');
    if (!scrollHost || !todayCell || !daysHead) return;
    const nextLeft = Math.max(0, todayCell.offsetLeft - daysHead.offsetLeft - 24);
    scrollHost.scrollLeft = nextLeft;
  }

  function sprintDurationDays(entry) {
    const start = entry.startDate || entry.dueDate;
    const end = entry.dueDate || entry.startDate;
    if (!start || !end) return '-';
    return String(Math.max(1, diffDay(start, end) + 1));
  }

  function sprintAssigneeSummary(entry) {
    const users = (entry.assigneeIds || []).map((id) => getUser(id)).filter(Boolean);
    if (!users.length) return '<span class="muted">Unassigned</span>';
    const label = users.slice(0, 2).map((user) => escapeHtml(user.nick || user.name || 'User')).join(', ');
    const extra = users.length > 2 ? ` +${users.length - 2}` : '';
    return `${label}${extra}`;
  }

  function renderSprintTrack(entry, range, color) {
    const hasTimeline = entry.startDate || entry.dueDate;
    if (!hasTimeline) {
      return `
        <div class="project-sprint-track project-sprint-track-ref" style="--days:${range.days}">
          <div class="project-sprint-no-date">No timeline</div>
        </div>
      `;
    }
    const startDate = entry.startDate || entry.dueDate || range.start;
    const dueDate = entry.dueDate || entry.startDate || startDate;
    const startIndex = clamp(sprintBucketIndex(startDate, range), 1, range.days);
    const endIndex = clamp(sprintBucketIndex(dueDate, range), startIndex, range.days);
    return `
      <div class="project-sprint-track project-sprint-track-ref" style="--days:${range.days}">
        <div class="project-sprint-bar-wrap" style="grid-column:${startIndex} / ${endIndex + 1}">
          <span class="project-sprint-bar ${entry.isSubtask ? 'is-subtask' : ''}" style="background:${color}"></span>
        </div>
      </div>
    `;
  }

  function renderSprintRow(entry, range, theme, nodeCountLabel) {
    const complexity = sprintComplexity(entry);
    const editTask = entry.isSubtask ? getTask(entry.parentTaskId) : getTask(entry.sourceId);
    const canEdit = !!editTask && canEditTask(editTask);
    const editButton = !canEdit
      ? ''
      : entry.isSubtask
        ? `<button class="project-sprint-edit" type="button" data-action="open-modal" data-entity="subtask" data-id="${entry.sourceId}" data-context="${entry.parentTaskId}">Edit</button>`
        : `<button class="project-sprint-edit" type="button" data-action="open-modal" data-entity="task" data-id="${entry.sourceId}">Edit</button>`;
    return `
      <div class="project-sprint-ref-row ${entry.isSubtask ? 'is-subtask' : ''}">
        <div class="project-sprint-ref-title">
          <div class="row-between">
            <strong>${escapeHtml(entry.title)}</strong>
            <span class="project-sprint-row-actions">${editButton}</span>
          </div>
          <div class="project-sprint-ref-meta">
            <span>${escapeHtml(nodeCountLabel)}</span>
            <span>${sprintAssigneeSummary(entry)}</span>
          </div>
        </div>
        <div class="project-sprint-ref-complexity">
          <span class="project-sprint-complexity ${complexity.className}">${complexity.label}</span>
        </div>
        <div class="project-sprint-ref-days">${sprintDurationDays(entry)}</div>
        ${renderSprintTrack(entry, range, theme.color)}
      </div>
    `;
  }

  function renderSprintGroup(group, range, theme, phaseIndex) {
    const sectionEntries = [group.task].concat(group.children || []);
    const doneCount = sectionEntries.filter((entry) => normalizeWorkflowStatus(entry.status) === 'approve').length;
    const avgProgress = Math.round(sectionEntries.reduce((sum, entry) => sum + (entry.isSubtask ? subtaskProgress(entry) : taskProgress(entry)), 0) / Math.max(1, sectionEntries.length));
    return `
      <section class="project-sprint-phase-block" style="--section-color:${theme.color}">
        <div class="project-sprint-phase-head">
          <div class="project-sprint-phase-title">
            <i style="background:${theme.color}"></i>
            <span>${escapeHtml(`${theme.label} - ${group.task.title}`)}</span>
          </div>
          <div class="project-sprint-phase-summary">
            <span>${sectionEntries.length} items</span>
            <span>${doneCount}/${sectionEntries.length} approved</span>
            <span>${avgProgress}% progress</span>
          </div>
        </div>
        <div class="project-sprint-phase-body">
          ${renderSprintRow(group.task, range, theme, `${Math.max(1, (group.children || []).length + 1)} nodes`)}
          ${(group.children || []).map((entry) => renderSprintRow(entry, range, theme, '1 node')).join('')}
        </div>
      </section>
    `;
  }

  function renderProjectSprintChart(project) {
    const groups = sprintEntriesForProject(project.id);
    const range = getProjectSprintRange(groups, project.deadline || todayIso(), project.startDate || '');
    const todayRatio = sprintTodayRatio(range);
    if (!groups.length) {
      return '<div class="empty-copy">No project task or subtask yet</div>';
    }
    const themedGroups = groups.map((group, index) => ({
      ...group,
      theme: sprintPhaseTheme(index),
      phaseIndex: index,
    }));
    return `
      <div class="project-sprint-shell">
        <div class="project-sprint-head">
          <div>
            <h4>Sprint timeline</h4>
            <div class="muted">Roadmap overview with grouped execution phases (${range.mode === 'daily' ? 'current focus' : range.mode === 'weekly' ? 'weekly scale' : 'monthly scale'})</div>
          </div>
          <div class="row-meta">
            <span>${formatShortDate(range.start)}</span>
            <span>to</span>
            <span>${formatShortDate(range.end)}</span>
          </div>
        </div>
        <div class="project-sprint-legend">
          ${themedGroups.map((group) => `
            <span class="project-sprint-legend-item" style="--legend:${group.theme.color}">
              <i></i>${escapeHtml(group.theme.label)} - ${escapeHtml(group.task.title)}
            </span>
          `).join('')}
        </div>
        <div class="project-sprint-scroll">
          <div class="project-sprint-grid project-sprint-grid-ref">
            ${todayRatio === null ? '' : `<span class="timeline-today-line timeline-today-line-project" ${timelineLineStyle(todayRatio, 'var(--project-sprint-track-offset)')}></span>`}
            <div class="project-sprint-grid-head project-sprint-grid-head-ref">
              <div class="project-sprint-grid-title">Feature / Task</div>
              <div class="project-sprint-grid-title">Priority</div>
              <div class="project-sprint-grid-title">Days</div>
              <div class="project-sprint-grid-days project-sprint-grid-days-ref" style="--days:${range.days}">
                ${sprintHeaderCells(range)}
              </div>
            </div>
            <div class="project-sprint-grid-body project-sprint-grid-body-ref">
              ${themedGroups.map((group) => renderSprintGroup(group, range, group.theme, group.phaseIndex)).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function projectTasks(projectId) {
    return state.data.tasks.filter((task) => task.projectId === projectId);
  }

  function taskToWorkItem(task) {
    return {
      id: `task:${task.id}`,
      sourceId: task.id,
      sourceType: 'task',
      openAction: 'task-open',
      title: task.title,
      description: task.description,
      projectId: task.projectId || '',
      departmentId: task.departmentId,
      createdBy: task.createdBy,
      assigneeIds: task.assigneeIds || [],
      status: normalizeWorkflowStatus(task.status),
      priority: task.priority,
      progress: taskProgress(task),
      startDate: task.startDate || '',
      dueDate: task.dueDate || '',
      createdAt: task.createdAt || task.activity?.[0]?.createdAt || '',
      activity: task.activity || [],
      linkedTaskId: null,
      originLabel: 'Task',
      color: getProject(task.projectId)?.color || '#6d28d9',
      subtasks: (task.subtasks || []).map(normalizeSubtask),
      parentTaskId: task.parentTaskId || null,
    };
  }

  function briefToWorkItem(brief) {
    return {
      id: `brief:${brief.id}`,
      sourceId: brief.id,
      sourceType: 'brief',
      openAction: 'brief-open',
      title: brief.title,
      description: brief.body,
      projectId: brief.projectId || '',
      departmentId: brief.departmentId,
      createdBy: brief.createdBy,
      assigneeIds: brief.assigneeIds || [],
      status: normalizeWorkflowStatus(brief.status),
      priority: brief.priority,
      progress: taskProgress(brief),
      startDate: brief.startDate || brief.createdAt?.slice(0, 10) || '',
      dueDate: brief.dueDate || '',
      createdAt: brief.createdAt || '',
      activity: [],
      linkedTaskId: brief.linkedTaskId || null,
      originLabel: 'CEO Brief',
      color: getProject(brief.projectId)?.color || '#22c55e',
    };
  }

  function getVisibleWorkItems(user = currentUser()) {
    const taskItems = getVisibleTasks(user).map(taskToWorkItem);
    const briefItems = getVisibleBriefs(user)
      .filter((brief) => !brief.linkedTaskId || !getTask(brief.linkedTaskId))
      .map(briefToWorkItem);
    return [...taskItems, ...briefItems]
      .sort(compareWorkItems);
  }

  function projectWorkItems(projectId, user = currentUser()) {
    return getVisibleWorkItems(user).filter((item) => item.projectId === projectId);
  }

  function projectProgress(projectId) {
    const items = projectWorkItems(projectId);
    if (!items.length) return 0;
    const total = items.reduce((sum, item) => sum + taskProgress(item), 0);
    return Math.round(total / items.length);
  }

  function projectPhaseSummaries(projectId) {
    return sprintEntriesForProject(projectId).map((group, index) => {
      const theme = sprintPhaseTheme(index);
      const entries = [group.task].concat(group.children || []);
      const taskCount = entries.length;
      const doneCount = entries.filter((entry) => normalizeWorkflowStatus(entry.status) === 'approve').length;
      const progress = Math.round(entries.reduce((sum, entry) => sum + (entry.isSubtask ? subtaskProgress(entry) : taskProgress(entry)), 0) / Math.max(1, taskCount));
      return {
        id: group.id,
        name: group.task.title,
        theme,
        taskCount,
        doneCount,
        progress,
      };
    });
  }

  function renderProjectPhaseCards(project) {
    const phases = projectPhaseSummaries(project.id);
    if (!phases.length) {
      return '<div class="empty-copy">No phase progress yet</div>';
    }
    return `
      <section class="card project-phase-card-panel">
        <div class="card-header">
          <div>
            <h3 class="card-title">Progress by phase</h3>
            <div class="card-subtitle">phase-level delivery snapshot for this project</div>
          </div>
        </div>
        <div class="project-phase-grid">
          ${phases.map((phase) => `
            <article class="project-phase-card" style="--phase-color:${phase.theme.color};--phase-bg:${hexToAlpha(phase.theme.color, 0.09)};border-color:${hexToAlpha(phase.theme.color, 0.22)}">
              <div class="row-between">
                <strong>${escapeHtml(phase.name)}</strong>
                <span>${phase.taskCount} item(s)</span>
              </div>
              <div class="project-phase-metrics">
                <span class="project-phase-percent">${phase.progress}%</span>
                <span>${phase.doneCount}/${phase.taskCount} approved</span>
              </div>
              <div class="progress compact"><span style="width:${phase.progress}%;background:${phase.theme.color}"></span></div>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function projectTaskListRows(projectId) {
    return sprintEntriesForProject(projectId).flatMap((group, index) => {
      const theme = sprintPhaseTheme(index);
      return [
        {
          type: 'task',
          entry: group.task,
          phaseLabel: theme.label,
          phaseColor: theme.color,
        },
        ...(group.children || []).map((entry) => ({
          type: 'subtask',
          entry,
          phaseLabel: theme.label,
          phaseColor: theme.color,
        })),
      ];
    });
  }

  function renderProjectTaskList(project) {
    const rows = projectTaskListRows(project.id);
    if (!rows.length) {
      return '<div class="empty-copy">No project task list yet</div>';
    }
    return `
      <section class="card project-task-table-panel">
        <div class="card-header">
          <div>
            <h3 class="card-title">Task list</h3>
            <div class="card-subtitle">easy list view for project tasks and subtasks</div>
          </div>
        </div>
        <div class="project-task-table-wrap">
          <table class="project-task-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Assignee</th>
                <th>Phase</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Deadline</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(({ entry, type, phaseLabel, phaseColor }) => {
                const task = type === 'subtask' ? getTask(entry.parentTaskId) : getTask(entry.sourceId);
                const canEdit = !!task && canEditTask(task);
                const progress = type === 'subtask' ? subtaskProgress(entry) : taskProgress(entry);
                const compactPhaseLabel = phaseLabel.replace('Phase ', 'P');
                const targetType = type === 'subtask' ? 'subtask' : 'task';
                const targetId = entry.sourceId;
                const commentPreview = task
                  ? `
                    <tr class="project-task-comment-row">
                      <td colspan="7">
                        ${renderInlineCommentPanel(task, targetType, targetId)}
                      </td>
                    </tr>
                  `
                  : '';
                const editButton = !canEdit
                  ? ''
                  : type === 'subtask'
                    ? `<button class="ghost-button compact-button" type="button" data-action="open-modal" data-entity="subtask" data-id="${entry.sourceId}" data-context="${entry.parentTaskId}">Edit</button>`
                    : `<button class="ghost-button compact-button" type="button" data-action="open-modal" data-entity="task" data-id="${entry.sourceId}">Edit</button>`;
                const isComplete = isCompleteStatus(entry.status);
                return `
                  <tr class="${type === 'subtask' ? 'is-subtask' : ''} is-commentable${isComplete ? ' is-complete' : ''}" data-action="comment-open" data-task-id="${task?.id || ''}" data-target-type="${targetType}" data-target-id="${targetId}">
                    <td>
                      <div class="project-task-cell-title">
                        <strong>${escapeHtml(entry.title)}</strong>
                        <span>${type === 'subtask' ? `Under ${escapeHtml(entry.parentTitle)}` : (entry.description ? escapeHtml(entry.description.slice(0, 72)) : 'Main task')}</span>
                      </div>
                    </td>
                    <td>${sprintAssigneeSummary(entry)}</td>
                    <td><span class="tag-chip" style="background:${hexToAlpha(phaseColor, 0.12)};color:${phaseColor};border-color:${hexToAlpha(phaseColor, 0.24)}">${escapeHtml(compactPhaseLabel)}</span></td>
                    <td>${statusChip(entry.status)}</td>
                    <td>
                      <div class="project-task-progress-cell">
                        <div class="progress compact"><span style="width:${progress}%;background:${phaseColor}"></span></div>
                        <span>${progress}%</span>
                      </div>
                    </td>
                    <td>${formatDate(entry.dueDate || entry.startDate)}</td>
                    <td>
                      ${editButton}
                    </td>
                  </tr>
                  ${commentPreview}
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function createNotification(userId, type, title, body, refType, refId) {
    if (!userId) return;
    state.data.notifications.unshift({
      id: uid('n'),
      userId,
      type,
      title,
      body,
      refType: refType || null,
      refId: refId || null,
      createdAt: nowIso(),
      readAt: null,
    });
  }

  function logTaskActivity(task, action) {
    task.activity = task.activity || [];
    task.activity.unshift({
      id: uid('a'),
      actorId: currentUser()?.id || null,
      action,
      createdAt: nowIso(),
    });
  }

  function saveSnapshot() {
    writeLocal(storageKeys.snapshot, state.data);
  }

  function saveSession(userId) {
    state.currentUserId = userId;
    sessionStorage.setItem(storageKeys.session, JSON.stringify({ currentUserId: userId }));
  }

  function clearSession() {
    state.currentUserId = null;
    localStorage.removeItem(storageKeys.session);
    sessionStorage.removeItem(storageKeys.session);
  }

  function restoreSession() {
    const saved = (() => {
      try {
        return JSON.parse(sessionStorage.getItem(storageKeys.session));
      } catch (error) {
        return null;
      }
    })();
    if (!saved?.currentUserId) return false;
    if (!getUser(saved.currentUserId)) return false;
    state.currentUserId = saved.currentUserId;
    return true;
  }

  const adapter = {
    headers(extra) {
      return Object.assign({
        apikey: Config.supabase.anonKey,
        Authorization: `Bearer ${Config.supabase.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }, extra || {});
    },
    async get(table, query) {
      const response = await fetch(`${Config.supabase.baseUrl}/${table}${query || ''}`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    async upsert(table, record) {
      const response = await fetch(`${Config.supabase.baseUrl}/${table}?on_conflict=id`, {
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify(record),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} upsert failed (${response.status}): ${body}`);
      }
      return response.json();
    },
    async patch(table, filter, record) {
      const response = await fetch(`${Config.supabase.baseUrl}/${table}?${filter}`, {
        method: 'PATCH',
        headers: this.headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(record),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} patch failed (${response.status}): ${body}`);
      }
      return response.json();
    },
    async remove(table, filter) {
      const response = await fetch(`${Config.supabase.baseUrl}/${table}?${filter}`, {
        method: 'DELETE',
        headers: this.headers({ Prefer: 'return=minimal' }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} delete failed (${response.status}): ${body}`);
      }
    },
    async loadAll(fallbackData = emptyData()) {
      if (!Config.supabase.enabled) {
        return { ok: false, reason: 'Supabase disabled' };
      }

      const jobs = await Promise.allSettled([
        this.get('departments', '?select=*'),
        this.get('users', '?select=*'),
        this.get('projects', '?select=*'),
        this.get('tasks', '?select=*'),
        this.get('meetings', '?select=*'),
        this.get('ceo_briefs', '?select=*'),
        this.get('notifications', '?select=*'),
      ]);

      const [departments, users, projects, tasks, meetings, briefs, notifications] = jobs.map((job) => (
        job.status === 'fulfilled' ? job.value : []
      ));

      const anySuccess = jobs.some((job) => job.status === 'fulfilled');
      if (!anySuccess) {
        return { ok: false, reason: 'Remote load failed' };
      }

      const payload = {
        departments: jobs[0].status === 'fulfilled' ? departments.map(mapDepartment).filter(Boolean) : (fallbackData.departments || []),
        users: jobs[1].status === 'fulfilled' ? users.map(mapUser).filter(Boolean) : (fallbackData.users || []),
        projects: jobs[2].status === 'fulfilled' ? projects.map(mapProject).filter(Boolean) : (fallbackData.projects || []),
        tasks: jobs[3].status === 'fulfilled' ? tasks.map(mapTask).filter(Boolean) : (fallbackData.tasks || []),
        meetings: jobs[4].status === 'fulfilled' ? meetings.map(mapMeeting).filter(Boolean) : (fallbackData.meetings || []),
        briefs: jobs[5].status === 'fulfilled' ? briefs.map(mapBrief).filter(Boolean) : (fallbackData.briefs || []),
        notifications: jobs[6].status === 'fulfilled' ? notifications.map(mapNotification).filter(Boolean) : (fallbackData.notifications || []),
      };

      return {
        ok: true,
        partial: jobs.some((job) => job.status !== 'fulfilled'),
        payload,
      };
    },
  };

  function remoteProjectRow(project) {
    return {
      id: project.id,
      name: project.name,
      description: project.description || '',
      dept: project.departmentId,
      department_id: project.departmentId,
      start_date: project.startDate || null,
      deadline: project.deadline || null,
      due_date: project.deadline || null,
      color: project.color,
      members: JSON.stringify(project.memberIds || []),
      member_ids: project.memberIds || [],
      status: project.status || 'active',
      created_by: project.ownerId,
      owner_id: project.ownerId,
      is_secret: !!project.isSecret,
      attachments: JSON.stringify(project.attachments || []),
      created_at: project.createdAt || nowIso(),
    };
  }

  function remoteDepartmentRow(department) {
    return {
      id: department.remoteId || department.id,
      name: department.name,
      color: department.color || '#64748b',
      sort_order: Number(department.order || 0),
      created_at: department.createdAt || nowIso(),
    };
  }

  function remoteDepartmentPatchRow(department) {
    return {
      name: department.name,
      color: department.color || '#64748b',
      sort_order: Number(department.order || 0),
      created_at: department.createdAt || nowIso(),
    };
  }

  function remoteTaskRow(task) {
    const normalizedStatus = normalizeWorkflowStatus(task.status);
    return {
      id: task.id,
      title: task.title,
      description: task.description || '',
      tag: task.projectId ? 'Project Task' : 'Task',
      dept: task.departmentId,
      department_id: task.departmentId,
      tag_clr: getDepartment(task.departmentId)?.color || '#6d28d9',
      prio: task.priority || 'medium',
      priority: task.priority || 'medium',
      status: normalizedStatus,
      due: task.dueDate || null,
      due_date: task.dueDate || null,
      start_date: task.startDate || null,
      progress: task.progress || 0,
      assignees: JSON.stringify(task.assigneeIds || []),
      assignee_ids: task.assigneeIds || [],
      subtasks: JSON.stringify(task.subtasks || []),
      comments: JSON.stringify(task.comments || []),
      attachments: JSON.stringify(task.attachments || []),
      tl: JSON.stringify(task.activity || []),
      activity: task.activity || [],
      project: task.projectId || null,
      project_id: task.projectId || null,
      created_by: task.createdBy,
      creator_id: task.createdBy,
      parent_task_id: task.parentTaskId || null,
      source_type: task.sourceType || 'task',
      source_ref_id: task.sourceRefId || null,
      linked_brief_id: task.linkedBriefId || null,
      created_at: task.createdAt || nowIso(),
    };
  }

  function remoteMeetingRow(meeting) {
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description || '',
      start_at: meeting.startAt || null,
      end_at: meeting.endAt || null,
      location: meeting.location || '',
      dept: meeting.departmentId,
      department_id: meeting.departmentId,
      attendees: JSON.stringify(meeting.attendeeIds || []),
      attendee_ids: meeting.attendeeIds || [],
      notes: meeting.notes || '',
      attachments: JSON.stringify(meeting.attachments || []),
      created_by: meeting.createdBy,
      creator_id: meeting.createdBy,
      created_at: meeting.createdAt || nowIso(),
    };
  }

  function remoteBriefRow(brief) {
    const normalizedStatus = normalizeWorkflowStatus(brief.status);
    return {
      id: brief.id,
      title: brief.title,
      description: brief.body || '',
      body: brief.body || '',
      prio: brief.priority || 'medium',
      priority: brief.priority || 'medium',
      dept: brief.departmentId,
      department_id: brief.departmentId,
      start_date: brief.startDate || null,
      due: brief.dueDate || null,
      due_date: brief.dueDate || null,
      status: normalizedStatus,
      progress: brief.progress || 0,
      assignees: JSON.stringify(brief.assigneeIds || []),
      assignee_ids: brief.assigneeIds || [],
      attachments: JSON.stringify(brief.attachments || []),
      tl: JSON.stringify(brief.activity || []),
      project: brief.projectId || null,
      project_id: brief.projectId || null,
      created_by: brief.createdBy,
      creator_id: brief.createdBy,
      linked_task_id: brief.linkedTaskId || null,
      created_at: brief.createdAt || nowIso(),
    };
  }

  function remoteUserRow(user) {
    const access = normalizeAccess(user.access || 'member');
    return {
      id: user.id,
      name: user.name,
      nick: user.nick,
      email: user.email || null,
      role: user.roleTitle,
      role_title: user.roleTitle,
      dept: user.departmentId,
      department_id: user.departmentId,
      level: user.levelTitle,
      access: access,
      color: user.color,
      av: getUserInitials(user),
      status: user.status,
      pass: user.password,
      level_rank: roleRank(access),
      is_active: user.status !== 'offline',
      created_at: user.createdAt || nowIso(),
    };
  }

  function queueRemoteUpsertLegacy(kind, record) {
    if (!Config.supabase.enabled) return;
    let table = null;
    let payload = null;

    if (kind === 'department') { table = 'departments'; payload = remoteDepartmentRow(record); }
    if (kind === 'task') { table = 'tasks'; payload = remoteTaskRow(record); }
    if (kind === 'project') { table = 'projects'; payload = remoteProjectRow(record); }
    if (kind === 'meeting') { table = 'meetings'; payload = remoteMeetingRow(record); }
    if (kind === 'brief') { table = 'ceo_briefs'; payload = remoteBriefRow(record); }
    if (kind === 'user') { table = 'users'; payload = remoteUserRow(record); }
    if (!table || !payload) return;

    adapter.upsert(table, payload).catch((error) => {
      console.warn(`Remote sync failed for ${kind}`, error);
    });
  }

  function queueRemoteDelete(kind, id) {
    if (!Config.supabase.enabled || !id) return;
    const table = {
      department: 'departments',
      task: 'tasks',
      project: 'projects',
      meeting: 'meetings',
      brief: 'ceo_briefs',
      user: 'users',
    }[kind];
    if (!table) return;
    adapter.remove(table, `id=eq.${encodeURIComponent(id)}`).catch((error) => {
      console.warn(`Remote delete failed for ${kind}`, error);
      showToast('Delete failed', `${kind} could not be deleted from database`);
    });
  }

  function mapDepartment(row) {
    if (!row) return null;
    return {
      id: row.id,
      remoteId: row.id,
      name: row.name,
      color: row.color || '#6d28d9',
      order: row.sort_order || row.order || 999,
    };
  }

  function mapUser(row) {
    if (!row?.id) return null;
    const inferredAccess = inferAccessFromRow(row);
    return {
      id: row.id,
      name: row.name || row.nick || row.email || row.id,
      nick: row.nick || row.name || row.id,
      email: row.email || '',
      password: row.pass || row.password || '1234',
      access: inferredAccess,
      roleTitle: row.role || row.role_title || 'Team Member',
      departmentId: row.department_id || row.dept || 'ceo',
      levelTitle: row.level || row.level_title || Config.roles[inferredAccess].label,
      status: row.status || 'offline',
      color: row.color || '#6d28d9',
      createdAt: row.created_at || row.createdAt || '',
    };
  }

  function mapProject(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      name: row.name || 'Untitled project',
      description: row.description || row.desc || '',
      color: row.color || '#6d28d9',
      departmentId: row.department_id || row.dept || 'ceo',
      ownerId: row.owner_id || row.created_by || row.createdBy || null,
      memberIds: toArray(row.member_ids || row.members || row.memberIds),
      attachments: toObjectArray(row.attachments),
      isSecret: !!(row.is_secret || row.isSecret),
      status: row.status || 'active',
      startDate: row.start_date || row.startDate || '',
      deadline: row.deadline || row.due_date || '',
      createdAt: row.created_at || row.createdAt || '',
    };
  }

  function mapTask(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      title: row.title || 'Untitled task',
      description: row.description || row.desc || '',
      projectId: row.project_id || row.projectId || '',
      departmentId: row.department_id || row.dept || 'ceo',
      createdBy: row.creator_id || row.created_by || row.createdBy || null,
      assigneeIds: toArray(row.assignee_ids || row.assignees || row.assigneeIds),
      status: mapStatus(row.status),
      priority: row.priority || row.prio || 'medium',
      progress: Number(row.progress || 0),
      startDate: row.start_date || row.start || '',
      dueDate: row.due_date || row.due || '',
      parentTaskId: row.parent_task_id || row.parentTaskId || null,
      subtasks: toObjectArray(row.subtasks),
      comments: toObjectArray(row.comments),
      attachments: toObjectArray(row.attachments),
      activity: toObjectArray(row.tl || row.activity),
      linkedBriefId: row.linked_brief_id || row.linkedBriefId || null,
      sourceType: row.source_type || row.sourceType || 'task',
      sourceRefId: row.source_ref_id || row.sourceRefId || null,
      createdAt: row.created_at || row.createdAt || '',
    };
  }

  function mapMeeting(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      title: row.title || 'Untitled meeting',
      description: row.description || row.body || '',
      startAt: row.start_at || row.start_time || row.start || row.startAt || '',
      endAt: row.end_at || row.end_time || row.end || row.endAt || '',
      location: row.location || row.loc || '',
      departmentId: row.department_id || row.dept || 'ceo',
      attendeeIds: toArray(row.attendee_ids || row.attendees || row.attendeeIds),
      notes: row.notes || '',
      attachments: toObjectArray(row.attachments),
      createdBy: row.creator_id || row.created_by || row.createdBy || null,
      createdAt: row.created_at || row.createdAt || '',
    };
  }

  function mapBrief(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      title: row.title || 'Untitled brief',
      body: row.body || row.description || row.desc || '',
      priority: row.priority || row.prio || 'medium',
      departmentId: row.department_id || row.dept || 'ceo',
      dueDate: row.due_date || row.due || '',
      startDate: row.start_date || row.start || '',
      status: mapStatus(row.status || 'draft'),
      progress: Number(row.progress || 0),
      createdBy: row.creator_id || row.created_by || row.createdBy || null,
      assigneeIds: toArray(row.assignee_ids || row.assignees || row.assigneeIds),
      projectId: row.project_id || row.projectId || '',
      linkedTaskId: row.linked_task_id || row.linkedTaskId || null,
      attachments: toObjectArray(row.attachments),
      createdAt: row.created_at || row.createdAt || '',
    };
  }

  function mapNotification(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      icon: row.icon || '',
      type: row.type || 'general',
      title: row.title || 'Notification',
      body: row.body || '',
      time: row.time || '',
      userId: row.user_id || row.userId || null,
      refType: row.ref_type || row.refType || null,
      refId: row.ref_id || row.refId || null,
      createdAt: row.created_at || row.createdAt || nowIso(),
      readAt: row.read_at || row.readAt || (row.unread === false ? row.created_at || nowIso() : null),
    };
  }

  function normalizeAccess(access) {
    if (access === 'manager') return 'head';
    return Config.roles[access] ? access : 'member';
  }

  function inferAccessFromRow(row) {
    const hints = normalizeText([
      row?.access,
      row?.access_level,
      row?.role,
      row?.role_title,
      row?.level,
      row?.level_title,
    ].filter(Boolean).join(' '));

    if (hints.includes('admin')) return 'admin';
    if (hints.includes('ceo')) return 'ceo';
    if (hints.includes('executive')) return 'executive';
    if (hints.includes('head')) return 'head';
    return normalizeAccess(row?.access || row?.access_level || 'member');
  }

  function mapStatus(status) {
    return normalizeWorkflowStatus(status);
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  function toObjectArray(value) {
    const array = toArray(value);
    return array.map((item) => (typeof item === 'object' ? item : null)).filter(Boolean);
  }

  function sanitizeData(data) {
    const sourceDepartments = data.departments || [];
    const departmentAliasMap = new Map();
    const departmentsByCanonical = new Map();

    sourceDepartments.forEach((department, index) => {
      const canonicalName = canonicalDepartmentName(department.name || department.id);
      const canonicalId = canonicalDepartmentId(canonicalName);
      const normalized = {
        id: canonicalId,
        remoteId: department.id || canonicalId,
        name: canonicalName,
        color: department.color || '#64748b',
        order: department.order || department.sort_order || index + 1,
      };
      const existing = departmentsByCanonical.get(canonicalId);
      const prefersNormalized = !existing
        || (existing.remoteId !== canonicalId && normalized.remoteId === canonicalId)
        || (normalizeText(existing.name) !== normalizeText(canonicalName) && normalizeText(normalized.name) === normalizeText(canonicalName));
      if (prefersNormalized) {
        departmentsByCanonical.set(canonicalId, normalized);
      }
      [department.id, department.name, canonicalName].filter(Boolean).forEach((alias) => {
        departmentAliasMap.set(String(alias), canonicalId);
      });
    });

    const normalizeDepartmentRef = (value) => {
      if (!value) return departmentsByCanonical.keys().next().value || canonicalDepartmentId('General');
      return departmentAliasMap.get(String(value)) || canonicalDepartmentId(value);
    };

    const users = Array.from(new Map((data.users || []).map((user) => {
      const normalizedDepartmentId = normalizeDepartmentRef(user.departmentId || user.dept);
      return [user.id, {
        ...user,
        access: normalizeAccess(user.access),
        departmentId: normalizedDepartmentId,
        dept: normalizedDepartmentId,
      }];
    })).values());

    const userAliasMap = new Map();
    users.forEach((user) => {
      [user.id, user.nick, user.name, user.email]
        .filter(Boolean)
        .forEach((alias) => userAliasMap.set(normalizeText(alias), user.id));
    });

    const normalizeUserRef = (value) => {
      if (!value) return null;
      if (Array.isArray(value)) {
        return value.map(normalizeUserRef).filter(Boolean);
      }
      return userAliasMap.get(normalizeText(value)) || value;
    };

    const projectRemap = new Map();
    const projectsBySignature = new Map();
    (data.projects || []).forEach((project) => {
      const normalizedDepartmentId = normalizeDepartmentRef(project.departmentId || project.dept);
      const normalized = {
        ...project,
        departmentId: normalizedDepartmentId,
        dept: normalizedDepartmentId,
        ownerId: normalizeUserRef(project.ownerId),
        memberIds: Array.from(new Set(normalizeUserRef(project.memberIds || []).filter((id) => users.some((user) => user.id === id)))),
        isSecret: !!project.isSecret,
      };
      const signature = `${normalizeText(normalized.name)}|${normalized.departmentId}`;
      const current = projectsBySignature.get(signature);
      const score = (item) => ((item.description || '').length) + ((item.memberIds || []).length * 5) + (item.deadline ? 3 : 0) + (item.isSecret ? 2 : 0);
      if (!current || score(normalized) >= score(current)) {
        if (current?.id) projectRemap.set(current.id, normalized.id);
        projectsBySignature.set(signature, normalized);
      } else {
        projectRemap.set(normalized.id, current.id);
      }
    });
    const projects = Array.from(projectsBySignature.values());

    const tasksBySignature = new Map();
    (data.tasks || []).forEach((task) => {
      const normalizedDepartmentId = normalizeDepartmentRef(task.departmentId || task.dept);
      const normalized = {
        ...task,
        departmentId: normalizedDepartmentId,
        dept: normalizedDepartmentId,
        projectId: projectRemap.get(task.projectId) || task.projectId,
        createdBy: normalizeUserRef(task.createdBy),
        assigneeIds: Array.from(new Set(normalizeUserRef(task.assigneeIds || []).filter((id) => users.some((user) => user.id === id)))),
      };
      const signature = `${normalizeText(normalized.title)}|${normalized.projectId || 'none'}|${normalized.dueDate || ''}|${normalized.createdBy || ''}`;
      if (!tasksBySignature.has(signature)) {
        tasksBySignature.set(signature, normalized);
      }
    });
    const tasks = Array.from(tasksBySignature.values());

    const meetings = Array.from(new Map((data.meetings || []).map((meeting) => {
      const normalizedDepartmentId = normalizeDepartmentRef(meeting.departmentId || meeting.dept);
      return [meeting.id, {
        ...meeting,
        departmentId: normalizedDepartmentId,
        dept: normalizedDepartmentId,
        createdBy: normalizeUserRef(meeting.createdBy),
        attendeeIds: Array.from(new Set(normalizeUserRef(meeting.attendeeIds || []).filter((id) => users.some((user) => user.id === id)))),
      }];
    })).values());

    const briefs = Array.from(new Map((data.briefs || []).map((brief) => {
      const normalizedDepartmentId = normalizeDepartmentRef(brief.departmentId || brief.dept);
      return [brief.id, {
        ...brief,
        departmentId: normalizedDepartmentId,
        dept: normalizedDepartmentId,
        projectId: projectRemap.get(brief.projectId) || brief.projectId,
        createdBy: normalizeUserRef(brief.createdBy),
        assigneeIds: Array.from(new Set(normalizeUserRef(brief.assigneeIds || []).filter((id) => users.some((user) => user.id === id)))),
      }];
    })).values());

    const notifications = Array.from(new Map((data.notifications || []).map((notification) => [notification.id, {
      ...notification,
      userId: normalizeUserRef(notification.userId),
    }])).values())
      .filter((notification) => !notification.userId || users.some((user) => user.id === notification.userId));

    return {
      departments: Array.from(departmentsByCanonical.values()).sort((a, b) => a.order - b.order),
      users,
      projects,
      tasks,
      meetings,
      briefs,
      notifications,
    };
  }

  function selectRemoteOrLocal(localList, remoteList) {
    return (remoteList || []).length ? remoteList : (localList || []);
  }

  async function bootstrap() {
    purgeMockCache();
    const snapshot = readLocal(storageKeys.snapshot);
    if (snapshot?.users?.length) {
      state.data = sanitizeData(snapshot);
      state.dataSource = 'Local snapshot';
    }

    try {
      const remote = await adapter.loadAll(state.data);
      if (remote.ok) {
        state.data = sanitizeData(remote.payload);
        state.dataSource = remote.partial ? 'Supabase database (partial fallback)' : 'Supabase database';
        saveSnapshot();
      }
    } catch (error) {
      console.warn('Supabase load skipped', error);
    }

    state.data = sanitizeData(state.data);
  }

  function syncStatusBanner() {
    DOM.dataSourceStatus.textContent = state.dataSource;
  }

  // ── System Log ──────────────────────────────────────────────────────
  // Writes to Supabase `system_logs` table. Admin-only read. 7-day auto-cleanup.
  async function writeSystemLog(action, details = {}) {
    try {
      const actor = currentUser();
      const entry = {
        id: uid('log'),
        user_id: actor?.id || null,
        user_nick: actor?.nick || 'system',
        action,
        details: JSON.stringify(details),
        created_at: nowIso(),
      };
      await fetch(`${Config.supabaseUrl}/rest/v1/system_logs`, {
        method: 'POST',
        headers: {
          'apikey': Config.supabaseKey,
          'Authorization': `Bearer ${Config.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(entry),
      });
    } catch (_) { /* silent — log failures never break app */ }
  }

  async function fetchSystemLogs() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const res = await fetch(
        `${Config.supabaseUrl}/rest/v1/system_logs?created_at=gte.${sevenDaysAgo}&order=created_at.desc&limit=200`,
        { headers: { 'apikey': Config.supabaseKey, 'Authorization': `Bearer ${Config.supabaseKey}` } }
      );
      return res.ok ? await res.json() : [];
    } catch (_) { return []; }
  }

  async function purgeOldSystemLogs() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      await fetch(
        `${Config.supabaseUrl}/rest/v1/system_logs?created_at=lt.${sevenDaysAgo}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': Config.supabaseKey,
            'Authorization': `Bearer ${Config.supabaseKey}`,
          },
        }
      );
    } catch (_) { /* silent */ }
  }

  async function renderSystemLogPanel(container) {
    if (!['admin', 'ceo'].includes(currentUser()?.access)) return;
    container.innerHTML = '<div class="empty-copy">Loading system logs...</div>';
    await purgeOldSystemLogs();
    const logs = await fetchSystemLogs();
    if (!logs.length) {
      container.innerHTML = '<div class="empty-copy">No log entries in the past 7 days.</div>';
      return;
    }
    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="syslog-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((log) => `
              <tr>
                <td class="syslog-ts">${escapeHtml(formatDateTime(log.created_at))}</td>
                <td>${escapeHtml(log.user_nick || '—')}</td>
                <td><span class="syslog-action">${escapeHtml(log.action)}</span></td>
                <td class="syslog-details">${escapeHtml(log.details || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  // ────────────────────────────────────────────────────────────────────

  function showToast(title, body, options = {}) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-body">${escapeHtml(body)}</div>`;
    DOM.toastHost.classList.toggle('centered', !!options.centered);
    DOM.toastHost.appendChild(toast);
    setTimeout(() => {
      toast.remove();
      if (!DOM.toastHost.children.length) {
        DOM.toastHost.classList.remove('centered');
      }
    }, 3200);
  }

  function cacheDom() {
    Object.assign(DOM, {
      loginScreen: document.getElementById('loginScreen'),
      loginIdentifier: document.getElementById('loginIdentifier'),
      loginPassword: document.getElementById('loginPassword'),
      loginError: document.getElementById('loginError'),
      loginSubmit: document.getElementById('loginSubmit'),
      appShell: document.getElementById('appShell'),
      pageTitle: document.getElementById('pageTitle'),
      pageSubtitle: document.getElementById('pageSubtitle'),
      createPrimaryButton: document.getElementById('createPrimaryButton'),
      departmentPills: document.getElementById('departmentPills'),
      currentUserAvatar: document.getElementById('currentUserAvatar'),
      currentUserName: document.getElementById('currentUserName'),
      currentUserMeta: document.getElementById('currentUserMeta'),
      currentUserDot: document.getElementById('currentUserDot'),
      boardBadge: document.getElementById('boardBadge'),
      briefBadge: document.getElementById('briefBadge'),
      notificationBadge: document.getElementById('notificationBadge'),
      dataSourceStatus: document.getElementById('dataSourceStatus'),
      timelineWarning: document.getElementById('timelineWarning'),
      sidebar: document.getElementById('sidebar'),
      sidebarOverlay: document.getElementById('sidebarOverlay'),
      sidebarOpen: document.getElementById('sidebarOpen'),
      sidebarClose: document.getElementById('sidebarClose'),
      logoutButton: document.getElementById('logoutButton'),
      drawer: document.getElementById('drawer'),
      drawerOverlay: document.getElementById('drawerOverlay'),
      modalOverlay: document.getElementById('modalOverlay'),
      modalCard: document.getElementById('modalCard'),
      toastHost: document.getElementById('toastHost'),
      pages: {
        dashboard: document.getElementById('page-dashboard'),
        board: document.getElementById('page-board'),
        calendar: document.getElementById('page-calendar'),
        projects: document.getElementById('page-projects'),
        meetings: document.getElementById('page-meetings'),
        briefs: document.getElementById('page-briefs'),
        team: document.getElementById('page-team'),
      notifications: document.getElementById('page-notifications'),
      onlyme: document.getElementById('page-onlyme'),
      },
    });
  }

  function bindStaticEvents() {
    DOM.loginSubmit.addEventListener('click', handleLogin);
    DOM.loginIdentifier.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handleLogin();
    });
    DOM.loginPassword.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handleLogin();
    });
    DOM.logoutButton.addEventListener('click', logout);
    DOM.sidebarOpen.addEventListener('click', openSidebar);
    DOM.sidebarClose.addEventListener('click', closeSidebar);
    DOM.sidebarOverlay.addEventListener('click', closeSidebar);
    DOM.drawerOverlay.addEventListener('click', closeDrawer);
    DOM.modalOverlay.addEventListener('click', (event) => {
      if (event.target === DOM.modalOverlay) closeModal();
    });
    DOM.createPrimaryButton.addEventListener('click', handlePrimaryCreate);

    document.body.addEventListener('click', handleBodyClick);
    document.body.addEventListener('change', handleBodyChange);
    document.body.addEventListener('submit', handleBodySubmit);
  }

  function handleBodyClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'nav') {
      setActivePage(actionEl.dataset.page);
      if (window.innerWidth <= 920) closeSidebar();
      return;
    }

    if (action === 'dept-filter') {
      state.activeDepartment = actionEl.dataset.department || 'all';
      refreshApp();
      return;
    }

    if (action === 'department-health-open') {
      openDepartmentHealthDrawer(actionEl.dataset.department);
      return;
    }

    if (action === 'overdue-open') {
      openOverdueDrawer();
      return;
    }

    if (action === 'task-open') {
      openTaskDrawer(actionEl.dataset.id);
      return;
    }

    if (action === 'comment-open') {
      event.preventDefault();
      event.stopPropagation();
      openTaskCommentsDrawer(actionEl.dataset.taskId || actionEl.dataset.id, actionEl.dataset.targetType || 'task', actionEl.dataset.targetId || actionEl.dataset.taskId || actionEl.dataset.id);
      return;
    }

    if (action === 'comment-panel-toggle') {
      event.preventDefault();
      event.stopPropagation();
      handleCommentPanelToggle(actionEl);
      return;
    }

    if (action === 'comment-edit') {
      event.preventDefault();
      event.stopPropagation();
      fillCommentEditor(actionEl.dataset.taskId, actionEl.dataset.commentId, actionEl.dataset.targetType || 'task', actionEl.dataset.targetId || actionEl.dataset.taskId);
      return;
    }

    if (action === 'attachment-delete') {
      event.preventDefault();
      event.stopPropagation();
      deleteAttachment(actionEl);
      return;
    }

    if (action === 'status-cycle-task') {
      event.preventDefault();
      event.stopPropagation();
      cycleTaskStatus(actionEl.dataset.id);
      return;
    }

    if (action === 'status-cycle-subtask') {
      event.preventDefault();
      event.stopPropagation();
      cycleSubtaskStatus(actionEl.dataset.id, actionEl.dataset.subtaskId);
      return;
    }

    if (action === 'project-open') {
      openProjectDrawer(actionEl.dataset.id);
      return;
    }

    if (action === 'meeting-open') {
      openMeetingDrawer(actionEl.dataset.id);
      return;
    }

    if (action === 'brief-open') {
      openBriefDrawer(actionEl.dataset.id);
      return;
    }

    if (action === 'notification-read') {
      markNotificationRead(actionEl.dataset.id);
      return;
    }

    if (action === 'notification-open') {
      openNotificationTarget(actionEl.dataset.id);
      return;
    }

    if (action === 'calendar-prev') {
      state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() - 1, 1);
      renderCalendarPage();
      return;
    }

    if (action === 'calendar-day-open') {
      openCalendarDayDrawer(actionEl.dataset.date);
      return;
    }

    if (action === 'calendar-next') {
      state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + 1, 1);
      renderCalendarPage();
      return;
    }

    if (action === 'modal-close') {
      closeModal();
      return;
    }

    if (action === 'drawer-close') {
      closeDrawer();
      return;
    }

    if (action === 'open-modal') {
      openEntityModal(actionEl.dataset.entity, actionEl.dataset.id || null, actionEl.dataset.context || null);
      return;
    }

    if (action === 'brief-convert') {
      convertBriefToTask(actionEl.dataset.id);
      return;
    }

    if (action === 'task-delete') {
      deleteTask(actionEl.dataset.id);
      return;
    }

    if (action === 'project-delete') {
      deleteProject(actionEl.dataset.id);
      return;
    }

    if (action === 'user-delete') {
      deleteUser(actionEl.dataset.id);
      return;
    }

    if (action === 'change-password') {
      openChangePasswordModal();
      return;
    }

    if (action === 'department-delete') {
      deleteDepartment(actionEl.dataset.id);
      return;
    }

    if (action === 'subtask-row-add') {
      addSubtaskEditorRow();
      return;
    }

    if (action === 'subtask-row-remove') {
      actionEl.closest('.subtask-editor-row')?.remove();
      return;
    }

    if (action === 'color-pick') {
      const picker = actionEl.closest('[data-color-picker]');
      if (!picker) return;
      const input = picker.querySelector('input[name="color"]');
      const preview = picker.querySelector('[data-color-preview]');
      const label = picker.querySelector('[data-color-label]');
      const custom = picker.querySelector('[data-color-custom]');
      const nextColor = actionEl.dataset.color || '#6d28d9';
      if (input) input.value = nextColor;
      if (preview) preview.style.background = nextColor;
      if (label) label.textContent = nextColor.toUpperCase();
      if (custom) custom.value = nextColor;
      picker.querySelectorAll('.color-swatch').forEach((swatch) => swatch.classList.toggle('active', swatch === actionEl));
      return;
    }

    if (action === 'notification-read-all') {
      markAllNotificationsRead();
      return;
    }
  }

  function handleBodyChange(event) {
    const target = event.target;
    if (target.matches('input[type="file"][name="attachments"]')) {
      updateAttachmentStatus(target);
      return;
    }
    if (target.matches('[data-color-custom]')) {
      const picker = target.closest('[data-color-picker]');
      const input = picker?.querySelector('input[name="color"]');
      const preview = picker?.querySelector('[data-color-preview]');
      const label = picker?.querySelector('[data-color-label]');
      if (input) input.value = target.value;
      if (preview) preview.style.background = target.value;
      if (label) label.textContent = target.value.toUpperCase();
      picker?.querySelectorAll('.color-swatch').forEach((swatch) => swatch.classList.toggle('active', swatch.dataset.color === target.value));
      return;
    }
    if (!target.dataset.filter) return;
    const filter = target.dataset.filter;
    if (Object.prototype.hasOwnProperty.call(state.filters, filter)) {
      state.filters[filter] = target.type === 'checkbox' ? target.checked : target.value;
      if (state.activePage === 'board') renderBoardPage();
      if (state.activePage === 'projects') renderProjectsPage();
    }
  }

  function handleCommentPanelToggle(actionEl) {
    const key = actionEl?.dataset?.panelKey;
    if (!key) return;
    const panel = actionEl.closest('.inline-comment-panel');
    if (!panel) return;
    const willCollapse = !panel.classList.contains('is-collapsed');
    if (willCollapse) {
      state.openCommentPanels.delete(key);   // user hid it → not open anymore
      panel.classList.remove('is-open');
      panel.classList.add('is-collapsed');
      actionEl.setAttribute('aria-expanded', 'false');
      actionEl.textContent = 'Show';
      const body = panel.querySelector('.inline-comment-body');
      if (body) body.hidden = true;
    } else {
      state.openCommentPanels.add(key);      // user showed it → mark as open
      panel.classList.remove('is-collapsed');
      panel.classList.add('is-open');
      actionEl.setAttribute('aria-expanded', 'true');
      actionEl.textContent = 'Hide';
      const body = panel.querySelector('.inline-comment-body');
      if (body) body.hidden = false;
    }
  }

  async function handleBodySubmit(event) {
    const form = event.target;
    if (form.matches('[data-task-comment-form]')) {
      event.preventDefault();
      await addTaskComment(form);
      return;
    }
    if (form.matches('[data-attachment-form]')) {
      event.preventDefault();
      await addEntityAttachments(form);
      return;
    }
    if (!form.matches('[data-entity-form]')) return;
    event.preventDefault();
    const entity = form.dataset.entityForm;
    if (entity === 'task') saveTask(form);
    if (entity === 'subtask') saveSubtask(form);
    if (entity === 'project') saveProject(form);
    if (entity === 'meeting') saveMeeting(form);
    if (entity === 'brief') saveBrief(form);
    if (entity === 'user') saveUser(form);
    if (entity === 'department') saveDepartment(form);
    if (entity === 'change-password') savePasswordChange(form);
  }

  function renderQuickLogin() {
    // Quick Login panel removed per design revision — no-op
  }

  function handleLogin() {
    const identifier = (DOM.loginIdentifier.value || '').trim().toLowerCase();
    const password = DOM.loginPassword.value || '';
    DOM.loginError.textContent = '';

    if (!identifier) {
      DOM.loginError.textContent = 'Please enter username or email';
      return;
    }

    const user = state.data.users.find((item) => (
      [item.email, item.nick, item.name, item.id].filter(Boolean).map((value) => String(value).toLowerCase()).includes(identifier)
    ));

    if (!user) {
      DOM.loginError.textContent = 'User not found';
      return;
    }

    if (!verifyPassword(password, user.password)) {
      DOM.loginError.textContent = 'Incorrect password';
      return;
    }

    // Auto-upgrade plaintext password to bcrypt hash on first login
    if (_bcrypt && user.password && !user.password.startsWith('$2')) {
      user.password = hashPassword(password);
      queueRemoteUpsert('user', user);
      saveSnapshot();
    }

    saveSession(user.id);
    closeDrawer();
    closeModal();
    closeSidebar();
    DOM.drawerOverlay.classList.add('hidden');
    DOM.modalOverlay.classList.add('hidden');
    DOM.sidebarOverlay.classList.add('hidden');
    showToast('Signed in', 'Welcome ' + user.nick, { centered: true });
    writeSystemLog('login', { nick: user.nick, access: user.access });
    refreshApp();
  }

  function logout() {
    clearSession();
    DOM.appShell.classList.add('hidden');
    DOM.loginScreen.classList.remove('hidden');
    DOM.loginIdentifier.value = '';
    DOM.loginPassword.value = '';
    state.drawerReturnProjectId = null;
    state.activeProjectDrawerId = null;
    closeDrawer();
    closeModal();
    closeSidebar();
  }

  function openSidebar() {
    DOM.sidebar.classList.add('open');
    DOM.sidebarOverlay.classList.remove('hidden');
  }

  function closeSidebar() {
    DOM.sidebar.classList.remove('open');
    DOM.sidebarOverlay.classList.add('hidden');
  }

  function closeDrawer() {
    if (state.drawerReturnProjectId) {
      const projectId = state.drawerReturnProjectId;
      state.drawerReturnProjectId = null;
      openProjectDrawer(projectId);
      return;
    }
    state.activeProjectDrawerId = null;
    DOM.drawer.classList.add('hidden');
    DOM.drawerOverlay.classList.add('hidden');
    DOM.drawer.classList.remove('drawer-wide');
    DOM.drawer.innerHTML = '';
  }

  function closeModal() {
    DOM.modalOverlay.classList.add('hidden');
    DOM.modalCard.innerHTML = '';
  }

  function setActivePage(page) {
    state.activePage = page;
    refreshApp();
  }

  function refreshApp() {
    if (!state.currentUserId || !currentUser()) {
      renderQuickLogin();
      DOM.loginScreen.classList.remove('hidden');
      DOM.appShell.classList.add('hidden');
      return;
    }

    DOM.loginScreen.classList.add('hidden');
    DOM.appShell.classList.remove('hidden');

    syncStatusBanner();
    renderSidebar();
    renderPageShell();
    const renderers = [
      ['dashboard', renderDashboardPage],
      ['onlyme', renderOnlyMePage],
      ['board', renderBoardPage],
      ['calendar', renderCalendarPage],
      ['projects', renderProjectsPage],
      ['meetings', renderMeetingsPage],
      ['briefs', renderBriefsPage],
      ['team', renderTeamPage],
      ['notifications', renderNotificationsPage],
    ];

    renderers.forEach(([page, render]) => {
      try {
        render();
      } catch (error) {
        console.error(`Failed to render ${page} page`, error);
        if (DOM.pages[page]) {
          DOM.pages[page].innerHTML = `
            <div class="card">
              <div class="card-header">
                <div>
                  <h3 class="card-title">This page could not load</h3>
                  <div class="card-subtitle">Please review the latest data and page renderer.</div>
                </div>
              </div>
              <div class="empty-copy">Render error: ${escapeHtml(error?.message || 'Unknown error')}</div>
            </div>
          `;
        }
      }
    });
    updateBadges();
  }

  function renderSidebar() {
    const user = currentUser();
    const visibleItems = getVisibleWorkItems(user);
    DOM.currentUserAvatar.style.background = user.color;
    DOM.currentUserAvatar.textContent = getUserInitials(user);
    DOM.currentUserName.textContent = user.name;
    DOM.currentUserMeta.textContent = [user.roleTitle, roleMeta(user.access).label].filter(Boolean).join(' / ');
    DOM.currentUserDot.className = `status-dot ${statusDotClass(user.status)}`;

    DOM.departmentPills.innerHTML = [
      `<button class="department-pill ${state.activeDepartment === 'all' ? 'active' : ''}" data-action="dept-filter" data-department="all" type="button"><span><i style="background:#64748b"></i>All departments</span><span>${visibleItems.length}</span></button>`,
      ...state.data.departments
        .sort((a, b) => a.order - b.order)
        .map((department) => {
          const count = visibleItems.filter((item) => item.departmentId === department.id).length;
          return `
            <button class="department-pill ${state.activeDepartment === department.id ? 'active' : ''}" data-action="dept-filter" data-department="${department.id}" type="button">
              <span><i style="background:${department.color}"></i>${escapeHtml(department.name)}</span>
              <span>${count}</span>
            </button>
          `;
        }),
    ].join('');

    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === state.activePage);
    });
  }

  function renderPageShell() {
    Object.entries(DOM.pages).forEach(([page, element]) => {
      element.classList.toggle('active', page === state.activePage);
    });

    const meta = pageMeta[state.activePage];
    DOM.pageTitle.textContent = meta.title;
    DOM.pageSubtitle.textContent = meta.subtitle;

    if (!meta.create) {
      DOM.createPrimaryButton.classList.add('hidden');
      return;
    }

    if (meta.create.entity === 'project' && !canCreateProject()) {
      DOM.createPrimaryButton.classList.add('hidden');
      return;
    }

    if (meta.create.entity === 'user' && !canCreateUser()) {
      DOM.createPrimaryButton.classList.add('hidden');
      return;
    }

    DOM.createPrimaryButton.classList.remove('hidden');
    DOM.createPrimaryButton.textContent = meta.create.label;

    const overdueCount = getVisibleWorkItems().filter(isOverdue).length;
    DOM.timelineWarning.classList.toggle('hidden', !overdueCount);
    DOM.timelineWarning.textContent = overdueCount ? `Overdue ${overdueCount} work item${overdueCount > 1 ? 's' : ''}` : '';
    if (overdueCount) {
      DOM.timelineWarning.dataset.action = 'overdue-open';
      DOM.timelineWarning.setAttribute('role', 'button');
      DOM.timelineWarning.setAttribute('tabindex', '0');
      DOM.timelineWarning.title = 'Open overdue work items';
    } else {
      delete DOM.timelineWarning.dataset.action;
      DOM.timelineWarning.removeAttribute('role');
      DOM.timelineWarning.removeAttribute('tabindex');
      DOM.timelineWarning.removeAttribute('title');
    }
  }

  function handlePrimaryCreate() {
    const meta = pageMeta[state.activePage];
    if (meta?.create?.entity) {
      openEntityModal(meta.create.entity);
    }
  }

  function renderDashboardPageLegacy() {
    const user = currentUser();
    const tasks = filterTasksByActiveDepartment(getVisibleTasks(user));
    const workItems = filterTasksByActiveDepartment(getVisibleWorkItems(user));
    const projects = filterProjectsByActiveDepartment(getVisibleProjects(user));
    const unreadNotifications = getVisibleNotifications(user).filter((item) => !item.readAt);
    const today = todayIso();
    const todayStamp = new Date(`${today}T00:00:00`).getTime();
    const nextWeek = new Date(`${today}T00:00:00`);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStamp = nextWeek.getTime();
    const upcomingMeetings = state.data.meetings
      .filter((meeting) => {
        const start = meeting.startAt || meeting.start_time || meeting.startTime;
        if (!start) return false;
        const stamp = new Date(start).getTime();
        return Number.isFinite(stamp) && stamp >= todayStamp && stamp <= nextWeekStamp;
      })
      .sort((a, b) => new Date(a.startAt || a.start_time || a.startTime || 0) - new Date(b.startAt || b.start_time || b.startTime || 0))
      .slice(0, 4);
    const dueSoonItems = workItems
      .filter((item) => item.dueDate && !isCompleteStatus(item.status))
      .filter((item) => {
        const stamp = new Date(`${item.dueDate}T00:00:00`).getTime();
        return Number.isFinite(stamp) && stamp >= todayStamp && stamp <= nextWeekStamp;
      })
      .sort((a, b) => new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`))
      .slice(0, 4);
    const overdueItems = workItems
      .filter(isOverdue)
      .sort((a, b) => new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`))
      .slice(0, 4);
    const myTasks = workItems.filter((task) => task.assigneeIds.includes(user.id));
    const metrics = [
      { label: 'My open work', value: myTasks.filter((task) => !isCompleteStatus(task.status)).length, foot: 'tasks + briefs assigned to you' },
      { label: 'Completed today', value: workItems.filter((task) => isCompleteStatus(task.status)).length, foot: 'visible completed work' },
      { label: 'At risk', value: workItems.filter(isOverdue).length, foot: 'overdue or delayed items' },
      { label: 'Unread alerts', value: unreadNotifications.length, foot: 'notification queue' },
    ];

    const deptHealth = state.data.departments
      .map((department) => {
        const deptTasks = workItems.filter((task) => task.departmentId === department.id);
        const done = deptTasks.filter((task) => isCompleteStatus(task.status)).length;
        const pct = deptTasks.length ? Math.round((done / deptTasks.length) * 100) : 0;
        return { department, count: deptTasks.length, pct };
      })
      .filter((row) => row.count || !currentDepartment());

    const activity = tasks
      .flatMap((task) => (task.activity || []).map((item) => ({
        task,
        item,
      })))
      .sort((a, b) => new Date(b.item.createdAt || 0) - new Date(a.item.createdAt || 0))
      .slice(0, 8);

    DOM.pages.dashboard.innerHTML = `
      <div class="metrics-grid">
        ${metrics.map((metric) => `
          <article class="card metric-card">
            <div class="metric-label">${escapeHtml(metric.label)}</div>
            <div class="metric-value">${metric.value}</div>
            <div class="metric-foot">${escapeHtml(metric.foot)}</div>
          </article>
        `).join('')}
      </div>

      <div class="two-col">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Projects overview</h3>
              <div class="card-subtitle">visible projects based on role + secret membership</div>
            </div>
          </div>
          <div class="summary-list">
            ${projects.length ? projects.map((project) => {
              const progress = projectProgress(project.id);
              return `
                <button class="project-card" type="button" data-action="project-open" data-id="${project.id}">
                  <div class="row-between">
                    <div>
                      <strong>${escapeHtml(project.name)}</strong>
                      <div class="row-meta">${departmentChip(project.departmentId)} ${project.isSecret ? '<span class="tag-chip" style="background:rgba(239,68,68,0.12);color:#ef4444">Secret</span>' : ''}</div>
                    </div>
                    <strong>${progress}%</strong>
                  </div>
                  <div class="progress"><span style="width:${progress}%;background:${project.color}"></span></div>
                  <div class="row-meta">
                    <span>${projectWorkItems(project.id).length} work item(s)</span>
                    <span>Due ${formatDate(project.deadline)}</span>
                  </div>
                </button>
              `;
            }).join('') : '<div class="empty-copy">No visible projects for this scope yet</div>'}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Department health</h3>
              <div class="card-subtitle">completion snapshot by department</div>
            </div>
          </div>
          <div class="health-list">
            ${deptHealth.map((row) => `
              <div class="health-row">
                <div class="row-between">
                  <strong>${escapeHtml(row.department.name)}</strong>
                  <span class="muted">${row.count} item(s)</span>
                </div>
                <div class="health-bar"><span style="width:${row.pct}%;background:${row.department.color}"></span></div>
                <div class="row-meta">
                  <span>${row.pct}% completed</span>
                </div>
              </div>
            `).join('') || '<div class="empty-copy">No department activity</div>'}
          </div>
        </section>
      </div>

      <div style="margin-top:18px;">
        ${renderDashboardTimelineCard(projects)}
      </div>

      <div class="two-col" style="margin-top:18px;">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Recent activity</h3>
              <div class="card-subtitle">task movements and updates</div>
            </div>
          </div>
          <div class="activity-list overview-feed-list">
            ${activity.length ? activity.map(({ task, item }) => `
              <div class="activity-row">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="muted">${escapeHtml(item.action || '')}</div>
                <div class="row-meta">
                  <span>${escapeHtml(getUser(item.actorId)?.nick || 'Unknown')}</span>
                  <span>${formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            `).join('') : '<div class="empty-copy">No recent activity yet</div>'}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Today & next</h3>
              <div class="card-subtitle">upcoming meetings and delayed items</div>
            </div>
          </div>
          <div class="meeting-list overview-feed-list">
            ${upcomingMeetings.map((meeting) => `
              <button class="meeting-row" type="button" data-action="meeting-open" data-id="${meeting.id}">
                <strong>${escapeHtml(meeting.title)}</strong>
                <div class="muted">${formatDateTime(meeting.startAt)} Â· ${escapeHtml(meeting.location)}</div>
              </button>
            `).join('')}
            ${tasks.filter(isOverdue).slice(0, 4).map((task) => `
              <button class="meeting-row" type="button" data-action="task-open" data-id="${task.id}">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="muted">Overdue Â· ${formatDate(task.dueDate)}</div>
              </button>
            `).join('')}
            ${!todaysMeetings.length && !tasks.filter(isOverdue).length ? '<div class="empty-copy">Nothing urgent right now</div>' : ''}
          </div>
        </section>
      </div>
    `;
  }

  function renderBoardPageLegacy() {
    const projects = filterProjectsByActiveDepartment(getVisibleProjects());
    const tasks = getBoardTasks();
    const grouped = Config.taskStatuses.map((status) => ({
      status,
      tasks: tasks.filter((task) => task.status === status.id),
    }));

    DOM.pages.board.innerHTML = `
      <div class="board-shell">
        <div class="card">
          <div class="toolbar">
            <label class="field">
              <input data-filter="taskSearch" type="text" value="${escapeHtml(state.filters.taskSearch)}" placeholder="Search task, project, assignee">
            </label>
            <label class="field">
              <select data-filter="taskProject">
                <option value="all">All projects</option>
                ${projects.map((project) => `<option value="${project.id}" ${state.filters.taskProject === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <select data-filter="taskDept">
                <option value="all">All departments</option>
                ${state.data.departments.map((department) => `<option value="${department.id}" ${state.filters.taskDept === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field" style="min-width:140px;">
              <span class="inline-note"><input data-filter="taskMine" type="checkbox" ${state.filters.taskMine ? 'checked' : ''}> only mine</span>
            </label>
          </div>
        </div>

        <div class="kanban-board">
          ${grouped.map(({ status, tasks: columnTasks }) => `
            <section class="kanban-column">
              <div class="kanban-column-header">
                <div class="kanban-column-title">${status.label}</div>
                <div class="muted">${columnTasks.length}</div>
              </div>
              <div class="kanban-stack">
                ${columnTasks.length ? columnTasks.map(renderTaskCard).join('') : '<div class="empty-copy">No tasks</div>'}
              </div>
            </section>
          `).join('')}
        </div>
      </div>
    `;
  }

  function getBoardTasks() {
    const user = currentUser();
    const query = state.filters.taskSearch.trim().toLowerCase();
    return filterTasksByActiveDepartment(getVisibleTasks(user))
      .filter((task) => state.filters.taskProject === 'all' || task.projectId === state.filters.taskProject)
      .filter((task) => state.filters.taskDept === 'all' || task.departmentId === state.filters.taskDept)
      .filter((task) => !state.filters.taskMine || task.assigneeIds.includes(user.id) || task.createdBy === user.id)
      .filter((task) => {
        if (!query) return true;
        const project = getProject(task.projectId);
        const pool = [
          task.title,
          task.description,
          project?.name,
          ...task.assigneeIds.map((id) => getUser(id)?.name || ''),
        ].join(' ').toLowerCase();
        return pool.includes(query);
      })
      .sort(compareWorkItems);
  }

  function renderTaskCard(task) {
    const project = getProject(task.projectId);
    const overdue = isOverdue(task);
    const isComplete = isCompleteStatus(task.status);
    return `
      <button class="task-card ${isComplete ? 'is-complete' : ''}" type="button" data-action="task-open" data-id="${task.id}">
        <div class="row-between">
          ${priorityChip(task.priority)}
          ${statusChip(task.status)}
        </div>
        <strong>${escapeHtml(task.title)}</strong>
        <div class="muted">${escapeHtml((task.description || '').slice(0, 110) || 'No description')}</div>
        <div class="progress"><span style="width:${taskProgress(task)}%;background:${project?.color || '#6d28d9'}"></span></div>
        <div class="row-meta">
          <span>${project ? escapeHtml(project.name) : 'No project'}</span>
          <span style="color:${overdue ? '#ef4444' : 'inherit'}">${overdue ? 'Overdue' : 'Due'} ${formatDate(task.dueDate)}</span>
        </div>
        <div class="pill-list">
          ${task.assigneeIds.slice(0, 3).map((id) => {
            const user = getUser(id);
            return user ? `<span class="person-pill">${avatarHtml(user)} ${escapeHtml(user.nick)}</span>` : '';
          }).join('')}
        </div>
      </button>
    `;
  }

  function renderCalendarPageLegacyBroken() {
    const cursor = state.calendarCursor;
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const tasks = filterTasksByActiveDepartment(getVisibleTasks());
    const meetings = state.data.meetings;
    const days = [];

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const iso = localDateIso(date);
      const dayTasks = tasks.filter((task) => task.dueDate === iso || task.startDate === iso);
      const dayMeetings = meetings.filter((meeting) => meeting.startAt.slice(0, 10) === iso);
      days.push({ date, iso, dayTasks, dayMeetings });
    }

    DOM.pages.calendar.innerHTML = `
      <div class="calendar-shell">
        <div class="card calendar-head">
          <button class="icon-button" type="button" data-action="calendar-prev">&lt;</button>
          <div class="calendar-month">${cursor.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</div>
          <button class="icon-button" type="button" data-action="calendar-next">&gt;</button>
        </div>
        <div class="card">
          <div class="calendar-grid calendar-grid-head">
            ${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}
          </div>
          <div class="calendar-month-grid">
            ${weeks.map((weekDays) => renderWeek(weekDays)).join('')}
          </div>
          <div class="legend" style="margin-top:16px;">
            <span><i style="background:#2563eb"></i>Task</span>
            <span><i style="background:#22c55e"></i>CEO Brief</span>
            <span><i style="background:#10b981"></i>Meeting</span>
          </div>
        </div>
      </div>
    `;
    return;

    DOM.pages.calendar.innerHTML = `
      <div class="calendar-shell">
        <div class="card calendar-head">
          <button class="icon-button" type="button" data-action="calendar-prev">&lt;</button>
          <div class="calendar-month">${cursor.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</div>
          <button class="icon-button" type="button" data-action="calendar-next">&gt;</button>
        </div>
        <div class="card">
          <div class="calendar-grid calendar-grid-head">
            ${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}
            ${days.map((day) => {
              const otherMonth = day.date.getMonth() !== cursor.getMonth();
              const today = day.iso === todayIso();
              return `
                <div class="calendar-day ${otherMonth ? 'other-month' : ''} ${today ? 'today' : ''}">
                  <div class="calendar-day-number">${day.date.getDate()}</div>
                  ${day.dayTasks.slice(0, 2).map((task) => {
                    const project = getProject(task.projectId);
                    return `<button class="calendar-event" style="background:${hexToAlpha(project?.color || '#6d28d9', 0.12)};color:${project?.color || '#6d28d9'}" type="button" data-action="task-open" data-id="${task.id}">${escapeHtml(task.title)}</button>`;
                  }).join('')}
                  ${day.dayMeetings.slice(0, 2).map((meeting) => `
                    <button class="calendar-event" style="background:rgba(16,185,129,0.12);color:#0f766e" type="button" data-action="meeting-open" data-id="${meeting.id}">Meeting: ${escapeHtml(meeting.title)}</button>
                  `).join('')}
                </div>
              `;
            }).join('')}
          </div>
          <div class="legend" style="margin-top:16px;">
            <span><i style="background:#2563eb"></i>Task</span>
            <span><i style="background:#10b981"></i>Meeting</span>
            <span><i style="background:#7c3aed"></i>Today</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderProjectsPage() {
    const projects = filterProjectsByActiveDepartment(getVisibleProjects())
      .filter((project) => state.filters.projectDept === 'all' || project.departmentId === state.filters.projectDept)
      .filter((project) => state.filters.projectVisibility === 'all' || (state.filters.projectVisibility === 'secret' ? project.isSecret : !project.isSecret))
      .sort((a, b) => compareWorkItems(
        projectWorkItems(a.id)[0] || { status: 'approve', priority: 'low', dueDate: a.deadline, createdAt: a.createdAt },
        projectWorkItems(b.id)[0] || { status: 'approve', priority: 'low', dueDate: b.deadline, createdAt: b.createdAt },
      ));

    DOM.pages.projects.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <label class="field">
            <select data-filter="projectDept">
              <option value="all">All departments</option>
              ${state.data.departments.map((department) => `<option value="${department.id}" ${state.filters.projectDept === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <select data-filter="projectVisibility">
              <option value="all">All access</option>
              <option value="public" ${state.filters.projectVisibility === 'public' ? 'selected' : ''}>Public</option>
              <option value="secret" ${state.filters.projectVisibility === 'secret' ? 'selected' : ''}>Secret</option>
            </select>
          </label>
        </div>
      </div>

      <div class="projects-grid" style="margin-top:18px;">
        ${projects.length ? projects.map((project) => {
          const progress = projectProgress(project.id);
          const owner = getUser(project.ownerId);
          return `
            <button class="project-card" type="button" data-action="project-open" data-id="${project.id}">
              <div class="project-card-accent" style="--project-color:${project.color}"></div>
              <div class="row-between">
                <div class="project-title-wrap">
                  <span class="project-color-dot" style="background:${project.color}"></span>
                  <strong>${escapeHtml(project.name)}</strong>
                </div>
                ${departmentChip(project.departmentId)}
              </div>
              <div class="muted">${escapeHtml(project.description)}</div>
              <div class="progress"><span style="width:${progress}%;background:${project.color}"></span></div>
              <div class="row-between">
                <div class="row-meta">
                  <span>${projectTasks(project.id).length} tasks</span>
                  <span>${project.isSecret ? 'Secret' : 'Public'}</span>
                </div>
                <strong>${progress}%</strong>
              </div>
              <div class="pill-list">
                ${project.memberIds.slice(0, 3).map((id) => {
                  const member = getUser(id);
                  return member ? `<span class="person-pill">${avatarHtml(member)} ${escapeHtml(member.nick)}</span>` : '';
                }).join('')}
              </div>
              <div class="row-meta">
                <span>Owner: ${escapeHtml(owner?.nick || 'Unknown')}</span>
                <span>Due ${formatDate(project.deadline)}</span>
              </div>
            </button>
          `;
        }).join('') : '<div class="empty-copy">No projects for this filter</div>'}
      </div>
    `;
  }

  function renderMeetingsPage() {
    const meetings = [...state.data.meetings].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    DOM.pages.meetings.innerHTML = `
      <div class="two-col">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Upcoming meetings</h3>
              <div class="card-subtitle">schedule, attendees, and notes</div>
            </div>
          </div>
          <div class="meeting-list">
            ${meetings.map((meeting) => `
              <button class="meeting-row" type="button" data-action="meeting-open" data-id="${meeting.id}">
                <div class="row-between">
                  <strong>${escapeHtml(meeting.title)}</strong>
                  ${departmentChip(meeting.departmentId)}
                </div>
                <div class="muted">${escapeHtml(meeting.description || 'No description')}</div>
                <div class="row-meta">
                  <span>${formatDateTime(meeting.startAt)}</span>
                  <span>${escapeHtml(meeting.location)}</span>
                </div>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Meeting coverage</h3>
              <div class="card-subtitle">quality of schedule + note capture</div>
            </div>
          </div>
          <div class="summary-list">
            <div class="health-row">
              <strong>Total meetings</strong>
              <div class="metric-value metric-value-compact">${meetings.length}</div>
            </div>
            <div class="health-row">
              <strong>Meetings with notes</strong>
              <div class="metric-value metric-value-compact">${meetings.filter((meeting) => meeting.notes).length}</div>
            </div>
            <div class="health-row">
              <strong>Average attendees</strong>
              <div class="metric-value metric-value-compact">${meetings.length ? Math.round(meetings.reduce((sum, meeting) => sum + meeting.attendeeIds.length, 0) / meetings.length) : 0}</div>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderBriefsPage() {
    const briefs = filterBriefsByActiveDepartment(getVisibleBriefs());
    DOM.pages.briefs.innerHTML = `
      <div class="brief-grid">
        ${briefs.length ? briefs.map((brief) => {
          const project = getProject(brief.projectId);
          return `
            <button class="brief-card" type="button" data-action="brief-open" data-id="${brief.id}">
              <div class="row-between">
                ${priorityChip(brief.priority)}
                ${departmentChip(brief.departmentId)}
              </div>
              <strong>${escapeHtml(brief.title)}</strong>
              <div class="muted">${escapeHtml((brief.body || '').slice(0, 160))}</div>
              <div class="row-meta">
                <span>Status: ${escapeHtml(brief.status)}</span>
                <span>Due ${formatDate(brief.dueDate)}</span>
              </div>
              <div class="pill-list">
                ${(brief.assigneeIds || []).map((id) => {
                  const user = getUser(id);
                  return user ? `<span class="person-pill">${avatarHtml(user)} ${escapeHtml(user.nick)}</span>` : '';
                }).join('')}
              </div>
              <div class="row-meta">
                <span>${project ? `Project: ${project.name}` : 'No project linked'}</span>
              </div>
            </button>
          `;
        }).join('') : '<div class="empty-copy">No CEO brief visible for your role yet</div>'}
      </div>
    `;
  }

  function renderTeamPage() {
    const actor = currentUser();
    const users = [...state.data.users].sort((a, b) => roleRank(a) - roleRank(b));
    const departments = [...state.data.departments].sort((a, b) => a.order - b.order);
    const usersMarkup = `
      <div class="team-grid">
        ${users.map((user) => `
          <article class="team-row">
            <div class="row-between">
              <div style="display:flex;align-items:center;gap:12px;">
                ${avatarHtml(user, 'large')}
                <div>
                  <strong>${escapeHtml(user.name)}</strong>
                  <div class="muted">${escapeHtml(user.roleTitle)}</div>
                </div>
              </div>
              ${roleChip(user.access)}
            </div>
            <div class="row-meta" style="margin-top:12px;">
              <span>${escapeHtml(getDepartment(user.departmentId)?.name || 'No department')}</span>
              <span>${escapeHtml(user.email || '')}</span>
            </div>
            <div class="row-meta" style="margin-top:12px;">
              <span>Status: ${escapeHtml(user.status)}</span>
              <span>${escapeHtml(user.levelTitle)}</span>
            </div>
            <div class="drawer-actions">
              ${canEditUser(user, actor) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="user" data-id="${user.id}">Edit</button>` : ''}
              ${canDeleteUser(user, actor) ? `<button class="ghost-button" type="button" data-action="user-delete" data-id="${user.id}">Delete</button>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    `;
    const departmentsMarkup = canManageUsers(actor) ? `
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <div>
              <h3 class="card-title">Departments</h3>
              <div class="card-subtitle">admin can add, edit, delete, and reassign org structure</div>
            </div>
            <button class="primary-button" type="button" data-action="open-modal" data-entity="department">+ Add Department</button>
          </div>
          <div class="health-list">
            ${departments.map((department) => `
              <div class="health-row">
                <div class="row-between">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span class="tag-chip" style="background:${hexToAlpha(department.color, 0.14)};color:${department.color};">${escapeHtml(department.name)}</span>
                    <span class="muted">order ${department.order}</span>
                  </div>
                  <div class="drawer-actions" style="margin-top:0;">
                    <button class="secondary-button" type="button" data-action="open-modal" data-entity="department" data-id="${department.id}">Edit</button>
                    <button class="ghost-button" type="button" data-action="department-delete" data-id="${department.id}">Delete</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';
    // System log panel — admin/ceo only
    const syslogMarkup = ['admin', 'ceo'].includes(actor?.access) ? `
      <div class="card" id="syslogPanel" style="margin-top:12px;">
        <div class="card-header">
          <div>
            <h3 class="card-title">System Log</h3>
            <div class="card-subtitle">admin only — last 7 days, auto-cleared</div>
          </div>
          <button class="secondary-button" type="button" id="syslogRefreshBtn">↻ Refresh</button>
        </div>
        <div id="syslogContent"><div class="empty-copy">Click Refresh to load logs.</div></div>
      </div>
    ` : '';

    const myAccountMarkup = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:12px;">
            ${avatarHtml(actor, 'large')}
            <div>
              <h3 class="card-title" style="margin:0;">${escapeHtml(actor.name)}</h3>
              <div class="card-subtitle">${escapeHtml(actor.roleTitle)} · ${escapeHtml(actor.email || actor.nick)}</div>
            </div>
          </div>
          <button class="secondary-button" type="button" data-action="change-password">Change password</button>
        </div>
      </div>
    `;

    DOM.pages.team.innerHTML = `${myAccountMarkup}${usersMarkup}${departmentsMarkup}${syslogMarkup}`;

    if (['admin', 'ceo'].includes(actor?.access)) {
      const refreshBtn = document.getElementById('syslogRefreshBtn');
      const syslogContent = document.getElementById('syslogContent');
      if (refreshBtn && syslogContent) {
        refreshBtn.addEventListener('click', () => {
          refreshBtn.disabled = true;
          refreshBtn.textContent = 'Loading...';
          renderSystemLogPanel(syslogContent).then(() => {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '↻ Refresh';
          });
        });
      }
    }
  }

  function renderNotificationsPage() {
    const notifications = getVisibleNotifications();
    DOM.pages.notifications.innerHTML = `
      <div class="card">
        <div class="card-header" style="margin-bottom:${notifications.length ? '16px' : '0'}">
          <div>
            <h3 class="card-title">Notification queue</h3>
            <div class="card-subtitle">only your targeted items are shown</div>
          </div>
          ${notifications.some((n) => !n.readAt) ? `<button class="secondary-button" type="button" data-action="notification-read-all">Mark all read</button>` : ''}
        </div>
        <div class="notifications-grid">
          ${notifications.length ? notifications.map((notification) => `
            <article class="notification-row">
              <div class="row-between">
                <strong>${escapeHtml(notification.title)}</strong>
                ${notification.readAt ? '<span class="muted">Read</span>' : '<span class="tag-chip" style="background:rgba(239,68,68,0.12);color:#ef4444">Unread</span>'}
              </div>
              <div class="muted">${escapeHtml(notification.body)}</div>
              <div class="row-meta">
                <span>${formatDateTime(notification.createdAt)}</span>
                <span>${escapeHtml(notification.type)}</span>
              </div>
              <div class="drawer-actions">
                ${notification.refType && notification.refId ? `<button class="secondary-button" type="button" data-action="notification-open" data-id="${notification.id}">Open item</button>` : ''}
                ${notification.readAt ? '' : `<button class="secondary-button" type="button" data-action="notification-read" data-id="${notification.id}">Mark read</button>`}
              </div>
            </article>
          `).join('') : '<div class="empty-copy">No notifications yet</div>'}
        </div>
      </div>
    `;
  }

  function renderOnlyMePage() {
    const user = currentUser();
    const entries = assignedOnlyMeItems(user);

    const taskEntries    = entries.filter((e) => e.kind === 'task');
    const briefEntries   = entries.filter((e) => e.kind === 'brief');
    const meetingEntries = entries.filter((e) => !e.kind); // meetings have no kind

    function dueLabel(entry) {
      if (!entry.dueDate) return '<span class="onlyme-due">No due date</span>';
      return isOverdue(entry)
        ? `<span class="onlyme-due is-overdue">Overdue ${formatDate(entry.dueDate)}</span>`
        : `<span class="onlyme-due">Due ${formatDate(entry.dueDate)}</span>`;
    }

    function taskRow(entry) {
      const task    = getTask(entry.sourceId);
      const project = getProject(entry.projectId);
      const ctx     = project?.name || getDepartment(entry.departmentId)?.name || '—';
      return `
        <div class="onlyme-item">
          <div class="onlyme-item-row" data-action="${entry.openAction}" data-id="${entry.sourceId}">
            <div class="onlyme-item-status">${statusChip(entry.status)}</div>
            <div class="onlyme-item-body">
              <strong class="onlyme-item-name">${escapeHtml(entry.title)}</strong>
              <span class="onlyme-item-ctx muted">${escapeHtml(ctx)}</span>
            </div>
            <div class="onlyme-item-aside">
              ${priorityChip(entry.priority)}
              ${dueLabel(entry)}
              <button class="onlyme-view-btn" type="button" data-action="${entry.openAction}" data-id="${entry.sourceId}">View</button>
            </div>
          </div>
          ${task ? `<div class="onlyme-comment-wrap">${renderInlineCommentPanel(task, 'task', task.id)}</div>` : ''}
        </div>`;
    }

    function briefRow(entry) {
      const dept = getDepartment(entry.departmentId)?.name || '—';
      return `
        <div class="onlyme-item onlyme-item--brief">
          <div class="onlyme-item-row" data-action="brief-open" data-id="${entry.sourceId}">
            <div class="onlyme-item-status">${statusChip(entry.status)}</div>
            <div class="onlyme-item-body">
              <strong class="onlyme-item-name">${escapeHtml(entry.title)}</strong>
              <span class="onlyme-item-ctx muted">${escapeHtml(dept)}</span>
            </div>
            <div class="onlyme-item-aside">
              ${priorityChip(entry.priority)}
              ${dueLabel(entry)}
              <button class="onlyme-view-btn" type="button" data-action="brief-open" data-id="${entry.sourceId}">Open →</button>
            </div>
          </div>
          <div class="onlyme-brief-hint">
            <span>💬 Comments and thread are inside the brief</span>
          </div>
        </div>`;
    }

    function meetingRow(entry) {
      const loc = entry.location || getDepartment(entry.departmentId)?.name || '—';
      return `
        <div class="onlyme-item onlyme-item--meeting">
          <div class="onlyme-item-row" data-action="meeting-open" data-id="${entry.sourceId}">
            <div class="onlyme-item-status">
              <span class="tag-chip" style="background:rgba(16,185,129,0.10);color:#0f9f78;border-color:rgba(16,185,129,0.18)">Scheduled</span>
            </div>
            <div class="onlyme-item-body">
              <strong class="onlyme-item-name">${escapeHtml(entry.title)}</strong>
              <span class="onlyme-item-ctx muted">${escapeHtml(loc)}</span>
            </div>
            <div class="onlyme-item-aside">
              <span class="onlyme-due">${formatDateTime(entry.startAt)}</span>
              <button class="onlyme-view-btn" type="button" data-action="meeting-open" data-id="${entry.sourceId}">View</button>
            </div>
          </div>
        </div>`;
    }

    function group(label, color, items, renderRow, emptyMsg) {
      return `
        <div class="onlyme-group">
          <div class="onlyme-group-head">
            <span class="onlyme-group-dot" style="background:${color}"></span>
            <span class="onlyme-group-name">${label}</span>
            ${items.length ? `<span class="onlyme-group-badge">${items.length}</span>` : ''}
          </div>
          <div class="onlyme-group-body">
            ${items.length ? items.map(renderRow).join('') : `<div class="onlyme-group-empty">${emptyMsg}</div>`}
          </div>
        </div>`;
    }

    DOM.pages.onlyme.innerHTML = `
      <div class="card onlyme-panel">
        <div class="onlyme-panel-head">
          <h3 class="card-title">My list view</h3>
          <div class="card-subtitle">Sorted by nearest deadline · ${taskEntries.length + briefEntries.length + meetingEntries.length} items</div>
        </div>
        <div class="onlyme-groups">
          ${group('Tasks', '#2563eb', taskEntries, taskRow, 'No tasks assigned to you right now')}
          ${group('CEO Briefs', '#22c55e', briefEntries, briefRow, 'No CEO briefs assigned to you')}
          ${group('Meetings', '#10b981', meetingEntries, meetingRow, 'No upcoming meetings')}
        </div>
      </div>
    `;
  }

  function updateBadges() {
    const user = currentUser();
    const myOpenTasks = getVisibleWorkItems(user).filter((task) => task.assigneeIds.includes(user.id) && !isCompleteStatus(task.status)).length;
    const unreadNotifications = getVisibleNotifications(user).filter((item) => !item.readAt).length;
    const activeBriefs = getVisibleBriefs(user).filter((brief) => !isCompleteStatus(brief.status)).length;

    DOM.boardBadge.textContent = myOpenTasks;
    DOM.boardBadge.classList.toggle('hidden', !myOpenTasks);
    DOM.notificationBadge.textContent = unreadNotifications;
    DOM.notificationBadge.classList.toggle('hidden', !unreadNotifications);
    DOM.briefBadge.textContent = activeBriefs;
    DOM.briefBadge.classList.toggle('hidden', !activeBriefs);
  }

  function filterTasksByActiveDepartment(tasks) {
    if (state.activeDepartment === 'all') return tasks;
    return tasks.filter((task) => task.departmentId === state.activeDepartment);
  }

  function filterProjectsByActiveDepartment(projects) {
    if (state.activeDepartment === 'all') return projects;
    return projects.filter((project) => project.departmentId === state.activeDepartment);
  }

  function filterBriefsByActiveDepartment(briefs) {
    if (state.activeDepartment === 'all') return briefs;
    return briefs.filter((brief) => brief.departmentId === state.activeDepartment);
  }

  function renderTaskComments(task) {
    return renderCommentThread(task, 'task', task.id);
  }

  function commentsForTarget(task, targetType = 'task', targetId = task?.id) {
    return (task?.comments || [])
      .filter((comment) => {
        if (!comment || comment.deletedAt) return false;
        if (!String(comment.body || '').trim() && !(comment.attachments || []).length) return false;
        const commentTargetType = comment.targetType || 'task';
        const commentTargetId = comment.targetId || task.id;
        return commentTargetType === targetType && commentTargetId === targetId;
      })
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  function canEditComment(task, comment) {
    const user = currentUser();
    return !!user && (comment.authorId === user.id || canEditTask(task));
  }

  function canDeleteAttachment(file) {
    const user = currentUser();
    if (!user || !file || file.deletedAt) return false;
    if (['admin', 'ceo', 'executive'].includes(user.access)) return true;
    return file.uploadedBy === user.id;
  }

  function commentPanelKey(taskId, targetType = 'task', targetId = taskId) {
    return `${taskId || 'task'}:${targetType || 'task'}:${targetId || taskId || 'root'}`;
  }

  function selectedFileSummary(input) {
    const files = Array.from(input?.files || []);
    if (!files.length) return 'No file selected';
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const names = files.slice(0, 2).map((file) => file.name).join(', ');
    const more = files.length > 2 ? ` +${files.length - 2} more` : '';
    return `${files.length} file${files.length === 1 ? '' : 's'} ready (${formatFileSize(totalSize)}): ${names}${more}`;
  }

  function updateAttachmentStatus(input) {
    const form = input.closest('form');
    const status = form?.querySelector('[data-file-status]');
    if (!status) return;
    const hasFiles = (input.files || []).length > 0;
    status.textContent = selectedFileSummary(input);
    status.classList.toggle('is-ready', hasFiles);
  }

  function formatFileSize(bytes = 0) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
    return `${Math.round(size / 1024 / 102.4) / 10} MB`;
  }

  function attachmentKey(file, index = 0) {
    return file?.id || `${file?.name || 'file'}-${file?.createdAt || ''}-${file?.size || 0}-${index}`;
  }

  // Max per-file size: 30MB (base64 in JSONB = +33% in DB; migrate to Supabase Storage post-launch for larger files).
  const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

  function readAttachmentFiles(input) {
    const files = Array.from(input?.files || []);
    const oversized = files.find((file) => (file.size || 0) > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      return Promise.reject(new Error(`"${oversized.name}" is ${formatFileSize(oversized.size)} — max allowed is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`));
    }
    return Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: uid('file'),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        dataUrl: reader.result,
        uploadedBy: currentUser()?.id || null,
        createdAt: nowIso(),
      });
      reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    })));
  }

  function renderAttachmentList(attachments = [], compact = false, context = {}) {
    const files = (attachments || []).filter((file) => file && !file.deletedAt);
    if (!files.length) return compact ? '' : '<div class="empty-copy">No files attached</div>';
    return `
      <div class="attachment-list ${compact ? 'is-compact' : ''}">
        ${files.map((file, index) => {
          const fileKey = attachmentKey(file, index);
          return `
            <div class="attachment-item">
              <a class="attachment-chip" href="${escapeHtml(file.dataUrl || file.publicUrl || '#')}" download="${escapeHtml(file.name || 'dire-wolf-file')}" target="_blank" rel="noopener">
                <span class="attachment-icon">${String(file.type || '').startsWith('image/') ? 'IMG' : 'FILE'}</span>
                <span>
                  <strong>${escapeHtml(file.name || 'Attachment')}</strong>
                  <small>${formatFileSize(file.size)} ${file.uploadedBy ? `by ${escapeHtml(getUser(file.uploadedBy)?.nick || 'Unknown')}` : ''}</small>
                </span>
              </a>
              ${canDeleteAttachment(file) && context.entityType ? `
                <button
                  class="attachment-delete-button"
                  type="button"
                  data-action="attachment-delete"
                  data-entity-type="${escapeHtml(context.entityType)}"
                  data-entity-id="${escapeHtml(context.entityId || '')}"
                  data-task-id="${escapeHtml(context.taskId || '')}"
                  data-target-type="${escapeHtml(context.targetType || '')}"
                  data-target-id="${escapeHtml(context.targetId || '')}"
                  data-comment-id="${escapeHtml(context.commentId || '')}"
                  data-file-id="${escapeHtml(fileKey)}"
                >Delete</button>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderAttachmentUploader(entityType, entityId, compact = false) {
    return `
      <form class="attachment-form ${compact ? 'is-compact' : ''}" data-attachment-form data-entity-type="${entityType}" data-entity-id="${entityId}">
        <label class="attachment-drop">
          <span>Attach image or file</span>
          <input type="file" name="attachments" multiple>
        </label>
        <span class="attachment-status" data-file-status>No file selected</span>
        <button class="secondary-button compact-button" type="submit">Upload</button>
      </form>
    `;
  }

  function getAttachableEntity(entityType, entityId) {
    if (entityType === 'project') return getProject(entityId);
    if (entityType === 'task') return getTask(entityId);
    if (entityType === 'brief') return getBrief(entityId);
    return null;
  }

  function canAttachToEntity(entityType, entity) {
    if (!entity) return false;
    if (entityType === 'project') return canViewProject(entity);
    if (entityType === 'task') return canCommentOnTask(entity);
    if (entityType === 'brief') return canViewBrief(entity);
    return false;
  }

  function renderCommentComposer(task, targetType = 'task', targetId = task.id, compact = false) {
    if (!canCommentOnTask(task)) {
      return '<div class="empty-copy comment-permission-copy">You can view this thread, but do not have permission to comment.</div>';
    }
    return `
      <form class="task-comment-form ${compact ? 'is-compact' : ''}" data-task-comment-form data-task-id="${task.id}" data-target-type="${targetType}" data-target-id="${targetId}">
        <input type="hidden" name="commentId" value="">
        <textarea name="comment" rows="${compact ? 2 : 3}" placeholder="Write a comment..."></textarea>
        <div class="comment-tools-row">
          <label class="comment-file-button">
            Attach
            <input type="file" name="attachments" multiple>
          </label>
          <span class="attachment-status" data-file-status>No file selected</span>
          <button class="ghost-button compact-button comment-post-btn" type="submit">Post</button>
        </div>
      </form>
    `;
  }

  function renderInlineCommentPanel(task, targetType = 'task', targetId = task?.id) {
    if (!task) return '';
    const comments = commentsForTarget(task, targetType, targetId);
    const key = commentPanelKey(task.id, targetType, targetId);
    const hasComments = comments.length > 0;
    // Always collapsed by default — body (composer + list) hidden until user clicks Show
    const isOpen = state.openCommentPanels?.has(key);
    const isCollapsed = !isOpen;
    return `
      <section class="inline-comment-panel ${isCollapsed ? 'is-collapsed' : 'is-open'}" data-comment-panel-key="${escapeHtml(key)}">
        <header class="inline-comment-header">
          <span class="inline-comment-summary-copy">
            <strong>Comments</strong>
            <small>Write updates, attach files, and keep the thread visible</small>
          </span>
          ${hasComments ? `<span class="inline-comment-count">${comments.length}</span>` : ''}
          <button
            type="button"
            class="inline-comment-toggle"
            data-action="comment-panel-toggle"
            data-panel-key="${escapeHtml(key)}"
            aria-expanded="${isCollapsed ? 'false' : 'true'}"
          >${isCollapsed ? 'Show' : 'Hide'}</button>
        </header>
        <div class="inline-comment-body" ${isCollapsed ? 'hidden' : ''}>
          ${renderCommentComposer(task, targetType, targetId, true)}
          ${hasComments ? `<div class="task-comment-list is-compact">
            ${renderCommentThread(task, targetType, targetId, { limit: 4 })}
          </div>` : ''}
        </div>
      </section>
    `;
  }

  function renderCommentThread(task, targetType = 'task', targetId = task?.id, options = {}) {
    const comments = commentsForTarget(task, targetType, targetId);
    if (!comments.length) {
      return '<div class="empty-copy">No comments yet</div>';
    }

    const visible = options.limit ? comments.slice(0, options.limit) : comments;
    return visible.map((comment) => {
      const author = getUser(comment.authorId);
      const color = author?.color || '#64748b';
      return `
        <article class="task-comment">
          <span class="task-comment-dot" style="background:${color}"></span>
          <div class="task-comment-body">
            <div class="task-comment-head">
              <strong>${escapeHtml(author?.nick || author?.name || 'Unknown')}</strong>
              <span>${formatDateTime(comment.createdAt)}</span>
              ${canEditComment(task, comment) ? `<button class="comment-edit-button" type="button" data-action="comment-edit" data-task-id="${task.id}" data-comment-id="${comment.id}" data-target-type="${targetType}" data-target-id="${targetId}">Edit</button>` : ''}
            </div>
            <p>${escapeHtml(comment.body)}</p>
            ${renderAttachmentList(comment.attachments || [], true, {
              entityType: 'comment',
              taskId: task.id,
              targetType,
              targetId,
              commentId: comment.id,
            })}
          </div>
        </article>
      `;
    }).join('') + (options.limit && comments.length > options.limit ? `<button class="comment-more-button" type="button" data-action="comment-open" data-task-id="${task.id}" data-target-type="${targetType}" data-target-id="${targetId}">View all ${comments.length} comments</button>` : '');
  }

  function openTaskDrawer(taskId) {
    const task = getTask(taskId);
    if (!task || !canViewTask(task)) return;
    DOM.drawer.classList.remove('drawer-wide');
    const project = getProject(task.projectId);
    const creator = getUser(task.createdBy);
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${priorityChip(task.priority)} ${statusChip(task.status, canUpdateTask(task) ? { action: 'status-cycle-task', data: { id: task.id } } : {})} ${departmentChip(task.departmentId)}</div>
          <h3 class="drawer-headline">${escapeHtml(task.title)}</h3>
          <div class="row-meta">
            <span>${project ? escapeHtml(project.name) : 'No project'}</span>
            <span>Created by ${escapeHtml(creator?.nick || 'Unknown')}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>

      <div class="drawer-section">
        <h4>Description</h4>
        <div>${escapeHtml(task.description || 'No description')}</div>
      </div>

      <div class="drawer-section">
        <h4>Timeline</h4>
        <div class="summary-list">
          <div class="health-row">
            <div class="row-between"><strong>Progress</strong><span>${taskProgress(task)}%</span></div>
            <div class="progress"><span style="width:${taskProgress(task)}%;background:${project?.color || '#6d28d9'}"></span></div>
          </div>
          <div class="row-meta">
            <span>Start ${formatDate(task.startDate)}</span>
            <span>Due ${formatDate(task.dueDate)}</span>
          </div>
        </div>
      </div>

      <div class="drawer-section">
        <h4>Files</h4>
        ${renderAttachmentList(task.attachments || [], false, { entityType: 'task', entityId: task.id })}
        ${renderAttachmentUploader('task', task.id)}
      </div>

      <div class="drawer-section">
        <h4>Assignees</h4>
        <div class="pill-list">
          ${task.assigneeIds.map((id) => {
            const assignee = getUser(id);
            return assignee ? `<span class="person-pill">${avatarHtml(assignee)} ${escapeHtml(assignee.nick)}</span>` : '';
          }).join('') || '<span class="muted">No assignee</span>'}
        </div>
      </div>

      <div class="drawer-section">
        <h4>Subtasks</h4>
        <div class="subtask-list">
          ${(task.subtasks || []).map((subtask) => {
            const item = normalizeSubtask(subtask);
            return `
              <div class="subtask-card ${item.done ? 'is-complete' : ''}">
                <label class="subtask-card-check">
                  <input type="checkbox" ${item.done ? 'checked' : ''} ${canUpdateTask(task) ? '' : 'disabled'} data-subtask-id="${item.id}" data-task-id="${task.id}" data-subtask-toggle>
                  <strong>${escapeHtml(item.title)}</strong>
                </label>
                <div class="pill-list">${statusChip(item.status, canUpdateTask(task) ? { action: 'status-cycle-subtask', data: { id: task.id, subtaskId: item.id } } : {})}</div>
                <div class="muted">${escapeHtml(item.description || 'No description')}</div>
                <div class="progress compact"><span style="width:${subtaskProgress(item)}%;background:${project?.color || '#6d28d9'}"></span></div>
                <div class="row-meta">
                  <span>Start ${formatDate(item.startDate)}</span>
                  <span>Due ${formatDate(item.dueDate)}</span>
                  <span>${subtaskProgress(item)}%</span>
                </div>
                <div class="subtask-social-panel">
                  ${renderInlineCommentPanel(task, 'subtask', item.id)}
                </div>
              </div>
            `;
          }).join('') || '<div class="empty-copy">No subtasks</div>'}
        </div>
        ${canEditTask(task) ? `<div class="drawer-actions"><button class="secondary-button" type="button" data-action="open-modal" data-entity="task" data-id="${task.id}">Manage subtasks</button></div>` : ''}
      </div>

      <div class="drawer-section">
        <h4>Comments</h4>
        ${renderCommentComposer(task, 'task', task.id)}
        <div class="task-comment-list">
          ${renderTaskComments(task)}
        </div>
      </div>

      <div class="drawer-actions">
        ${canEditTask(task) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="task" data-id="${task.id}">Edit task</button>` : ''}
        ${canDeleteTask(task) ? `<button class="ghost-button" type="button" data-action="task-delete" data-id="${task.id}">Delete</button>` : ''}
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
    DOM.drawer.querySelectorAll('[data-subtask-toggle]').forEach((checkbox) => {
      checkbox.addEventListener('change', handleSubtaskToggle);
    });
  }

  async function addTaskComment(form) {
    const task = getTask(form.dataset.taskId);
    if (!task || !canViewTask(task) || !canCommentOnTask(task)) return;
    const targetType = form.dataset.targetType || 'task';
    const targetId = form.dataset.targetId || task.id;
    const inlinePanelKey = form.closest('[data-comment-panel-key]')?.dataset.commentPanelKey;
    const input = form.elements.comment;
    const commentId = String(form.elements.commentId?.value || '').trim();
    const body = String(input?.value || '').trim();
    let attachments = [];
    try {
      attachments = await readAttachmentFiles(form.elements.attachments);
    } catch (error) {
      showToast('File too large', error?.message || 'Could not read attachment');
      return;
    }
    if (!body && !attachments.length) {
      showToast('Comment empty', 'Please write something or attach a file');
      input?.focus();
      return;
    }
    task.comments = task.comments || [];
    const existing = commentId ? task.comments.find((comment) => comment.id === commentId) : null;
    if (existing) {
      if (!canEditComment(task, existing)) return;
      existing.body = body;
      existing.attachments = (existing.attachments || []).concat(attachments);
      existing.updatedAt = nowIso();
      existing.editedAt = nowIso();
    } else {
      const comment = {
        id: uid('comment'),
        taskId: task.id,
        targetType,
        targetId,
        authorId: currentUser()?.id || null,
        body,
        attachments,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      task.comments.push(comment);
      notifyTaskComment(task, targetType, targetId, comment);
    }
    if (inlinePanelKey) {
      state.openCommentPanels.add(inlinePanelKey); // keep panel open after posting
    }
    saveSnapshot();
    queueRemoteUpsert('task', task);
    if (!DOM.drawer.classList.contains('hidden')) {
      if (form.closest('.inline-comment-panel') && state.activeProjectDrawerId) {
        openProjectDrawer(state.activeProjectDrawerId);
      } else {
        openTaskCommentsDrawer(task.id, targetType, targetId);
      }
    } else {
      refreshApp();
    }
    showToast(existing ? 'Comment updated' : 'Comment posted', task.title);
  }

  async function addEntityAttachments(form) {
    const entityType = form.dataset.entityType;
    const entityId = form.dataset.entityId;
    const entity = getAttachableEntity(entityType, entityId);
    if (!canAttachToEntity(entityType, entity)) return;

    // pre-check: any file selected?
    const fileInput = form.elements.attachments;
    const selectedCount = (fileInput?.files || []).length;
    if (!selectedCount) {
      showToast('No file selected', 'Choose at least one image or file');
      return;
    }

    // visual feedback: set uploading state
    const statusEl = form.querySelector('[data-file-status]');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (statusEl) {
      statusEl.classList.remove('is-ready');
      statusEl.classList.add('is-uploading');
      statusEl.textContent = `Uploading ${selectedCount} file${selectedCount === 1 ? '' : 's'}...`;
    }
    if (submitBtn) submitBtn.disabled = true;

    try {
      const files = await readAttachmentFiles(fileInput);
      if (!files.length) {
        showToast('No file selected', 'Choose at least one image or file');
        return;
      }
      entity.attachments = (entity.attachments || []).concat(files);
      saveSnapshot();
      queueRemoteUpsert(entityType, entity);
      if (entityType === 'project') openProjectDrawer(entity.id);
      if (entityType === 'task') openTaskDrawer(entity.id);
      if (entityType === 'brief') openBriefDrawer(entity.id);
      refreshApp();
      showToast('File uploaded', `${files.length} file(s) attached`);
    } catch (error) {
      console.error('Attachment upload failed', error);
      showToast('Upload failed', error?.message || 'Could not read file');
      if (statusEl) {
        statusEl.classList.remove('is-uploading');
        statusEl.textContent = 'Upload failed - try again';
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function findAttachmentInList(files = [], fileId) {
    return (files || []).find((file, index) => !file?.deletedAt && attachmentKey(file, index) === fileId);
  }

  function redrawAfterAttachmentChange(entityType, entity, context = {}) {
    if (entityType === 'comment' && entity) {
      state.openCommentPanels.add(commentPanelKey(entity.id, context.targetType || 'task', context.targetId || entity.id));
      if (!DOM.drawer.classList.contains('hidden') && state.activeProjectDrawerId) {
        openProjectDrawer(state.activeProjectDrawerId);
      } else if (!DOM.drawer.classList.contains('hidden')) {
        openTaskCommentsDrawer(entity.id, context.targetType || 'task', context.targetId || entity.id);
      } else {
        refreshApp();
      }
      return;
    }
    if (entityType === 'project' && !DOM.drawer.classList.contains('hidden')) openProjectDrawer(entity.id);
    if (entityType === 'task' && !DOM.drawer.classList.contains('hidden')) openTaskDrawer(entity.id);
    if (entityType === 'brief' && !DOM.drawer.classList.contains('hidden')) openBriefDrawer(entity.id);
    refreshApp();
  }

  function deleteAttachment(actionEl) {
    const entityType = actionEl.dataset.entityType;
    const fileId = actionEl.dataset.fileId;
    let entity = null;
    let attachment = null;
    let syncKind = entityType;
    const context = {
      targetType: actionEl.dataset.targetType || 'task',
      targetId: actionEl.dataset.targetId || actionEl.dataset.taskId || '',
    };

    if (entityType === 'comment') {
      entity = getTask(actionEl.dataset.taskId);
      const comment = (entity?.comments || []).find((item) => item.id === actionEl.dataset.commentId);
      attachment = findAttachmentInList(comment?.attachments || [], fileId);
      syncKind = 'task';
    } else {
      entity = getAttachableEntity(entityType, actionEl.dataset.entityId);
      attachment = findAttachmentInList(entity?.attachments || [], fileId);
    }

    if (!entity || !attachment) {
      showToast('File not found', 'This attachment is no longer available');
      return;
    }
    if (!canDeleteAttachment(attachment)) {
      showToast('Delete blocked', 'Only admins or the uploader can remove this file');
      return;
    }
    const confirmed = window.confirm(`Delete "${attachment.name || 'this file'}"? This cannot be undone.`);
    if (!confirmed) return;

    attachment.deletedAt = nowIso();
    attachment.deletedBy = currentUser()?.id || null;
    saveSnapshot();
    queueRemoteUpsert(syncKind, entity);
    redrawAfterAttachmentChange(entityType, entity, context);
    showToast('File removed', attachment.name || 'Attachment');
  }

  function fillCommentEditor(taskId, commentId, targetType = 'task', targetId = taskId) {
    const task = getTask(taskId);
    const comment = (task?.comments || []).find((item) => item.id === commentId);
    if (!task || !comment || !canEditComment(task, comment)) return;
    const form = DOM.drawer.querySelector(`[data-task-comment-form][data-task-id="${CSS.escape(taskId)}"][data-target-type="${CSS.escape(targetType)}"][data-target-id="${CSS.escape(targetId)}"]`);
    if (!form) {
      openTaskCommentsDrawer(taskId, targetType, targetId);
      requestAnimationFrame(() => fillCommentEditor(taskId, commentId, targetType, targetId));
      return;
    }
    form.elements.commentId.value = comment.id;
    form.elements.comment.value = comment.body || '';
    const button = form.querySelector('button[type="submit"]');
    if (button) button.textContent = 'Save comment';
    form.elements.comment.focus();
  }

  function openTaskCommentsDrawer(taskId, targetType = 'task', targetId = taskId) {
    const task = getTask(taskId);
    if (!task || !canViewTask(task)) return;
    const shouldReturnToProject = state.drawerReturnProjectId || (
      !DOM.drawer.classList.contains('hidden') &&
      DOM.drawer.classList.contains('drawer-wide') &&
      state.activeProjectDrawerId === task.projectId
    );
    state.drawerReturnProjectId = shouldReturnToProject ? task.projectId : null;
    state.activeProjectDrawerId = null;
    const project = getProject(task.projectId);
    const subtask = targetType === 'subtask'
      ? (task.subtasks || []).map(normalizeSubtask).find((item) => item.id === targetId)
      : null;
    const title = subtask ? subtask.title : task.title;
    DOM.drawer.classList.remove('drawer-wide');
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">
            <span>${project ? escapeHtml(project.name) : 'No project'}</span>
            <span>${targetType === 'subtask' ? 'Subtask thread' : 'Task thread'}</span>
          </div>
          <h3 class="drawer-headline">${escapeHtml(title)}</h3>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Conversation</h4>
        <div class="comment-social-card">
          ${renderCommentComposer(task, targetType, targetId)}
          <div class="task-comment-list">
            ${renderCommentThread(task, targetType, targetId)}
          </div>
        </div>
      </div>
      <div class="drawer-actions">
        <button class="secondary-button" type="button" data-action="task-open" data-id="${task.id}">Open task detail</button>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function handleSubtaskToggle(event) {
    const checkbox = event.target;
    const task = getTask(checkbox.dataset.taskId);
    if (!task || !canUpdateTask(task)) return;
    const subtask = (task.subtasks || []).find((item) => item.id === checkbox.dataset.subtaskId);
    if (!subtask) return;
    subtask.done = checkbox.checked;
    subtask.status = checkbox.checked ? 'approve' : (Number(subtask.progress || 0) > 0 ? 'inprogress' : 'backlog');
    subtask.progress = checkbox.checked ? 100 : Math.min(Number(subtask.progress || 0), 80);
    task.progress = recalcTaskProgress(task);
    logTaskActivity(task, `updated subtask "${subtask.title}"`);
    saveSnapshot();
    queueRemoteUpsert('task', task);
    openTaskDrawer(task.id);
    refreshApp();
  }

  // Guard against rapid-fire status cycle clicks (race condition).
  const _statusCycleInflight = new Set();
  function cycleTaskStatus(taskId) {
    if (_statusCycleInflight.has(`task:${taskId}`)) return;
    const task = getTask(taskId);
    if (!task || !canUpdateTask(task)) return;
    _statusCycleInflight.add(`task:${taskId}`);
    try {
      task.status = nextWorkflowStatus(task.status);
      task.progress = (task.subtasks || []).length
        ? (normalizeWorkflowStatus(task.status) === 'approve' ? 100 : recalcTaskProgress(task))
        : inferProgressFromStatus(task.status);
      logTaskActivity(task, `changed status to ${task.status}`);
      writeSystemLog('task_status_change', { taskId: task.id, title: task.title, newStatus: task.status });
      saveSnapshot();
      queueRemoteUpsert('task', task);
      if (!DOM.drawer.classList.contains('hidden') && DOM.drawer.innerHTML.includes(`data-id="${task.id}"`)) {
        openTaskDrawer(task.id);
      }
      refreshApp();
    } finally {
      // Release after a tick so very rapid double-clicks are coalesced.
      setTimeout(() => _statusCycleInflight.delete(`task:${taskId}`), 250);
    }
  }

  function cycleSubtaskStatus(taskId, subtaskId) {
    const lockKey = `subtask:${taskId}:${subtaskId}`;
    if (_statusCycleInflight.has(lockKey)) return;
    const task = getTask(taskId);
    if (!task || !canUpdateTask(task)) return;
    const subtask = (task.subtasks || []).find((item) => item.id === subtaskId);
    if (!subtask) return;
    _statusCycleInflight.add(lockKey);
    try {
      const nextStatus = nextWorkflowStatus(subtask.status);
      subtask.status = nextStatus;
      subtask.done = nextStatus === 'approve';
      subtask.progress = inferProgressFromStatus(nextStatus);
      task.progress = recalcTaskProgress(task);
      task.status = deriveTaskStatusFromSubtasks(task);
      logTaskActivity(task, `changed subtask "${subtask.title}" to ${nextStatus}`);
      saveSnapshot();
      queueRemoteUpsert('task', task);
      if (!DOM.drawer.classList.contains('hidden') && DOM.drawer.innerHTML.includes(`data-task-id="${task.id}"`)) {
        openTaskDrawer(task.id);
      }
      refreshApp();
    } finally {
      setTimeout(() => _statusCycleInflight.delete(lockKey), 250);
    }
  }

  function recalcTaskProgress(task) {
    const items = (task.subtasks || []).map(normalizeSubtask);
    if (!items.length) return task.progress || 0;
    const total = items.reduce((sum, item) => sum + subtaskProgress(item), 0);
    return Math.round(total / items.length);
  }

  function openProjectDrawerLegacy() {
    const project = getProject(projectId);
    if (!project || !canViewProject(project)) return;
    const tasks = projectTasks(project.id).filter((task) => canViewTask(task));
    const progress = projectProgress(project.id);
    const owner = getUser(project.ownerId);
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${departmentChip(project.departmentId)} ${project.isSecret ? '<span class="tag-chip" style="background:rgba(239,68,68,0.12);color:#ef4444">Secret</span>' : ''}</div>
          <h3 class="drawer-headline">${escapeHtml(project.name)}</h3>
          <div class="row-meta">
            <span>Owner ${escapeHtml(owner?.nick || 'Unknown')}</span>
            <span>Due ${formatDate(project.deadline)}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Description</h4>
        <div>${escapeHtml(project.description || 'No description')}</div>
      </div>
      <div class="drawer-section">
        <h4>Progress</h4>
        <div class="progress"><span style="width:${progress}%;background:${project.color}"></span></div>
        <div class="row-meta" style="margin-top:8px;">
          <span>${progress}% overall</span>
          <span>${tasks.length} visible task(s)</span>
        </div>
      </div>
      <div class="drawer-section">
        <h4>Members</h4>
        <div class="pill-list">
          ${project.memberIds.map((id) => {
            const member = getUser(id);
            return member ? `<span class="member-pill">${avatarHtml(member)} ${escapeHtml(member.nick)}</span>` : '';
          }).join('')}
        </div>
      </div>
      <div class="drawer-section">
        <h4>Timeline</h4>
        <div class="gantt-list">
          ${tasks.length ? tasks.map((task) => renderProjectGanttRow(task, project.color)).join('') : '<div class="empty-copy">No tasks in this project yet</div>'}
        </div>
      </div>
      <div class="drawer-actions">
        ${canEditProject(project) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="project" data-id="${project.id}">Edit project</button>` : ''}
        <button class="primary-button" type="button" data-action="open-modal" data-entity="task" data-context="${project.id}">+ New task</button>
        ${canEditProject(project) ? `<button class="ghost-button" type="button" data-action="project-delete" data-id="${project.id}">Delete</button>` : ''}
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => focusProjectSprintToday());
  }

  function renderProjectGanttRow(task, color) {
    if (!task.startDate || !task.dueDate) {
      return `
        <div class="gantt-row">
          <strong>${escapeHtml(task.title)}</strong>
          <div class="muted">No complete timeline yet</div>
        </div>
      `;
    }
    const allTasks = projectTasks(task.projectId).filter((item) => item.startDate && item.dueDate);
    const min = Math.min(...allTasks.map((item) => new Date(item.startDate).getTime()));
    const max = Math.max(...allTasks.map((item) => new Date(item.dueDate).getTime()));
    const span = Math.max(1, max - min);
    const left = ((new Date(task.startDate).getTime() - min) / span) * 100;
    const width = Math.max(8, ((new Date(task.dueDate).getTime() - new Date(task.startDate).getTime()) / span) * 100);
    return `
      <div class="gantt-row">
        <strong>${escapeHtml(task.title)}</strong>
        <div class="row-meta">
          <span>${formatDate(task.startDate)}</span>
          <span>${formatDate(task.dueDate)}</span>
        </div>
        <div class="gantt-track">
          <span class="gantt-bar" style="left:${left}%;width:${width}%;background:${color}"></span>
        </div>
      </div>
    `;
  }

  function openMeetingDrawer(meetingId) {
    const meeting = getMeeting(meetingId);
    if (!meeting) return;
    DOM.drawer.classList.remove('drawer-wide');
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${departmentChip(meeting.departmentId)}</div>
          <h3 class="drawer-headline">${escapeHtml(meeting.title)}</h3>
          <div class="row-meta">
            <span>${formatDateTime(meeting.startAt)}</span>
            <span>${escapeHtml(meeting.location)}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Description</h4>
        <div>${escapeHtml(meeting.description || 'No description')}</div>
      </div>
      <div class="drawer-section">
        <h4>Attendees</h4>
        <div class="pill-list">
          ${meeting.attendeeIds.map((id) => {
            const attendee = getUser(id);
            return attendee ? `<span class="person-pill">${avatarHtml(attendee)} ${escapeHtml(attendee.nick)}</span>` : '';
          }).join('') || '<span class="muted">No attendee</span>'}
        </div>
      </div>
      <div class="drawer-section">
        <h4>Notes</h4>
        <div>${escapeHtml(meeting.notes || 'No notes yet')}</div>
      </div>
      <div class="drawer-actions">
        <button class="secondary-button" type="button" data-action="open-modal" data-entity="meeting" data-id="${meeting.id}">Edit meeting</button>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function calendarEntryPriority(entry, user, departmentId) {
    if (!user) return 0;
    if (entry.type === 'meeting') {
      if ((entry.attendeeIds || []).includes(user.id)) return 0;
      if (entry.departmentId && entry.departmentId === departmentId) return 1;
      return 2;
    }
    if ((entry.assigneeIds || []).includes(user.id)) return 0;
    if (entry.departmentId && entry.departmentId === departmentId) return 1;
    return 2;
  }

  function compareCalendarEntries(a, b, user, departmentId) {
    const priorityDiff = calendarEntryPriority(a, user, departmentId) - calendarEntryPriority(b, user, departmentId);
    if (priorityDiff !== 0) return priorityDiff;
    if (a.type === 'meeting' && b.type !== 'meeting') return 1;
    if (a.type !== 'meeting' && b.type === 'meeting') return -1;
    if (a.type === 'meeting' && b.type === 'meeting') {
      return new Date(a.startAt || 0) - new Date(b.startAt || 0);
    }
    return compareWorkItems(a, b);
  }

  function calendarEntryButton(entry) {
    if (entry.type === 'meeting') {
      return `
        <button
          class="calendar-event"
          style="background:rgba(16,185,129,0.12);color:#0f766e;border:1px solid rgba(16,185,129,0.22)"
          type="button"
          data-action="meeting-open"
          data-id="${entry.id}"
        >Meeting: ${escapeHtml(entry.title)}</button>
      `;
    }

    const project = getProject(entry.projectId);
    const color = project?.color || entry.color || '#6d28d9';
    return `
      <button
        class="calendar-event"
        style="background:${hexToAlpha(color, 0.12)};color:${color};border:1px solid ${hexToAlpha(color, 0.22)}"
        type="button"
        data-action="${entry.openAction}"
        data-id="${entry.sourceId}"
      >${escapeHtml(entry.originLabel)}: ${escapeHtml(entry.title)}</button>
    `;
  }

  function calendarEntryDateRange(entry) {
    if (entry.type === 'meeting') {
      const day = (entry.startAt || '').slice(0, 10) || todayIso();
      return { start: day, end: day };
    }
    const first = entry.startDate || entry.dueDate || todayIso();
    const last = entry.dueDate || entry.startDate || first;
    return first <= last ? { start: first, end: last } : { start: last, end: first };
  }

  function calendarEntryIntersectsDay(entry, iso) {
    const range = calendarEntryDateRange(entry);
    return range.start <= iso && range.end >= iso;
  }

  function calendarEntryIntersectsRange(entry, start, end) {
    const range = calendarEntryDateRange(entry);
    return range.start <= end && range.end >= start;
  }

  function calendarBarTheme(entry) {
    if (entry.type === 'meeting') {
      return {
        background: 'rgba(16,185,129,0.12)',
        color: '#0f766e',
        border: 'rgba(16,185,129,0.22)',
      };
    }
    const project = getProject(entry.projectId);
    const color = project?.color || entry.color || '#6d28d9';
    return {
      background: hexToAlpha(color, 0.12),
      color,
      border: hexToAlpha(color, 0.22),
    };
  }

  function renderCalendarWeek(weekDays, entries, cursor, user, departmentId) {
    const weekStart = weekDays[0].iso;
    const weekEnd = weekDays[weekDays.length - 1].iso;
    const maxLanes = 3;
    const laneEnds = [];
    const bars = [];
    const hiddenEntries = [];

    const weekEntries = entries
      .filter((entry) => calendarEntryIntersectsRange(entry, weekStart, weekEnd))
      .sort((a, b) => {
        const base = compareCalendarEntries(a, b, user, departmentId);
        if (base !== 0) return base;
        const aRange = calendarEntryDateRange(a);
        const bRange = calendarEntryDateRange(b);
        if (aRange.start !== bRange.start) return aRange.start.localeCompare(bRange.start);
        return diffDay(bRange.start, bRange.end) - diffDay(aRange.start, aRange.end);
      });

    weekEntries.forEach((entry) => {
      const range = calendarEntryDateRange(entry);
      const segmentStart = range.start < weekStart ? weekStart : range.start;
      const segmentEnd = range.end > weekEnd ? weekEnd : range.end;
      const startColumn = diffDay(weekStart, segmentStart) + 1;
      const endColumn = diffDay(weekStart, segmentEnd) + 1;

      let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd < startColumn);
      if (laneIndex === -1 && laneEnds.length < maxLanes) {
        laneEnds.push(0);
        laneIndex = laneEnds.length - 1;
      }
      if (laneIndex === -1) {
        hiddenEntries.push(entry);
        return;
      }

      laneEnds[laneIndex] = endColumn;
      bars.push({
        entry,
        lane: laneIndex + 1,
        startColumn,
        endColumn,
        continuesPrev: range.start < weekStart,
        continuesNext: range.end > weekEnd,
      });
    });

    const hiddenCounts = weekDays.map((day) => hiddenEntries.filter((entry) => calendarEntryIntersectsDay(entry, day.iso)).length);

    return `
      <div class="calendar-week">
        <div class="calendar-week-days">
          ${weekDays.map((day, index) => {
            const otherMonth = day.date.getMonth() !== cursor.getMonth();
            const today = day.iso === todayIso();
            return `
              <div class="calendar-day ${otherMonth ? 'other-month' : ''} ${today ? 'today' : ''}">
                <button class="calendar-day-number" type="button" data-action="calendar-day-open" data-date="${day.iso}">${day.date.getDate()}</button>
                ${hiddenCounts[index] ? `<button class="calendar-more" type="button" data-action="calendar-day-open" data-date="${day.iso}">+${hiddenCounts[index]} more</button>` : ''}
              </div>
            `;
          }).join('')}
        </div>
        <div class="calendar-week-bars">
          ${bars.map(({ entry, lane, startColumn, endColumn, continuesPrev, continuesNext }) => {
            const theme = calendarBarTheme(entry);
            const label = entry.type === 'meeting' ? `Meeting: ${entry.title}` : `${entry.originLabel}: ${entry.title}`;
            const action = entry.type === 'meeting' ? 'meeting-open' : entry.openAction;
            const id = entry.type === 'meeting' ? entry.id : entry.sourceId;
            return `
              <button
                class="calendar-event-bar ${continuesPrev ? 'is-continued-prev' : ''} ${continuesNext ? 'is-continued-next' : ''}"
                style="grid-column:${startColumn} / ${endColumn + 1};grid-row:${lane};background:${theme.background};color:${theme.color};border-color:${theme.border}"
                type="button"
                data-action="${action}"
                data-id="${id}"
                title="${escapeHtml(label)}"
              >${escapeHtml(label)}</button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function openCalendarDayDrawer(iso) {
    const user = currentUser();
    const departmentId = state.activeDepartment === 'all' ? null : state.activeDepartment;
    const items = filterWorkItemsByActiveDepartment(getVisibleWorkItems(user))
      .filter((item) => calendarEntryIntersectsDay(item, iso));
    const meetings = state.data.meetings
      .filter((meeting) => (meeting.startAt || '').slice(0, 10) === iso)
      .map((meeting) => ({ ...meeting, type: 'meeting' }));

    const entries = items
      .concat(meetings)
      .sort((a, b) => compareCalendarEntries(a, b, user, departmentId));

    const dayLabel = formatDate(iso);

    DOM.drawer.classList.remove('drawer-wide');
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta"><span>Calendar queue</span></div>
          <h3 class="drawer-headline">${escapeHtml(dayLabel)}</h3>
          <div class="row-meta">
            <span>${entries.length} item(s)</span>
            <span>${escapeHtml(departmentId ? getDepartment(departmentId)?.name || 'Selected department' : 'All departments')}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Day Items</h4>
        <div class="meeting-list">
          ${entries.length ? entries.map((entry) => {
            if (entry.type === 'meeting') {
              return `
                <button class="meeting-row" type="button" data-action="meeting-open" data-id="${entry.id}">
                  <div class="row-between">
                    <strong>${escapeHtml(entry.title)}</strong>
                    ${departmentChip(entry.departmentId)}
                  </div>
                  <div class="muted">${escapeHtml(entry.description || 'No description')}</div>
                  <div class="row-meta">
                    <span>${formatDateTime(entry.startAt)}</span>
                    <span>${escapeHtml(entry.location || 'No location')}</span>
                  </div>
                </button>
              `;
            }
            const project = getProject(entry.projectId);
            return `
              <button class="task-card ${isCompleteStatus(entry.status) ? 'is-complete' : ''}" type="button" data-action="${entry.openAction}" data-id="${entry.sourceId}">
                <div class="row-between">
                  <div class="pill-list">
                    ${priorityChip(entry.priority)}
                    <span class="tag-chip">${escapeHtml(entry.originLabel)}</span>
                  </div>
                  ${statusChip(entry.status)}
                </div>
                <strong>${escapeHtml(entry.title)}</strong>
                <div class="muted">${escapeHtml((entry.description || '').slice(0, 140) || 'No description')}</div>
                <div class="row-meta">
                  <span>${project ? escapeHtml(project.name) : 'No project'}</span>
                  <span>Due ${formatDate(entry.dueDate)}</span>
                </div>
              </button>
            `;
          }).join('') : '<div class="empty-copy">No item for this day</div>'}
        </div>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openOverdueDrawer() {
    const user = currentUser();
    const items = filterWorkItemsByActiveDepartment(getVisibleWorkItems(user))
      .filter(isOverdue)
      .sort((a, b) => new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`));

    DOM.drawer.classList.remove('drawer-wide');
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta"><span>Overdue queue</span></div>
          <h3 class="drawer-headline">Overdue work items</h3>
          <div class="row-meta">
            <span>${items.length} item(s)</span>
            <span>${escapeHtml(currentDepartment()?.name || 'All departments')}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Needs attention</h4>
        <div class="meeting-list">
          ${items.length ? items.map((item) => {
            const project = getProject(item.projectId);
            return `
              <button class="task-card ${isCompleteStatus(item.status) ? 'is-complete' : ''}" type="button" data-action="${item.openAction}" data-id="${item.sourceId}">
                <div class="row-between">
                  <div class="pill-list">
                    ${priorityChip(item.priority)}
                    <span class="tag-chip">${escapeHtml(item.originLabel)}</span>
                    ${departmentChip(item.departmentId)}
                  </div>
                  ${statusChip(item.status)}
                </div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${escapeHtml((item.description || '').slice(0, 140) || 'No description')}</div>
                <div class="row-meta">
                  <span>${project ? escapeHtml(project.name) : 'No project'}</span>
                  <span style="color:#ef4444;">Overdue ${formatDate(item.dueDate)}</span>
                </div>
              </button>
            `;
          }).join('') : '<div class="empty-copy">No overdue work item right now</div>'}
        </div>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openDepartmentHealthDrawer(departmentId) {
    const department = getDepartment(departmentId);
    if (!department) return;

    const items = getVisibleWorkItems()
      .filter((item) => item.departmentId === departmentId)
      .sort(compareWorkItems);

    const done = items.filter((item) => isCompleteStatus(item.status)).length;
    const overdue = items.filter(isOverdue).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;

    DOM.drawer.classList.add('drawer-wide');
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${departmentChip(department.id)}</div>
          <h3 class="drawer-headline">${escapeHtml(department.name)} items</h3>
          <div class="row-meta">
            <span>${items.length} visible item(s)</span>
            <span>${pct}% completed</span>
            <span>${overdue} overdue</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <div class="progress"><span style="width:${pct}%;background:${department.color}"></span></div>
      </div>
      <div class="drawer-section">
        <div class="summary-list">
          ${items.length ? items.map((item) => {
            const project = getProject(item.projectId);
            const assignees = (item.assigneeIds || []).map((id) => {
              const user = getUser(id);
              return user ? `<span class="person-pill">${avatarHtml(user)} ${escapeHtml(user.nick)}</span>` : '';
            }).join('');
            return `
              <button class="task-card ${isCompleteStatus(item.status) ? 'is-complete' : ''}" type="button" data-action="${item.openAction}" data-id="${item.sourceId}">
                <div class="row-between">
                  <div class="pill-list">
                    ${priorityChip(item.priority)}
                    ${statusChip(item.status)}
                    <span class="tag-chip">${escapeHtml(item.originLabel)}</span>
                  </div>
                  <strong>${taskProgress(item)}%</strong>
                </div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${escapeHtml((item.description || '').slice(0, 160) || 'No description')}</div>
                <div class="row-meta">
                  <span>${project ? `Project: ${escapeHtml(project.name)}` : 'No project'}</span>
                  <span>Start ${formatDate(item.startDate)}</span>
                  <span>Due ${formatDate(item.dueDate)}</span>
                </div>
                <div class="progress"><span style="width:${taskProgress(item)}%;background:${project?.color || item.color || department.color}"></span></div>
                ${assignees ? `<div class="pill-list">${assignees}</div>` : '<div class="muted">No assignee</div>'}
              </button>
            `;
          }).join('') : '<div class="empty-copy">No visible work item in this department</div>'}
        </div>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openBriefDrawer(briefId) {
    const brief = getBrief(briefId);
    if (!brief || !canViewBrief(brief)) return;
    DOM.drawer.classList.remove('drawer-wide');
    const project = getProject(brief.projectId);
    const linkedTask = getTask(brief.linkedTaskId);
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${priorityChip(brief.priority)} ${departmentChip(brief.departmentId)}</div>
          <h3 class="drawer-headline">${escapeHtml(brief.title)}</h3>
          <div class="row-meta">
            <span>Status ${escapeHtml(brief.status)}</span>
            <span>Due ${formatDate(brief.dueDate)}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Brief body</h4>
        <div>${escapeHtml(brief.body)}</div>
      </div>
      <div class="drawer-section">
        <h4>Visible to</h4>
        <div class="pill-list">
          ${(brief.assigneeIds || []).map((id) => {
            const assignee = getUser(id);
            return assignee ? `<span class="person-pill">${avatarHtml(assignee)} ${escapeHtml(assignee.nick)}</span>` : '';
          }).join('')}
        </div>
      </div>
      <div class="drawer-section">
        <h4>Linked</h4>
        <div class="summary-list">
          <div class="health-row">${project ? `Project: <strong>${escapeHtml(project.name)}</strong>` : 'No linked project'}</div>
          <div class="health-row">${linkedTask ? `Task: <strong>${escapeHtml(linkedTask.title)}</strong>` : 'No linked task yet'}</div>
        </div>
      </div>
      <div class="drawer-actions">
        ${canEditBrief(brief) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="brief" data-id="${brief.id}">Edit brief</button>` : ''}
        ${canEditBrief(brief) && !brief.linkedTaskId ? `<button class="primary-button" type="button" data-action="brief-convert" data-id="${brief.id}">Convert to task</button>` : ''}
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openEntityModalLegacy(entity, id, context) {
    if (entity === 'task') openTaskModal(id, context);
    if (entity === 'subtask') openSubtaskModal(context, id);
    if (entity === 'project') openProjectModal(id);
    if (entity === 'meeting') openMeetingModal(id);
    if (entity === 'brief') openBriefModal(id);
    if (entity === 'user') openUserModal(id);
    if (entity === 'department') openDepartmentModal(id);
  }

  function openSubtaskModal(taskId, subtaskId) {
    const task = getTask(taskId);
    if (!task || !canEditTask(task)) return;
    const subtasks = (task.subtasks || []).map(normalizeSubtask);
    const subtask = subtasks.find((item) => item.id === subtaskId) || normalizeSubtask({});
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${subtaskId ? 'Edit subtask' : 'Create subtask'}</h3>
          <div class="muted">subtask is saved under task ${escapeHtml(task.title)}</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="subtask">
        <input type="hidden" name="taskId" value="${escapeHtml(task.id)}">
        <input type="hidden" name="id" value="${escapeHtml(subtask.id)}">
        <label class="field full">
          <span>Subtask title</span>
          <input name="title" required value="${escapeHtml(subtask.title || '')}">
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea name="description">${escapeHtml(subtask.description || '')}</textarea>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            ${Config.taskStatuses.map((status) => `<option value="${status.id}" ${normalizeSubtaskStatus(subtask.status) === status.id ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Progress</span>
          <input name="progress" type="range" min="0" max="100" value="${escapeHtml(subtaskProgress(subtask))}">
        </label>
        <label class="field">
          <span>Start date</span>
          <input name="startDate" type="date" value="${escapeHtml(subtask.startDate || task.startDate || todayIso())}">
        </label>
        <label class="field">
          <span>Due date</span>
          <input name="dueDate" type="date" value="${escapeHtml(subtask.dueDate || task.dueDate || todayIso())}">
        </label>
        <label class="field switch-line">
          <span>Approved</span>
          <input name="done" type="checkbox" ${subtask.done ? 'checked' : ''}>
        </label>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save subtask</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function renderSubtaskEditorRows(subtasks = []) {
    const rows = subtasks.length ? subtasks.map(normalizeSubtask) : [normalizeSubtask({})];
    return rows.map((subtask) => `
      <div class="subtask-editor-row">
        <input type="hidden" name="subtaskId" value="${escapeHtml(subtask.id || uid('st'))}">
        <label class="field subtask-title-field" style="margin:0;">
          <span>Subtask title</span>
          <input name="subtaskTitle" value="${escapeHtml(subtask.title || '')}" placeholder="Add subtask">
        </label>
        <label class="field" style="margin:0;">
          <span>Status</span>
          <select name="subtaskStatus">
            ${Config.taskStatuses.map((status) => `<option value="${status.id}" ${normalizeSubtaskStatus(subtask.status) === status.id ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field" style="margin:0;">
          <span>Start</span>
          <input name="subtaskStartDate" type="date" value="${escapeHtml(subtask.startDate || '')}">
        </label>
        <label class="field" style="margin:0;">
          <span>Due</span>
          <input name="subtaskDueDate" type="date" value="${escapeHtml(subtask.dueDate || '')}">
        </label>
        <label class="field" style="margin:0;">
          <span>Progress</span>
          <input name="subtaskProgress" type="range" min="0" max="100" value="${escapeHtml(subtaskProgress(subtask))}">
        </label>
        <label class="field inline-check" style="margin:0;">
          <span>Done</span>
          <input name="subtaskDone" type="checkbox" ${subtask.done ? 'checked' : ''}>
        </label>
        <label class="field subtask-description-field" style="margin:0;">
          <span>Description</span>
          <textarea name="subtaskDescription" placeholder="Subtask detail">${escapeHtml(subtask.description || '')}</textarea>
        </label>
        <button class="ghost-button" type="button" data-action="subtask-row-remove">Remove</button>
      </div>
    `).join('');
  }

  function parseSubtasksFromForm(form) {
    return Array.from(form.querySelectorAll('.subtask-editor-row')).map((row) => {
      const title = row.querySelector('input[name="subtaskTitle"]')?.value.trim() || '';
      const status = normalizeSubtaskStatus(row.querySelector('select[name="subtaskStatus"]')?.value || 'backlog');
      const progress = clamp(Number(row.querySelector('input[name="subtaskProgress"]')?.value || 0), 0, 100);
      const done = !!row.querySelector('input[name="subtaskDone"]')?.checked || status === 'approve' || progress >= 100;
      return {
        id: row.querySelector('input[name="subtaskId"]')?.value || uid('st'),
        title,
        description: row.querySelector('textarea[name="subtaskDescription"]')?.value.trim() || '',
        status: done ? 'approve' : status,
        progress: done ? 100 : progress,
        startDate: row.querySelector('input[name="subtaskStartDate"]')?.value || '',
        dueDate: row.querySelector('input[name="subtaskDueDate"]')?.value || '',
        done,
      };
    }).filter((item) => item.title).map(normalizeSubtask);
  }

  function addSubtaskEditorRow() {
    const host = DOM.modalCard.querySelector('[data-subtask-editor-list]');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', renderSubtaskEditorRows([normalizeSubtask({})]));
  }

  function openTaskModal(taskId, projectContext) {
    const task = taskId ? getTask(taskId) : null;
    if (task && !canEditTask(task)) return;
    const defaultProjectId = task?.projectId || projectContext || '';
    const assignableUsers = state.data.users.filter((user) => canAssign(currentUser(), user));
    const visibleProjects = getVisibleProjects();

    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${task ? 'Edit task' : 'Create task'}</h3>
          <div class="muted">permission-aware editor with project, assignee, and date flow</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="task">
        <input type="hidden" name="id" value="${escapeHtml(task?.id || '')}">
        <label class="field full">
          <span>Task title</span>
          <input name="title" required value="${escapeHtml(task?.title || '')}">
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea name="description">${escapeHtml(task?.description || '')}</textarea>
        </label>
        <label class="field">
          <span>Project</span>
          <select name="projectId">
            <option value="">No project</option>
            ${visibleProjects.map((project) => `<option value="${project.id}" ${defaultProjectId === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(task?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            ${Config.taskStatuses.map((status) => `<option value="${status.id}" ${(task?.status || 'backlog') === status.id ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Priority</span>
          <select name="priority">
            ${Config.priorities.map((priority) => `<option value="${priority.id}" ${(task?.priority || 'medium') === priority.id ? 'selected' : ''}>${escapeHtml(priority.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Start date</span>
          <input name="startDate" type="date" value="${escapeHtml(task?.startDate || todayIso())}">
        </label>
        <label class="field">
          <span>Due date</span>
          <input name="dueDate" type="date" value="${escapeHtml(task?.dueDate || todayIso())}">
        </label>
        <label class="field full">
          <span>Progress</span>
          <input name="progress" type="range" min="0" max="100" value="${escapeHtml(task?.progress ?? 0)}">
        </label>
        <fieldset class="field full">
          <span>Assignees</span>
          <div class="pill-list">
            ${assignableUsers.map((user) => `
              <label class="person-pill">
                <input type="checkbox" name="assigneeIds" value="${user.id}" ${(task?.assigneeIds || []).includes(user.id) ? 'checked' : ''}>
                ${avatarHtml(user)} ${escapeHtml(user.nick)}
              </label>
            `).join('')}
          </div>
        </fieldset>
        <fieldset class="field full">
          <div class="row-between">
            <span>Subtasks</span>
            <button class="secondary-button" type="button" data-action="subtask-row-add">+ Add subtask</button>
          </div>
          <div class="subtask-editor-list" data-subtask-editor-list>
            ${renderSubtaskEditorRows(task?.subtasks || [])}
          </div>
        </fieldset>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save task</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function openProjectModal(projectId) {
    const project = projectId ? getProject(projectId) : null;
    if (project && !canEditProject(project)) return;
    if (!project && !canCreateProject()) return;
    const assignableUsers = state.data.users.filter((user) => canAssign(currentUser(), user) || user.id === currentUser()?.id);
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${project ? 'Edit project' : 'Create project'}</h3>
          <div class="muted">public/secret visibility and member assignment</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="project">
        <input type="hidden" name="id" value="${escapeHtml(project?.id || '')}">
        <label class="field full">
          <span>Project name</span>
          <input name="name" required value="${escapeHtml(project?.name || '')}">
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea name="description">${escapeHtml(project?.description || '')}</textarea>
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(project?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Start date</span>
          <input name="startDate" type="date" value="${escapeHtml(project?.startDate || '')}">
        </label>
        <label class="field">
          <span>Deadline</span>
          <input name="deadline" type="date" value="${escapeHtml(project?.deadline || todayIso())}">
        </label>
        <label class="field">
          <span>Accent color</span>
          ${renderColorPicker(project?.color || '#6d28d9')}
        </label>
        <label class="field switch-line">
          <span>Secret project</span>
          <input name="isSecret" type="checkbox" ${project?.isSecret ? 'checked' : ''}>
        </label>
        <fieldset class="field full">
          <span>Members</span>
          <div class="pill-list">
            ${assignableUsers.map((user) => `
              <label class="person-pill">
                <input type="checkbox" name="memberIds" value="${user.id}" ${(project?.memberIds || [currentUser()?.id]).includes(user.id) ? 'checked' : ''}>
                ${avatarHtml(user)} ${escapeHtml(user.nick)}
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save project</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function openMeetingModal(meetingId) {
    const meeting = meetingId ? getMeeting(meetingId) : null;
    const attendees = state.data.users;
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${meeting ? 'Edit meeting' : 'Schedule meeting'}</h3>
          <div class="muted">easy date/time flow starting from current time</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="meeting">
        <input type="hidden" name="id" value="${escapeHtml(meeting?.id || '')}">
        <label class="field full">
          <span>Title</span>
          <input name="title" required value="${escapeHtml(meeting?.title || '')}">
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea name="description">${escapeHtml(meeting?.description || '')}</textarea>
        </label>
        <label class="field">
          <span>Start</span>
          <input name="startAt" type="datetime-local" value="${escapeHtml(meeting?.startAt || nowLocalInput())}">
        </label>
        <label class="field">
          <span>End</span>
          <input name="endAt" type="datetime-local" value="${escapeHtml(meeting?.endAt || new Date(new Date().getTime() + 60 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))}">
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(meeting?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Location</span>
          <input name="location" value="${escapeHtml(meeting?.location || '')}">
        </label>
        <label class="field full">
          <span>Notes</span>
          <textarea name="notes">${escapeHtml(meeting?.notes || '')}</textarea>
        </label>
        <fieldset class="field full">
          <span>Attendees</span>
          <div class="pill-list">
            ${attendees.map((user) => `
              <label class="person-pill">
                <input type="checkbox" name="attendeeIds" value="${user.id}" ${(meeting?.attendeeIds || []).includes(user.id) ? 'checked' : ''}>
                ${avatarHtml(user)} ${escapeHtml(user.nick)}
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class="field full" style="grid-column:1 / -1;">
          <span>Attachments</span>
          <div class="attachment-form">
            <label class="comment-file-button attachment-drop">
              📎 Attach files
              <input type="file" name="meetingAttachments" multiple>
            </label>
            <span class="attachment-status" data-file-status>No file selected</span>
          </div>
          ${(meeting?.attachments || []).filter((a) => !a.deletedAt).length ? renderAttachmentList(meeting.attachments.filter((a) => !a.deletedAt), true, { entityType: 'meeting', meetingId: meeting?.id }) : ''}
        </div>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save meeting</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function openBriefModal(briefId) {
    const brief = briefId ? getBrief(briefId) : null;
    if (brief && !canEditBrief(brief)) return;
    if (!brief && !['admin', 'ceo', 'executive', 'head'].includes(currentUser()?.access)) return;
    const projects = getVisibleProjects();
    const assignable = state.data.users.filter((user) => canAssign(currentUser(), user) || user.id === currentUser()?.id);
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${brief ? 'Edit brief' : 'Create CEO brief'}</h3>
          <div class="muted">restricted visibility with optional conversion to task</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="brief">
        <input type="hidden" name="id" value="${escapeHtml(brief?.id || '')}">
        <label class="field full">
          <span>Title</span>
          <input name="title" required value="${escapeHtml(brief?.title || '')}">
        </label>
        <label class="field full">
          <span>Brief body</span>
          <textarea name="body">${escapeHtml(brief?.body || '')}</textarea>
        </label>
        <label class="field">
          <span>Priority</span>
          <select name="priority">
            ${Config.priorities.map((priority) => `<option value="${priority.id}" ${(brief?.priority || 'medium') === priority.id ? 'selected' : ''}>${escapeHtml(priority.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            ${['draft', 'assigned', 'inprogress', 'done'].map((status) => `<option value="${status}" ${(brief?.status || 'draft') === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(brief?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Due date</span>
          <input name="dueDate" type="date" value="${escapeHtml(brief?.dueDate || todayIso())}">
        </label>
        <label class="field full">
          <span>Project</span>
          <select name="projectId">
            <option value="">No project</option>
            ${projects.map((project) => `<option value="${project.id}" ${(brief?.projectId || '') === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
          </select>
        </label>
        <fieldset class="field full">
          <span>Visible / Assigned to</span>
          <div class="pill-list">
            ${assignable.map((user) => `
              <label class="person-pill">
                <input type="checkbox" name="assigneeIds" value="${user.id}" ${(brief?.assigneeIds || []).includes(user.id) ? 'checked' : ''}>
                ${avatarHtml(user)} ${escapeHtml(user.nick)}
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class="field full" style="grid-column:1 / -1;">
          <span>Attachments</span>
          <div class="attachment-form">
            <label class="comment-file-button attachment-drop">
              📎 Attach files
              <input type="file" name="briefAttachments" multiple>
            </label>
            <span class="attachment-status" data-file-status>No file selected</span>
          </div>
          ${(brief?.attachments || []).filter((a) => !a.deletedAt).length ? renderAttachmentList(brief.attachments.filter((a) => !a.deletedAt), true, { entityType: 'brief', briefId: brief?.id }) : ''}
        </div>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save brief</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function openUserModal(userId) {
    const target = userId ? getUser(userId) : null;
    if (target && !canEditUser(target)) return;
    if (!target && !canCreateUser()) return;
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${target ? 'Edit user' : 'Add user'}</h3>
          <div class="muted">admin controls access level and department</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="user">
        <input type="hidden" name="id" value="${escapeHtml(target?.id || '')}">
        <label class="field">
          <span>Name</span>
          <input name="name" required value="${escapeHtml(target?.name || '')}">
        </label>
        <label class="field">
          <span>Nickname</span>
          <input name="nick" required value="${escapeHtml(target?.nick || '')}">
        </label>
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" value="${escapeHtml(target?.email || '')}">
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" value="" placeholder="Leave blank to keep current password">
        </label>
        <label class="field">
          <span>Role title</span>
          <input name="roleTitle" value="${escapeHtml(target?.roleTitle || '')}">
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(target?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Access</span>
          <select name="access" ${canManageUsers() ? '' : 'disabled'}>
            ${Object.keys(Config.roles).map((access) => `<option value="${access}" ${(target?.access || 'member') === access ? 'selected' : ''}>${escapeHtml(Config.roles[access].label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            ${['online', 'busy', 'away', 'offline'].map((status) => `<option value="${status}" ${(target?.status || 'online') === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
          </select>
        </label>
        <label class="field full">
          <span>Profile color</span>
          ${renderColorPicker(target?.color || randomUserColor())}
        </label>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save user</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function openChangePasswordModal() {
    const me = currentUser();
    if (!me) return;
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">Change password</h3>
          <div class="muted">Enter your current password to confirm, then set a new one</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="change-password">
        <label class="field full">
          <span>Current password</span>
          <input name="current" type="password" autocomplete="current-password" required placeholder="Your current password">
        </label>
        <label class="field">
          <span>New password</span>
          <input name="next" type="password" autocomplete="new-password" required placeholder="New password">
        </label>
        <label class="field">
          <span>Confirm new password</span>
          <input name="confirm" type="password" autocomplete="new-password" required placeholder="Repeat new password">
        </label>
        <div id="pwChangeError" class="login-error" style="grid-column:1/-1;"></div>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save password</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function savePasswordChange(form) {
    const me = currentUser();
    if (!me) return;
    const current = form.elements.current.value;
    const next    = form.elements.next.value.trim();
    const confirm = form.elements.confirm.value.trim();
    const errEl   = form.querySelector('#pwChangeError');

    if (!verifyPassword(current, me.password)) {
      if (errEl) errEl.textContent = 'Current password is incorrect.';
      return;
    }
    if (!next || next.length < 4) {
      if (errEl) errEl.textContent = 'New password must be at least 4 characters.';
      return;
    }
    if (next !== confirm) {
      if (errEl) errEl.textContent = 'Passwords do not match.';
      return;
    }

    me.password = hashPassword(next);
    saveSnapshot();
    queueRemoteUpsert('user', me);
    closeModal();
    showToast('Password changed', 'Your password has been updated.');
  }

  function openDepartmentModal(departmentId) {
    if (!canManageUsers()) return;
    const department = departmentId ? getDepartment(departmentId) : null;
    const nextOrder = (Math.max(0, ...state.data.departments.map((item) => Number(item.order || 0))) + 1);
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${department ? 'Edit department' : 'Add department'}</h3>
          <div class="muted">admin controls org grouping used by users, projects, tasks, and briefs</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="department">
        <input type="hidden" name="id" value="${escapeHtml(department?.id || '')}">
        <label class="field">
          <span>Name</span>
          <input name="name" required value="${escapeHtml(department?.name || '')}">
        </label>
        <label class="field">
          <span>Color</span>
          ${renderColorPicker(department?.color || '#64748b')}
        </label>
        <label class="field">
          <span>Sort order</span>
          <input name="order" type="number" value="${escapeHtml(department?.order ?? nextOrder)}">
        </label>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save department</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function formArray(form, name) {
    return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
  }

  function validateSubtaskWithinTaskRange(subtask, task) {
    const taskStart = task.startDate || '';
    const taskDue = task.dueDate || '';
    if (!taskStart || !taskDue) {
      return { ok: false, message: 'Task must have both start and due date before saving subtasks' };
    }
    if (subtask.startDate && subtask.startDate < taskStart) {
      return { ok: false, message: `Subtask "${subtask.title || 'Untitled'}" cannot start before task start date` };
    }
    if (subtask.dueDate && subtask.dueDate > taskDue) {
      return { ok: false, message: `Subtask "${subtask.title || 'Untitled'}" cannot end after task due date` };
    }
    if (subtask.startDate && subtask.startDate > taskDue) {
      return { ok: false, message: `Subtask "${subtask.title || 'Untitled'}" is outside the task deadline` };
    }
    if (subtask.dueDate && subtask.dueDate < taskStart) {
      return { ok: false, message: `Subtask "${subtask.title || 'Untitled'}" is before the task timeline` };
    }
    return { ok: true };
  }

  function expandTaskRangeToFitSubtasks(task, subtasks = []) {
    const dated = subtasks.filter((item) => item.startDate || item.dueDate);
    if (!dated.length) return { changed: false, startDate: task.startDate || '', dueDate: task.dueDate || '' };

    const starts = dated.map((item) => item.startDate || item.dueDate).filter(Boolean).sort();
    const dues = dated.map((item) => item.dueDate || item.startDate).filter(Boolean).sort();
    const nextStart = [task.startDate || '', starts[0] || ''].filter(Boolean).sort()[0] || '';
    const nextDue = [task.dueDate || '', dues[dues.length - 1] || ''].filter(Boolean).sort().slice(-1)[0] || '';

    const changed = nextStart !== (task.startDate || '') || nextDue !== (task.dueDate || '');
    task.startDate = nextStart;
    task.dueDate = nextDue;
    return { changed, startDate: nextStart, dueDate: nextDue };
  }

  function saveSubtask(form) {
    const task = getTask(form.elements.taskId.value);
    if (!task || !canEditTask(task)) return;
    const subtasks = (task.subtasks || []).map(normalizeSubtask);
    const id = form.elements.id.value || uid('st');
    const done = !!form.elements.done.checked;
    const next = normalizeSubtask({
      id,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      status: done ? 'approve' : form.elements.status.value,
      progress: done ? 100 : Number(form.elements.progress.value || 0),
      startDate: form.elements.startDate.value,
      dueDate: form.elements.dueDate.value,
      done,
    });

    if (!next.title) {
      showToast('Subtask not saved', 'Subtask title is required');
      return;
    }
    if (next.startDate && next.dueDate && next.dueDate < next.startDate) {
      showToast('Subtask not saved', 'Due date must be after start date');
      return;
    }

    const idx = subtasks.findIndex((item) => item.id === id);
    if (idx >= 0) subtasks[idx] = next;
    else subtasks.push(next);
    task.subtasks = subtasks;
    const expanded = expandTaskRangeToFitSubtasks(task, subtasks);
    task.progress = recalcTaskProgress(task);
    logTaskActivity(task, `updated subtask "${next.title}"`);
    saveSnapshot();
    queueRemoteUpsert('task', task);
    closeModal();
    refreshApp();
    if (task.projectId) openProjectDrawer(task.projectId);
    else openTaskDrawer(task.id);
    showToast('Subtask saved', expanded.changed ? `${next.title} and task timeline updated` : next.title);
  }

  function saveTaskLegacy(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('t');
    const task = form.elements.id.value ? getTask(id) : null;
    if (task && !canEditTask(task, actor)) return;

    const assigneeIds = formArray(form, 'assigneeIds');
    const subtasks = parseSubtasksFromForm(form);
    const next = {
      id,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      projectId: form.elements.projectId.value,
      departmentId: form.elements.departmentId.value,
      createdBy: task?.createdBy || actor.id,
      assigneeIds,
      status: form.elements.status.value,
      priority: form.elements.priority.value,
      progress: Number(form.elements.progress.value || 0),
      startDate: form.elements.startDate.value,
      dueDate: form.elements.dueDate.value,
      parentTaskId: task?.parentTaskId || null,
      subtasks: task?.subtasks || [],
      comments: task?.comments || [],
      activity: task?.activity || [],
    };

    if (!next.title) {
      showToast('Task not saved', 'Title is required');
      return;
    }

    if (next.startDate && next.dueDate && next.dueDate < next.startDate) {
      showToast('Task not saved', 'Due date must be after start date');
      return;
    }

    if (subtasks.some((item) => item.startDate && item.dueDate && item.dueDate < item.startDate)) {
      showToast('Task not saved', 'Each subtask due date must be after its start date');
      return;
    }

    if (!assigneeIds.every((userId) => canAssign(actor, getUser(userId)))) {
      showToast('Task not saved', 'You cannot assign at least one selected user');
      return;
    }

    const expanded = expandTaskRangeToFitSubtasks(next, subtasks);
    logTaskActivity(next, task ? 'updated task' : 'created task');
    if (task) {
      Object.assign(task, next);
    } else {
      state.data.tasks.unshift(next);
    }
    assigneeIds.filter((userId) => userId !== actor.id).forEach((userId) => {
      createNotification(userId, 'task', 'New task assigned', `${next.title} was assigned to you`, 'task', next.id);
    });
    saveSnapshot();
    queueRemoteUpsert('task', next);
    closeModal();
    refreshApp();
    showToast('Task saved', expanded.changed ? `${next.title} timeline expanded to fit subtasks` : next.title);
  }

  function saveProject(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('p');
    const project = form.elements.id.value ? getProject(id) : null;
    if (project && !canEditProject(project, actor)) return;
    if (!project && !canCreateProject(actor)) return;

    const memberIds = Array.from(new Set([actor.id].concat(formArray(form, 'memberIds'))));
    const next = {
      id,
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      departmentId: form.elements.departmentId.value,
      startDate: form.elements.startDate?.value || '',
      deadline: form.elements.deadline.value,
      color: form.elements.color.value,
      ownerId: project?.ownerId || actor.id,
      memberIds,
      isSecret: form.elements.isSecret.checked,
      status: project?.status || 'active',
    };

    if (!next.name) {
      showToast('Project not saved', 'Project name is required');
      return;
    }

    if (project) {
      Object.assign(project, next);
    } else {
      state.data.projects.unshift(next);
    }
    saveSnapshot();
    queueRemoteUpsert('project', next);
    closeModal();
    refreshApp();
    showToast('Project saved', next.name);
  }

  function saveMeeting(form) {
    if (!canCreateMeeting()) return;
    const id = form.elements.id.value || uid('m');
    const meeting = form.elements.id.value ? getMeeting(id) : null;
    const previousAttendeeIds = meeting?.attendeeIds || [];
    const fileInput = form.elements.meetingAttachments;
    const files = fileInput ? Array.from(fileInput.files || []) : [];
    const next = {
      id,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      startAt: form.elements.startAt.value,
      endAt: form.elements.endAt.value,
      departmentId: form.elements.departmentId.value,
      location: form.elements.location.value.trim(),
      notes: form.elements.notes.value.trim(),
      attendeeIds: formArray(form, 'attendeeIds'),
      attachments: meeting?.attachments || [],
      createdBy: meeting?.createdBy || currentUser().id,
      createdAt: meeting?.createdAt || nowIso(),
    };

    if (!next.title) {
      showToast('Meeting not saved', 'Meeting title is required');
      return;
    }

    if (next.endAt && next.startAt && next.endAt < next.startAt) {
      showToast('Meeting not saved', 'End must be after start');
      return;
    }

    if (meeting) {
      Object.assign(meeting, next);
    } else {
      state.data.meetings.unshift(next);
    }
    notifyNewAssignments(previousAttendeeIds, next.attendeeIds, currentUser().id, 'meeting', 'Meeting added', () => `${next.title} was added to your schedule`, 'meeting', next.id);
    saveSnapshot();
    queueRemoteUpsert('meeting', next);
    closeModal();
    refreshApp();
    showToast('Meeting saved', next.title);

    // Upload attachments after modal closes
    if (files.length) {
      readAttachmentFiles(files).then((newAttachments) => {
        const target = getMeeting(id);
        if (target) {
          target.attachments = [...(target.attachments || []), ...newAttachments];
          saveSnapshot();
          queueRemoteUpsert('meeting', target);
          refreshApp();
          showToast('Files attached', `${newAttachments.length} file(s) added to meeting`);
        }
      }).catch((err) => showToast('Attachment error', err.message));
    }
  }

  function saveBrief(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('b');
    const brief = form.elements.id.value ? getBrief(id) : null;
    if (brief && !canEditBrief(brief, actor)) return;

    const assigneeIds = formArray(form, 'assigneeIds');
    if (!assigneeIds.every((userId) => canAssign(actor, getUser(userId)))) {
      showToast('Brief not saved', 'You cannot assign one of the selected users');
      return;
    }

    const fileInput = form.elements.briefAttachments;
    const files = fileInput ? Array.from(fileInput.files || []) : [];
    const next = {
      id,
      title: form.elements.title.value.trim(),
      body: form.elements.body.value.trim(),
      priority: form.elements.priority.value,
      status: form.elements.status.value,
      departmentId: form.elements.departmentId.value,
      dueDate: form.elements.dueDate.value,
      projectId: form.elements.projectId.value,
      assigneeIds,
      attachments: brief?.attachments || [],
      createdBy: brief?.createdBy || actor.id,
      createdAt: brief?.createdAt || nowIso(),
      linkedTaskId: brief?.linkedTaskId || null,
    };

    if (!next.title) {
      showToast('Brief not saved', 'Brief title is required');
      return;
    }

    if (brief) {
      Object.assign(brief, next);
    } else {
      state.data.briefs.unshift(next);
    }
    assigneeIds.filter((userId) => userId !== actor.id).forEach((userId) => {
      createNotification(userId, 'brief', 'CEO brief assigned', `${next.title} is now visible to you`, 'brief', next.id);
    });
    saveSnapshot();
    queueRemoteUpsert('brief', next);
    closeModal();
    refreshApp();
    showToast('Brief saved', next.title);

    // Upload attachments after modal closes
    if (files.length) {
      readAttachmentFiles(files).then((newAttachments) => {
        const target = getBrief(id);
        if (target) {
          target.attachments = [...(target.attachments || []), ...newAttachments];
          saveSnapshot();
          queueRemoteUpsert('brief', target);
          refreshApp();
          showToast('Files attached', `${newAttachments.length} file(s) added to brief`);
        }
      }).catch((err) => showToast('Attachment error', err.message));
    }
  }

  function remoteNotificationRow(notification) {
    return {
      id: notification.id,
      icon: notification.icon || '',
      user_id: notification.userId,
      type: notification.type || 'general',
      title: notification.title || 'Notification',
      body: notification.body || '',
      time: notification.time || '',
      unread: !notification.readAt,
      ref_type: notification.refType || null,
      ref_id: notification.refId || null,
      created_at: notification.createdAt || nowIso(),
      read_at: notification.readAt || null,
    };
  }

  function queueRemoteUpsert(kind, record) {
    if (!Config.supabase.enabled) return;
    let table = null;
    let payload = null;

    if (kind === 'department') { table = 'departments'; payload = remoteDepartmentRow(record); }
    if (kind === 'task') { table = 'tasks'; payload = remoteTaskRow(record); }
    if (kind === 'project') { table = 'projects'; payload = remoteProjectRow(record); }
    if (kind === 'meeting') { table = 'meetings'; payload = remoteMeetingRow(record); }
    if (kind === 'brief') { table = 'ceo_briefs'; payload = remoteBriefRow(record); }
    if (kind === 'user') { table = 'users'; payload = remoteUserRow(record); }
    if (kind === 'notification') { table = 'notifications'; payload = remoteNotificationRow(record); }
    if (!table || !payload) return;

    const syncJob = kind === 'department'
      ? syncRemoteDepartment(record, payload)
      : adapter.upsert(table, payload);

    syncJob.catch((error) => {
      console.warn(`Remote sync failed for ${kind}`, error);
      const detail = String(error?.message || error || '')
        .replace(/\s+/g, ' ')
        .slice(0, 220);
      showToast('Sync failed', detail || `${kind} could not be saved to database`);
    });
  }

  function createNotification(userId, type, title, body, refType, refId) {
    if (!userId) return;
    const notification = {
      id: uid('n'),
      userId,
      type,
      title,
      body,
      refType: refType || null,
      refId: refId || null,
      createdAt: nowIso(),
      readAt: null,
    };
    state.data.notifications.unshift(notification);
    saveSnapshot();
    queueRemoteUpsert('notification', notification);
  }

  function notifyNewAssignments(previousIds, nextIds, actorId, type, title, bodyBuilder, refType, refId) {
    const before = new Set(previousIds || []);
    Array.from(new Set(nextIds || []))
      .filter((userId) => userId && userId !== actorId && !before.has(userId))
      .forEach((userId) => {
        createNotification(userId, type, title, bodyBuilder(userId), refType, refId);
      });
  }

  function notifyTaskComment(task, targetType, targetId, comment) {
    const actor = getUser(comment.authorId);
    const subtask = targetType === 'subtask'
      ? (task.subtasks || []).map(normalizeSubtask).find((item) => item.id === targetId)
      : null;
    const targetTitle = subtask?.title || task.title;
    Array.from(new Set(task.assigneeIds || []))
      .filter((userId) => userId && userId !== comment.authorId)
      .forEach((userId) => {
        createNotification(
          userId,
          'comment',
          'New comment',
          `${actor?.nick || actor?.name || 'Someone'} commented on ${targetTitle}`,
          'task',
          task.id
        );
      });
  }

  function openNotificationTarget(notificationId) {
    const notification = byId(state.data.notifications, notificationId);
    if (!notification || notification.userId !== currentUser()?.id) return;
    if (!notification.readAt) {
      notification.readAt = nowIso();
      saveSnapshot();
      queueRemoteUpsert('notification', notification);
    }
    if (notification.refType === 'task') openTaskDrawer(notification.refId);
    if (notification.refType === 'brief') openBriefDrawer(notification.refId);
    if (notification.refType === 'meeting') openMeetingDrawer(notification.refId);
    refreshApp();
  }

  function markNotificationRead(notificationId) {
    const notification = byId(state.data.notifications, notificationId);
    if (!notification || notification.userId !== currentUser()?.id) return;
    notification.readAt = nowIso();
    saveSnapshot();
    queueRemoteUpsert('notification', notification);
    refreshApp();
  }

  function markAllNotificationsRead() {
    getVisibleNotifications().forEach((notification) => {
      notification.readAt = nowIso();
      queueRemoteUpsert('notification', notification);
    });
    saveSnapshot();
    refreshApp();
  }

  function convertBriefToTask(briefId) {
    const brief = getBrief(briefId);
    if (!brief || !canEditBrief(brief)) return;
    if (brief.linkedTaskId) {
      showToast('Brief already linked', 'This brief already has a task');
      return;
    }
    const task = {
      id: uid('t'),
      title: `[CEO Brief] ${brief.title}`,
      description: brief.body,
      projectId: brief.projectId || '',
      departmentId: brief.departmentId,
      createdBy: currentUser().id,
      assigneeIds: brief.assigneeIds || [],
      status: normalizeWorkflowStatus(brief.status || 'assigned'),
      priority: brief.priority,
      progress: Number(brief.progress || 0),
      startDate: brief.startDate || todayIso(),
      dueDate: brief.dueDate,
      parentTaskId: null,
      subtasks: [],
      comments: [],
      attachments: brief.attachments || [],
      activity: [],
      createdAt: nowIso(),
    };
    logTaskActivity(task, `created from brief ${brief.title}`);
    brief.linkedTaskId = task.id;
    state.data.tasks.unshift(task);
    saveSnapshot();
    queueRemoteUpsert('task', task);
    queueRemoteUpsert('brief', brief);
    refreshApp();
    openTaskDrawer(task.id);
    showToast('Task created', 'CEO brief was converted to task');
  }

  function openEntityModal(entity, id, context) {
    if (entity === 'task') openTaskModal(id, context);
    if (entity === 'subtask') openSubtaskModal(context, id);
    if (entity === 'project') openProjectModal(id);
    if (entity === 'meeting') openMeetingModal(id);
    if (entity === 'brief') openBriefModal(id, context);
    if (entity === 'user') openUserModal(id);
    if (entity === 'department') openDepartmentModal(id);
  }

  function saveUser(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('u');
    const target = form.elements.id.value ? getUser(id) : null;
    if (target && !canEditUser(target, actor)) return;
    if (!target && !canCreateUser(actor)) return;

    const accessValue = canManageUsers(actor) ? form.elements.access.value : (target?.access || actor.access);
    const next = {
      id,
      name: form.elements.name.value.trim(),
      nick: form.elements.nick.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value.trim()
        ? hashPassword(form.elements.password.value.trim())
        : (target?.password || hashPassword('1234')),
      roleTitle: form.elements.roleTitle.value.trim() || 'Team Member',
      departmentId: form.elements.departmentId.value,
      access: normalizeAccess(accessValue),
      status: form.elements.status.value,
      levelTitle: roleMeta(normalizeAccess(accessValue)).label,
      color: form.elements.color.value || target?.color || randomUserColor(),
      createdAt: target?.createdAt || nowIso(),
    };

    if (!next.name || !next.nick) {
      showToast('User not saved', 'Name and nickname are required');
      return;
    }

    if (target) {
      Object.assign(target, next);
    } else {
      state.data.users.push(next);
    }
    saveSnapshot();
    queueRemoteUpsert('user', next);
    closeModal();
    refreshApp();
    showToast('User saved', next.name);
  }

  function saveDepartment(form) {
    if (!canManageUsers()) return;
    const name = form.elements.name.value.trim();
    const id = form.elements.id.value || canonicalDepartmentId(name);
    const existing = form.elements.id.value ? getDepartment(id) : null;
    const next = {
      id,
      remoteId: existing?.remoteId || id,
      name,
      color: form.elements.color.value || '#64748b',
      order: Number(form.elements.order.value || 0),
      createdAt: existing?.createdAt || nowIso(),
    };

    if (!next.name) {
      showToast('Department not saved', 'Department name is required');
      return;
    }

    const conflict = state.data.departments.find((department) => department.id !== id && normalizeText(department.name) === normalizeText(next.name));
    if (conflict) {
      showToast('Department not saved', 'Department name already exists');
      return;
    }

    if (existing) {
      Object.assign(existing, next);
    } else {
      state.data.departments.push(next);
    }

    state.data.departments.sort((a, b) => a.order - b.order);
    saveSnapshot();
    queueRemoteUpsert('department', next);
    closeModal();
    refreshApp();
    showToast('Department saved', next.name);
  }

  function ensureFallbackDepartment() {
    let fallback = state.data.departments.find((department) => department.id === 'unassigned');
    if (!fallback) {
      fallback = {
        id: 'unassigned',
        name: 'Unassigned',
        color: '#94a3b8',
        order: Math.max(0, ...state.data.departments.map((department) => Number(department.order || 0))) + 1,
        createdAt: nowIso(),
      };
      state.data.departments.push(fallback);
      queueRemoteUpsert('department', fallback);
    }
    return fallback;
  }

  function deleteDepartment(departmentId) {
    if (!canManageUsers()) return;
    const department = getDepartment(departmentId);
    if (!department) return;
    if (state.data.departments.length <= 1) {
      showToast('Department not deleted', 'At least one department must remain');
      return;
    }
    if (!window.confirm(`Delete department "${department.name}"?\nAll members and items will be moved to another department.`)) return;

    const fallback = ensureFallbackDepartment();
    const targetId = fallback.id === departmentId
      ? state.data.departments.find((item) => item.id !== departmentId)?.id
      : fallback.id;

    state.data.users.forEach((user) => {
      if (user.departmentId === departmentId) {
        user.departmentId = targetId;
        user.dept = targetId;
        queueRemoteUpsert('user', user);
      }
    });
    state.data.projects.forEach((project) => {
      if (project.departmentId === departmentId) {
        project.departmentId = targetId;
        project.dept = targetId;
        queueRemoteUpsert('project', project);
      }
    });
    state.data.tasks.forEach((task) => {
      if (task.departmentId === departmentId) {
        task.departmentId = targetId;
        task.dept = targetId;
        queueRemoteUpsert('task', task);
      }
    });
    state.data.briefs.forEach((brief) => {
      if (brief.departmentId === departmentId) {
        brief.departmentId = targetId;
        brief.dept = targetId;
        queueRemoteUpsert('brief', brief);
      }
    });
    state.data.meetings.forEach((meeting) => {
      if (meeting.departmentId === departmentId) {
        meeting.departmentId = targetId;
        meeting.dept = targetId;
        queueRemoteUpsert('meeting', meeting);
      }
    });

    state.data.departments = state.data.departments.filter((item) => item.id !== departmentId).sort((a, b) => a.order - b.order);
    if (state.activeDepartment === departmentId) state.activeDepartment = 'all';
    saveSnapshot();
    queueRemoteDelete('department', department.remoteId || departmentId);
    refreshApp();
    showToast('Department deleted', `${department.name} moved to ${getDepartment(targetId)?.name || 'Unassigned'}`);
  }

  function deleteTask(taskId) {
    const task = getTask(taskId);
    if (!task || !canDeleteTask(task)) return;
    if (!window.confirm(`Delete task "${task.title}"?\nThis action cannot be undone.`)) return;
    state.data.tasks = state.data.tasks.filter((item) => item.id !== taskId);
    state.data.briefs.forEach((brief) => {
      if (brief.linkedTaskId === taskId) brief.linkedTaskId = null;
    });
    saveSnapshot();
    queueRemoteDelete('task', taskId);
    closeDrawer();
    refreshApp();
    showToast('Task deleted', task.title);
  }

  function deleteProject(projectId) {
    const project = getProject(projectId);
    if (!project || !canEditProject(project)) return;
    const orphanTasks = state.data.tasks.filter((task) => task.projectId === projectId);
    const taskCount = orphanTasks.length;
    const confirmMsg = taskCount
      ? `Delete project "${project.name}"?\n\n${taskCount} task(s) will be permanently deleted.\nThis action cannot be undone.`
      : `Delete project "${project.name}"? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    // Delete project
    state.data.projects = state.data.projects.filter((item) => item.id !== projectId);
    queueRemoteDelete('project', projectId);

    // Cascade delete all tasks belonging to this project
    const orphanIds = new Set(orphanTasks.map((task) => task.id));
    state.data.tasks = state.data.tasks.filter((task) => !orphanIds.has(task.id));
    orphanTasks.forEach((task) => queueRemoteDelete('task', task.id));

    // Unlink briefs (preserve content, remove project association)
    state.data.briefs.forEach((brief) => {
      if (brief.projectId === projectId) {
        brief.projectId = '';
        queueRemoteUpsert('brief', brief);
      }
    });

    saveSnapshot();
    closeDrawer();
    refreshApp();
    showToast('Project deleted', taskCount ? `${project.name} and ${taskCount} task(s) deleted` : project.name);
  }

  function deleteUser(userId) {
    const target = getUser(userId);
    if (!target || !canDeleteUser(target)) return;
    if (!window.confirm(`Delete user "${target.name}"?\nThis will remove them from all tasks and projects.`)) return;
    state.data.users = state.data.users.filter((item) => item.id !== userId);
    state.data.tasks.forEach((task) => {
      task.assigneeIds = (task.assigneeIds || []).filter((id) => id !== userId);
      if (task.createdBy === userId) task.createdBy = currentUser().id;
    });
    state.data.projects.forEach((project) => {
      project.memberIds = (project.memberIds || []).filter((id) => id !== userId);
      if (project.ownerId === userId) project.ownerId = currentUser().id;
    });
    state.data.briefs.forEach((brief) => {
      brief.assigneeIds = (brief.assigneeIds || []).filter((id) => id !== userId);
      if (brief.createdBy === userId) brief.createdBy = currentUser().id;
    });
    saveSnapshot();
    queueRemoteDelete('user', userId);
    refreshApp();
    showToast('User deleted', target.name);
  }

  function markNotificationRead(notificationId) {
    const notification = byId(state.data.notifications, notificationId);
    if (!notification || notification.userId !== currentUser()?.id) return;
    notification.readAt = nowIso();
    saveSnapshot();
    refreshApp();
  }

  function markAllNotificationsRead() {
    getVisibleNotifications().forEach((notification) => {
      notification.readAt = nowIso();
    });
    saveSnapshot();
    refreshApp();
  }

  function randomUserColor() {
    const palette = ['#6d28d9', '#2563eb', '#ec4899', '#14b8a6', '#f97316', '#10b981'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function filterWorkItemsByActiveDepartment(items) {
    if (state.activeDepartment === 'all') return items;
    return items.filter((item) => item.departmentId === state.activeDepartment);
  }

  function getBoardWorkItems() {
    const user = currentUser();
    const query = state.filters.taskSearch.trim().toLowerCase();
    return filterWorkItemsByActiveDepartment(getVisibleWorkItems(user))
      .filter((item) => state.filters.taskProject === 'all' || item.projectId === state.filters.taskProject)
      .filter((item) => state.filters.taskDept === 'all' || item.departmentId === state.filters.taskDept)
      .filter((item) => !state.filters.taskMine || item.assigneeIds.includes(user.id) || item.createdBy === user.id)
      .filter((item) => {
        if (!query) return true;
        const project = getProject(item.projectId);
        const pool = [
          item.title,
          item.description,
          item.originLabel,
          project?.name,
          ...item.assigneeIds.map((id) => getUser(id)?.name || ''),
        ].join(' ').toLowerCase();
        return pool.includes(query);
      })
      .sort(compareWorkItems);
  }

  // ── Board card helpers ──────────────────────────────────────────────
  function originLabelChip(item) {
    const isBrief = item.kind === 'brief' || item.originLabel === 'CEO Brief';
    const color = isBrief ? '#22c55e' : '#64748b';
    return `<span class="tag-chip" style="background:${hexToAlpha(color, 0.13)};color:${color};border-color:${hexToAlpha(color, 0.26)};">${escapeHtml(item.originLabel)}</span>`;
  }

  function renderWorkItemCard(item) {
    const project = getProject(item.projectId);
    const overdue = isOverdue(item);
    const isComplete = isCompleteStatus(item.status);
    const subtasks = (item.subtasks || []).slice(0, 2);
    const progress = taskProgress(item);
    const sourceTask = item.sourceType === 'task' ? getTask(item.sourceId) : null;
    const commentCount = sourceTask ? commentsForTarget(sourceTask, 'task', sourceTask.id).length : 0;
    const dueLabel = item.dueDate ? `${overdue ? 'Overdue' : 'Due'} ${formatDate(item.dueDate)}` : 'No due date';
    const projectColor = safeColor(project?.color || item.color || '#6d28d9');
    const assignees = item.assigneeIds.slice(0, 3).map((id) => {
      const user = getUser(id);
      return user ? `<span class="person-pill">${avatarHtml(user)} ${escapeHtml(user.nick)}</span>` : '';
    }).join('');
    return `
      <button class="task-card ${isComplete ? 'is-complete' : ''}" type="button" data-action="${item.openAction}" data-id="${item.sourceId}">
        <div class="task-card-project" style="border-left-color:${projectColor};color:${projectColor};">
          ${escapeHtml(project ? project.name : 'No project')}
        </div>
        <div class="task-card-top">
          <div class="task-card-tags">
            ${priorityChip(item.priority)}
            ${originLabelChip(item)}
          </div>
          ${statusChip(item.status)}
        </div>
        <div class="task-card-main">
          <strong class="task-card-title">${escapeHtml(item.title)}</strong>
          <div class="task-card-desc">${escapeHtml((item.description || '').slice(0, 120) || 'No description')}</div>
        </div>
        <div class="task-card-progress-row">
          <div class="progress compact"><span style="width:${progress}%;background:${projectColor}"></span></div>
          <strong>${progress}%</strong>
        </div>
        <div class="task-card-meta">
          <span style="color:${overdue ? '#ef4444' : 'inherit'}">${dueLabel}</span>
        </div>
        <div class="task-card-footer">
          <div class="pill-list">${assignees || '<span class="muted">Unassigned</span>'}</div>
        </div>
        ${sourceTask && commentCount > 0 ? `
          <span class="task-card-comment-badge" aria-label="comments">
            <small>${commentCount} comment${commentCount === 1 ? '' : 's'}</small>
          </span>
        ` : ''}
        ${subtasks.length ? `
          <div class="task-subtask-preview">
            ${subtasks.map((subtask) => `
              <div class="task-subtask-item ${subtask.done ? 'is-complete' : ''}">
                <div class="row-between">
                  <strong>${escapeHtml(subtask.title)}</strong>
                  ${statusChip(subtask.status)}
                </div>
                <div class="row-meta">
                  <span>${formatDate(subtask.dueDate || subtask.startDate)}</span>
                  <span>${subtaskProgress(subtask)}%</span>
                </div>
              </div>
            `).join('')}
            ${(item.subtasks || []).length > 2 ? `<div class="task-card-more">+ ${(item.subtasks || []).length - 2} more subtasks</div>` : ''}
          </div>
        ` : ''}
      </button>
    `;
  }

  async function syncRemoteDepartment(record, payload) {
    const remoteId = record?.remoteId || record?.id;
    const canonicalName = canonicalDepartmentName(record?.name || record?.id);
    const canonicalId = canonicalDepartmentId(canonicalName);
    const patchPayload = remoteDepartmentPatchRow(record || payload || {});
    const patchFilters = Array.from(new Set([
      remoteId ? `id=eq.${encodeURIComponent(remoteId)}` : null,
      record?.id ? `id=eq.${encodeURIComponent(record.id)}` : null,
      canonicalId ? `id=eq.${encodeURIComponent(canonicalId)}` : null,
      record?.name ? `name=eq.${encodeURIComponent(record.name)}` : null,
      canonicalName ? `name=eq.${encodeURIComponent(canonicalName)}` : null,
    ].filter(Boolean)));
    try {
      for (const filter of patchFilters) {
        const updated = await adapter.patch('departments', filter, patchPayload);
        if (Array.isArray(updated) && updated.length) {
          record.remoteId = updated[0].id || record.remoteId || canonicalId;
          return updated;
        }
      }
      const upsertPayload = { ...payload, id: canonicalId, name: canonicalName };
      const inserted = await adapter.upsert('departments', upsertPayload);
      if (Array.isArray(inserted) && inserted[0]?.id) {
        record.remoteId = inserted[0].id;
      }
      return inserted;
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('departments_name_key') || message.includes('duplicate key value')) {
        for (const filter of patchFilters.filter((filter) => filter.startsWith('name='))) {
          const matched = await adapter.patch('departments', filter, patchPayload);
          if (Array.isArray(matched) && matched[0]?.id) {
            record.remoteId = matched[0].id;
            return matched;
          }
        }
      }
      throw error;
    }
  }

  function projectTimelineBounds(projectId) {
    const items = projectWorkItems(projectId).filter((item) => item.startDate || item.dueDate);
    if (!items.length) return null;
    const starts = items.map((item) => item.startDate || item.dueDate).filter(Boolean).sort();
    const ends = items.map((item) => item.dueDate || item.startDate).filter(Boolean).sort();
    if (!starts.length || !ends.length) return null;
    return {
      start: starts[0],
      end: ends[ends.length - 1],
    };
  }

  function getDashboardTimelineRange(projects) {
    const bounds = projects.map((project) => projectTimelineBounds(project.id)).filter(Boolean);
    if (!bounds.length) {
      const start = startOfWeekIso(todayIso());
      return { start, end: addIsoDays(start, 83), days: 12, mode: 'weekly' };
    }
    const start = bounds.map((item) => item.start).sort()[0];
    const end = bounds.map((item) => item.end).sort().slice(-1)[0];
    const totalDays = Math.max(1, diffDay(start, end) + 1);
    if (totalDays > 180) {
      const monthStart = startOfMonthIso(start);
      const monthEnd = endOfMonthIso(end);
      return { start: monthStart, end: monthEnd, days: monthDiff(monthStart, monthEnd) + 1, mode: 'monthly' };
    }
    const weekStart = startOfWeekIso(start);
    const weekEnd = endOfWeekIso(end);
    return { start: weekStart, end: weekEnd, days: Math.floor(diffDay(weekStart, weekEnd) / 7) + 1, mode: 'weekly' };
  }

  function renderOrgTimelineBar(project, range) {
    const bounds = projectTimelineBounds(project.id);
    const progress = projectProgress(project.id);
    const items = projectWorkItems(project.id);
    if (!bounds) {
      return `
        <div class="org-timeline-row">
          <div class="org-timeline-project">
            <strong>${escapeHtml(project.name)}</strong>
            <div class="row-meta">
              <span>${projectWorkItems(project.id).length} item(s)</span>
              <span>${progress}% progress</span>
            </div>
          </div>
          <div class="org-timeline-track">
            <div class="org-timeline-empty">No task timeline</div>
          </div>
        </div>
      `;
    }

    const startIndex = clamp(sprintBucketIndex(bounds.start, range), 1, range.days);
    const endIndex = clamp(sprintBucketIndex(bounds.end, range), startIndex, range.days);
    const done = items.filter((item) => isCompleteStatus(item.status)).length;

    return `
      <button class="org-timeline-row" type="button" data-action="project-open" data-id="${project.id}">
        <div class="org-timeline-project">
          <div class="row-between">
            <strong>${escapeHtml(project.name)}</strong>
            <span class="tag-chip" style="background:${hexToAlpha(project.color, 0.14)};color:${project.color};border-color:${hexToAlpha(project.color, 0.24)}">${progress}%</span>
          </div>
          <div class="row-meta">
            <span>${escapeHtml(getDepartment(project.departmentId)?.name || 'No department')}</span>
            <span>${done}/${items.length} done</span>
            <span>${formatDate(bounds.start)} to ${formatDate(bounds.end)}</span>
          </div>
        </div>
        <div class="org-timeline-track" style="--days:${range.days}">
          <div class="org-timeline-bar-wrap" style="grid-column:${startIndex} / ${endIndex + 1}">
            <span class="org-timeline-bar" style="background:${project.color}"></span>
          </div>
        </div>
      </button>
    `;
  }

  function renderDashboardTimelineCard(projects) {
    const activeProjects = projects
      .filter((project) => projectWorkItems(project.id).length)
      .sort((a, b) => {
        const aBounds = projectTimelineBounds(a.id);
        const bBounds = projectTimelineBounds(b.id);
        if (!aBounds && !bBounds) return a.name.localeCompare(b.name);
        if (!aBounds) return 1;
        if (!bBounds) return -1;
        return aBounds.start.localeCompare(bBounds.start);
      });
    const range = getDashboardTimelineRange(activeProjects);
    const todayRatio = sprintTodayRatio(range);
    const overallProgress = activeProjects.length
      ? Math.round(activeProjects.reduce((sum, project) => sum + projectProgress(project.id), 0) / activeProjects.length)
      : 0;
    const onTrack = activeProjects.filter((project) => projectProgress(project.id) >= 70).length;

    return `
      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Organization sprint timeline</h3>
            <div class="card-subtitle">company-level roadmap for active projects and delivery pace</div>
          </div>
          <div class="row-meta">
            <span>${overallProgress}% org progress</span>
            <span>${onTrack}/${activeProjects.length || 0} on-track projects</span>
          </div>
        </div>
        <div class="org-timeline-frame">
          ${todayRatio === null ? '' : `<span class="timeline-today-line timeline-today-line-org" ${timelineLineStyle(todayRatio, 'var(--org-timeline-offset)')}></span>`}
          <div class="org-timeline-scale" style="--days:${range.days}">
            ${Array.from({ length: range.days }, (_, index) => `<span>${escapeHtml(sprintBucketLabel(index, range))}</span>`).join('')}
          </div>
          <div class="org-timeline-list">
            ${activeProjects.length ? activeProjects.map((project) => renderOrgTimelineBar(project, range)).join('') : '<div class="empty-copy">No active project timeline yet</div>'}
          </div>
        </div>
      </section>
    `;
  }

  // ── Per-project donut ring rows (replaces progress bar) ───────────────────
  function renderProjectsPieChart(projects) {
    if (!projects.length) return '<div class="empty-copy">No visible projects for this scope yet</div>';

    // SVG donut ring helper — r=13, cx=18,cy=18 → circumference ≈ 81.68
    const circ = 2 * Math.PI * 13; // ≈ 81.68
    function ringPath(pct, color) {
      const dash = ((pct / 100) * circ).toFixed(2);
      const offset = (circ * 0.25).toFixed(2); // start from 12 o'clock
      return `<svg class="project-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgba(200,210,230,0.45)" stroke-width="4.5"/>
        <circle cx="18" cy="18" r="13" fill="none" stroke="${color}" stroke-width="4.5"
          stroke-dasharray="${dash} ${circ.toFixed(2)}"
          stroke-dashoffset="${offset}"
          stroke-linecap="round"/>
      </svg>`;
    }

    return `<div class="projects-ring-list">
      ${projects.map((project) => {
        const progress = projectProgress(project.id);
        const total = projectWorkItems(project.id).length;
        const color = safeColor(project.color) || '#6366f1';
        return `<button class="project-ring-row" type="button" data-action="project-open" data-id="${project.id}">
          <div class="project-ring-icon">${ringPath(progress, color)}</div>
          <div class="project-ring-body">
            <div class="project-ring-name">
              <span class="project-color-dot" style="background:${color}"></span>
              <strong>${escapeHtml(project.name)}</strong>
              ${project.isSecret ? '<span class="tag-chip" style="background:rgba(239,68,68,0.10);color:#ef4444;font-size:9px;padding:1px 6px;">Secret</span>' : ''}
            </div>
            <div class="row-meta">${departmentChip(project.departmentId)} <span>${total} item${total !== 1 ? 's' : ''}</span><span>Due ${formatDate(project.deadline)}</span></div>
          </div>
          <strong class="project-ring-pct" style="color:${color}">${progress}%</strong>
        </button>`;
      }).join('')}
    </div>`;
  }

  function renderDashboardPage() {
    const user = currentUser();
    const taskItems = filterTasksByActiveDepartment(getVisibleTasks(user));
    const workItems = filterWorkItemsByActiveDepartment(getVisibleWorkItems(user));
    const projects = filterProjectsByActiveDepartment(getVisibleProjects(user));
    const unreadNotifications = getVisibleNotifications(user).filter((item) => !item.readAt);
    const today = todayIso();
    const todayStamp = new Date(`${today}T00:00:00`).getTime();
    const nextWeek = new Date(`${today}T00:00:00`);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStamp = nextWeek.getTime();
    const upcomingMeetings = state.data.meetings
      .filter((meeting) => {
        const start = meeting.startAt || meeting.start_time || meeting.startTime;
        if (!start) return false;
        const stamp = new Date(start).getTime();
        return Number.isFinite(stamp) && stamp >= todayStamp && stamp <= nextWeekStamp;
      })
      .sort((a, b) => new Date(a.startAt || a.start_time || a.startTime || 0) - new Date(b.startAt || b.start_time || b.startTime || 0))
      .slice(0, 4);
    const dueSoonItems = workItems
      .filter((item) => item.dueDate && !isCompleteStatus(item.status))
      .filter((item) => {
        const stamp = new Date(`${item.dueDate}T00:00:00`).getTime();
        return Number.isFinite(stamp) && stamp >= todayStamp && stamp <= nextWeekStamp;
      })
      .sort((a, b) => new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`))
      .slice(0, 4);
    const overdueItems = workItems
      .filter(isOverdue)
      .sort((a, b) => new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`))
      .slice(0, 4);
    const myItems = workItems.filter((item) => item.assigneeIds.includes(user.id));
    const metrics = [
      { label: 'My open work', value: myItems.filter((item) => !isCompleteStatus(item.status)).length, foot: 'tasks + briefs assigned to you', color: '#2563eb' },
      { label: 'Completed today', value: workItems.filter((item) => isCompleteStatus(item.status)).length, foot: 'visible completed work', color: '#14b8a6' },
      { label: 'At risk', value: workItems.filter(isOverdue).length, foot: 'overdue or delayed items', color: '#f97316' },
      { label: 'Unread alerts', value: unreadNotifications.length, foot: 'notification queue', color: '#8b5cf6' },
    ];

    const deptHealth = state.data.departments
      .map((department) => {
        const deptItems = workItems.filter((item) => item.departmentId === department.id);
        const done = deptItems.filter((item) => isCompleteStatus(item.status)).length;
        const pct = deptItems.length ? Math.round((done / deptItems.length) * 100) : 0;
        return { department, count: deptItems.length, pct };
      })
      .filter((row) => row.count || !currentDepartment());

    const activity = taskItems
      .flatMap((task) => (task.activity || []).map((entry) => ({ task, entry })))
      .sort((a, b) => new Date(b.entry.createdAt || 0) - new Date(a.entry.createdAt || 0))
      .slice(0, 8);

    DOM.pages.dashboard.innerHTML = `
      <div class="metrics-grid">
        ${metrics.map((metric) => `
          <article class="card metric-card" style="--metric-color:${metric.color}">
            <div class="metric-label">${escapeHtml(metric.label)}</div>
            <div class="metric-value">${metric.value}</div>
            <div class="metric-foot">${escapeHtml(metric.foot)}</div>
          </article>
        `).join('')}
      </div>

      <div style="margin-top:18px;">
        ${renderDashboardTimelineCard(projects)}
      </div>

      <div class="two-col">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Projects overview</h3>
              <div class="card-subtitle">work items distributed across projects</div>
            </div>
          </div>
          ${renderProjectsPieChart(projects)}
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Department health</h3>
              <div class="card-subtitle">completion snapshot by department</div>
            </div>
          </div>
          <div class="health-list">
            ${deptHealth.length ? deptHealth.map((row) => `
              <button class="health-row health-row-action" type="button" data-action="department-health-open" data-department="${row.department.id}" style="--health-color:${row.department.color}">
                <div class="row-between">
                  <strong>${escapeHtml(row.department.name)}</strong>
                  <span class="muted">${row.count} item(s)</span>
                </div>
                <div class="health-bar"><span style="width:${row.pct}%;background:${row.department.color}"></span></div>
                <div class="row-meta">
                  <span>${row.pct}% completed</span>
                  <span>View items</span>
                </div>
              </button>
            `).join('') : '<div class="empty-copy">No department activity</div>'}
          </div>
        </section>
      </div>

      <div class="two-col" style="margin-top:18px;">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Recent activity</h3>
              <div class="card-subtitle">task movements and updates</div>
            </div>
          </div>
          <div class="activity-list overview-feed-list">
            ${activity.length ? activity.map(({ task, entry }) => `
              <div class="activity-row">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="muted">${escapeHtml(entry.action || '')}</div>
                <div class="row-meta">
                  <span>${escapeHtml(getUser(entry.actorId)?.nick || 'Unknown')}</span>
                  <span>${formatDateTime(entry.createdAt)}</span>
                </div>
              </div>
            `).join('') : '<div class="empty-copy">No recent activity yet</div>'}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Today & next</h3>
              <div class="card-subtitle">upcoming meetings and delayed items</div>
            </div>
          </div>
          <div class="meeting-list overview-feed-list">
            ${upcomingMeetings.map((meeting) => `
              <button class="meeting-row" type="button" data-action="meeting-open" data-id="${meeting.id}">
                <strong>${escapeHtml(meeting.title)}</strong>
                <div class="muted">${formatDateTime(meeting.startAt)} · ${escapeHtml(meeting.location)}</div>
              </button>
            `).join('')}
            ${[...dueSoonItems, ...overdueItems].map((item) => `
              <button class="meeting-row" type="button" data-action="${item.openAction}" data-id="${item.sourceId}">
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${escapeHtml(item.originLabel)} · Overdue · ${formatDate(item.dueDate)}</div>
              </button>
            `).join('')}
            ${!upcomingMeetings.length && !dueSoonItems.length && !overdueItems.length ? '<div class="empty-copy">No meetings or deadlines in the next 7 days</div>' : ''}
          </div>
        </section>
      </div>
    `;
  }

  function renderBoardPage() {
    const projects = filterProjectsByActiveDepartment(getVisibleProjects());
    const items = getBoardWorkItems();
    const grouped = Config.taskStatuses.map((status) => ({
      status,
      items: items.filter((item) => item.status === status.id),
    }));

    DOM.pages.board.innerHTML = `
      <div class="board-shell">
        <div class="card">
          <div class="toolbar">
            <label class="field">
              <input data-filter="taskSearch" type="text" value="${escapeHtml(state.filters.taskSearch)}" placeholder="Search task, brief, project, assignee">
            </label>
            <label class="field">
              <select data-filter="taskProject">
                <option value="all">All projects</option>
                ${projects.map((project) => `<option value="${project.id}" ${state.filters.taskProject === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <select data-filter="taskDept">
                <option value="all">All departments</option>
                ${state.data.departments.map((department) => `<option value="${department.id}" ${state.filters.taskDept === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field" style="min-width:140px;">
              <span class="inline-note"><input data-filter="taskMine" type="checkbox" ${state.filters.taskMine ? 'checked' : ''}> only mine</span>
            </label>
          </div>
        </div>

        <div class="kanban-board">
          ${grouped.map(({ status, items: columnItems }) => `
            <section class="kanban-column">
              <div class="kanban-column-header">
                <div class="kanban-column-title">${status.label}</div>
                <div class="muted">${columnItems.length}</div>
              </div>
              <div class="kanban-stack">
                ${columnItems.length ? columnItems.map(renderWorkItemCard).join('') : '<div class="empty-copy">No items</div>'}
              </div>
            </section>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderCalendarPage() {
    const cursor = state.calendarCursor;
    const user = currentUser();
    const departmentId = state.activeDepartment === 'all' ? user?.departmentId : state.activeDepartment;
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const workItems = filterWorkItemsByActiveDepartment(getVisibleWorkItems(user));
    const meetings = state.data.meetings
      .filter((meeting) => state.activeDepartment === 'all' || meeting.departmentId === state.activeDepartment || (meeting.attendeeIds || []).includes(user?.id))
      .map((meeting) => ({ ...meeting, type: 'meeting' }));
    const entries = workItems.concat(meetings);
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return { date, iso: localDateIso(date) };
    });
    const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));

    DOM.pages.calendar.innerHTML = `
      <div class="calendar-shell">
        <div class="card calendar-head">
          <button class="icon-button" type="button" data-action="calendar-prev"><</button>
          <div class="calendar-month">${cursor.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</div>
          <button class="icon-button" type="button" data-action="calendar-next">></button>
        </div>
        <div class="card">
          <div class="calendar-grid calendar-grid-head">
            ${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}
          </div>
          <div class="calendar-month-grid">
            ${weeks.map((weekDays) => renderCalendarWeek(weekDays, entries, cursor, user, departmentId)).join('')}
          </div>
          <div class="legend" style="margin-top:16px;">
            <span><i style="background:#2563eb"></i>Task</span>
            <span><i style="background:#22c55e"></i>CEO Brief</span>
            <span><i style="background:#10b981"></i>Meeting</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderProjectsPage() {
    const projects = filterProjectsByActiveDepartment(getVisibleProjects())
      .filter((project) => state.filters.projectDept === 'all' || project.departmentId === state.filters.projectDept)
      .filter((project) => state.filters.projectVisibility === 'all' || (state.filters.projectVisibility === 'secret' ? project.isSecret : !project.isSecret))
      .sort((a, b) => compareWorkItems(
        projectWorkItems(a.id)[0] || { status: 'approve', priority: 'low', dueDate: a.deadline, createdAt: a.createdAt },
        projectWorkItems(b.id)[0] || { status: 'approve', priority: 'low', dueDate: b.deadline, createdAt: b.createdAt },
      ));

    DOM.pages.projects.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <label class="field">
            <select data-filter="projectDept">
              <option value="all">All departments</option>
              ${state.data.departments.map((department) => `<option value="${department.id}" ${state.filters.projectDept === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <select data-filter="projectVisibility">
              <option value="all">All access</option>
              <option value="public" ${state.filters.projectVisibility === 'public' ? 'selected' : ''}>Public</option>
              <option value="secret" ${state.filters.projectVisibility === 'secret' ? 'selected' : ''}>Secret</option>
            </select>
          </label>
        </div>
      </div>

      <div class="projects-grid" style="margin-top:18px;">
        ${projects.length ? projects.map((project) => {
          const progress = projectProgress(project.id);
          const owner = getUser(project.ownerId);
          const items = projectWorkItems(project.id);
          const completed = items.filter((item) => isCompleteStatus(item.status)).length;
          return `
            <button class="project-card project-card-strong" type="button" data-action="project-open" data-id="${project.id}" style="--project-color:${project.color}">
              <div class="project-card-accent" style="--project-color:${project.color}"></div>
              <div class="row-between">
                <div class="project-title-wrap">
                  <span class="project-color-dot" style="background:${project.color}"></span>
                  <strong>${escapeHtml(project.name)}</strong>
                </div>
                ${departmentChip(project.departmentId)}
              </div>
              <div class="muted">${escapeHtml(project.description)}</div>
              <div class="progress"><span style="width:${progress}%;background:${project.color}"></span></div>
              <div class="row-between">
                <div class="row-meta">
                  <span>${items.length} work item(s)</span>
                  <span>${completed} done</span>
                  <span>${project.isSecret ? 'Secret' : 'Public'}</span>
                </div>
                <strong>${progress}%</strong>
              </div>
              <div class="pill-list">
                ${project.memberIds.slice(0, 3).map((id) => {
                  const member = getUser(id);
                  return member ? `<span class="person-pill">${avatarHtml(member)} ${escapeHtml(member.nick)}</span>` : '';
                }).join('')}
              </div>
              <div class="row-meta">
                <span>Owner: ${escapeHtml(owner?.nick || 'Unknown')}</span>
                <span>Due ${formatDate(project.deadline)}</span>
              </div>
            </button>
          `;
        }).join('') : '<div class="empty-copy">No projects for this filter</div>'}
      </div>
    `;
  }

  function renderBriefsPage() {
    const briefs = filterBriefsByActiveDepartment(getVisibleBriefs());
    DOM.pages.briefs.innerHTML = `
      <div class="brief-grid">
        ${briefs.length ? briefs.map((brief) => {
          const project = getProject(brief.projectId);
          return `
            <button class="brief-card" type="button" data-action="brief-open" data-id="${brief.id}">
              <div class="row-between">
                <div class="pill-list">
                  ${priorityChip(brief.priority)}
                  ${statusChip(brief.status)}
                </div>
                ${departmentChip(brief.departmentId)}
              </div>
              <strong>${escapeHtml(brief.title)}</strong>
              <div class="muted">${escapeHtml((brief.body || '').slice(0, 160))}</div>
              <div class="progress"><span style="width:${taskProgress(brief)}%;background:${project?.color || '#22c55e'}"></span></div>
              <div class="row-meta">
                <span>${taskProgress(brief)}%</span>
                <span>Start ${formatDate(brief.startDate)}</span>
                <span>Due ${formatDate(brief.dueDate)}</span>
              </div>
              <div class="pill-list">
                ${(brief.assigneeIds || []).map((id) => {
                  const user = getUser(id);
                  return user ? `<span class="person-pill">${avatarHtml(user)} ${escapeHtml(user.nick)}</span>` : '';
                }).join('')}
              </div>
              <div class="row-meta">
                <span>${project ? `Project: ${project.name}` : 'No project linked'}</span>
                <span>${brief.linkedTaskId ? 'Linked to task' : 'Standalone brief'}</span>
              </div>
            </button>
          `;
        }).join('') : '<div class="empty-copy">No CEO brief visible for your role yet</div>'}
      </div>
    `;
  }

  function renderProjectTimelineRow(item, color) {
    if (!item.startDate || !item.dueDate) {
      return `
        <div class="gantt-row">
          <div class="row-between">
            <strong>${escapeHtml(item.title)}</strong>
            <div class="pill-list">${statusChip(item.status)} <span class="tag-chip">${escapeHtml(item.originLabel)}</span></div>
          </div>
          <div class="muted">No complete timeline yet</div>
        </div>
      `;
    }
    const allItems = projectWorkItems(item.projectId).filter((entry) => entry.startDate && entry.dueDate);
    const min = Math.min(...allItems.map((entry) => new Date(entry.startDate).getTime()));
    const max = Math.max(...allItems.map((entry) => new Date(entry.dueDate).getTime()));
    const span = Math.max(1, max - min);
    const left = ((new Date(item.startDate).getTime() - min) / span) * 100;
    const width = Math.max(8, ((new Date(item.dueDate).getTime() - new Date(item.startDate).getTime()) / span) * 100);
    return `
      <div class="gantt-row">
        <div class="row-between">
          <strong>${escapeHtml(item.title)}</strong>
          <div class="pill-list">${statusChip(item.status)} <span class="tag-chip">${escapeHtml(item.originLabel)}</span></div>
        </div>
        <div class="row-meta">
          <span>${formatDate(item.startDate)}</span>
          <span>${formatDate(item.dueDate)}</span>
          <span>${taskProgress(item)}%</span>
        </div>
        <div class="gantt-track">
          <span class="gantt-bar" style="left:${left}%;width:${width}%;background:${color}"></span>
        </div>
      </div>
    `;
  }

  function openProjectDrawer(projectId) {
    const project = getProject(projectId);
    if (!project || !canViewProject(project)) return;
    state.activeProjectDrawerId = project.id;
    DOM.drawer.classList.add('drawer-wide');
    const items = projectWorkItems(project.id);
    const progress = projectProgress(project.id);
    const owner = getUser(project.ownerId);
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${departmentChip(project.departmentId)} ${project.isSecret ? '<span class="tag-chip" style="background:rgba(239,68,68,0.12);color:#ef4444">Secret</span>' : ''}</div>
          <h3 class="drawer-headline">${escapeHtml(project.name)}</h3>
          <div class="row-meta">
            <span>Owner ${escapeHtml(owner?.nick || 'Unknown')}</span>
            <span>Due ${formatDate(project.deadline)}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="project-drawer-layout">
        <section class="project-main-stack">
          <section class="project-sprint-panel">
            ${renderProjectSprintChart(project)}
          </section>
          ${renderProjectPhaseCards(project)}
          ${renderProjectTaskList(project)}
        </section>
        <aside class="project-detail-panel">
          <div class="drawer-section">
            <h4>Description</h4>
            <div>${escapeHtml(project.description || 'No description')}</div>
          </div>
          <div class="drawer-section">
            <h4>Progress</h4>
            <div class="progress"><span style="width:${progress}%;background:${project.color}"></span></div>
            <div class="row-meta" style="margin-top:8px;">
              <span>${progress}% overall</span>
              <span>${items.length} visible work item(s)</span>
            </div>
          </div>
          <div class="drawer-section">
            <h4>Members</h4>
            <div class="pill-list">
              ${project.memberIds.map((id) => {
                const member = getUser(id);
                return member ? `<span class="member-pill">${avatarHtml(member)} ${escapeHtml(member.nick)}</span>` : '';
              }).join('')}
            </div>
          </div>
          <div class="drawer-section">
            <h4>Project files</h4>
            ${renderAttachmentList(project.attachments || [], false, { entityType: 'project', entityId: project.id })}
            ${renderAttachmentUploader('project', project.id, true)}
          </div>
          <div class="drawer-actions">
            ${canEditProject(project) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="project" data-id="${project.id}">Edit project</button>` : ''}
            <button class="primary-button" type="button" data-action="open-modal" data-entity="task" data-context="${project.id}">+ New task</button>
            ${canEditProject(project) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="brief" data-context="${project.id}">+ New brief</button>` : ''}
            ${canEditProject(project) ? `<button class="ghost-button" type="button" data-action="project-delete" data-id="${project.id}">Delete</button>` : ''}
          </div>
        </aside>
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openBriefDrawer(briefId) {
    const brief = getBrief(briefId);
    if (!brief || !canViewBrief(brief)) return;
    const project = getProject(brief.projectId);
    const linkedTask = getTask(brief.linkedTaskId);
    DOM.drawer.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="row-meta">${priorityChip(brief.priority)} ${statusChip(brief.status)} ${departmentChip(brief.departmentId)}</div>
          <h3 class="drawer-headline">${escapeHtml(brief.title)}</h3>
          <div class="row-meta">
            <span>${taskProgress(brief)}%</span>
            <span>Start ${formatDate(brief.startDate)}</span>
            <span>Due ${formatDate(brief.dueDate)}</span>
          </div>
        </div>
        <button class="icon-button" type="button" data-action="drawer-close">x</button>
      </div>
      <div class="drawer-section">
        <h4>Brief body</h4>
        <div>${escapeHtml(brief.body)}</div>
      </div>
      <div class="drawer-section">
        <h4>Progress</h4>
        <div class="progress"><span style="width:${taskProgress(brief)}%;background:${project?.color || '#22c55e'}"></span></div>
      </div>
      <div class="drawer-section">
        <h4>Files</h4>
        ${renderAttachmentList(brief.attachments || [], false, { entityType: 'brief', entityId: brief.id })}
        ${renderAttachmentUploader('brief', brief.id)}
      </div>
      <div class="drawer-section">
        <h4>Visible to</h4>
        <div class="pill-list">
          ${(brief.assigneeIds || []).map((id) => {
            const assignee = getUser(id);
            return assignee ? `<span class="person-pill">${avatarHtml(assignee)} ${escapeHtml(assignee.nick)}</span>` : '';
          }).join('') || '<span class="muted">No assignee</span>'}
        </div>
      </div>
      <div class="drawer-section">
        <h4>Linked</h4>
        <div class="summary-list">
          <div class="health-row">${project ? `Project: <strong>${escapeHtml(project.name)}</strong>` : 'No linked project'}</div>
          <div class="health-row">${linkedTask ? `Task: <strong>${escapeHtml(linkedTask.title)}</strong>` : 'No linked task yet'}</div>
        </div>
      </div>
      <div class="drawer-actions">
        ${canEditBrief(brief) ? `<button class="secondary-button" type="button" data-action="open-modal" data-entity="brief" data-id="${brief.id}">Edit brief</button>` : ''}
        ${canEditBrief(brief) && !brief.linkedTaskId ? `<button class="primary-button" type="button" data-action="brief-convert" data-id="${brief.id}">Convert to task</button>` : ''}
      </div>
    `;
    DOM.drawer.classList.remove('hidden');
    DOM.drawerOverlay.classList.remove('hidden');
  }

  function openBriefModal(briefId, projectContext) {
    const brief = briefId ? getBrief(briefId) : null;
    if (brief && !canEditBrief(brief)) return;
    if (!brief && !['admin', 'ceo', 'executive', 'head'].includes(currentUser()?.access)) return;
    const projects = getVisibleProjects();
    const assignable = state.data.users.filter((user) => canAssign(currentUser(), user) || user.id === currentUser()?.id);
    const defaultProjectId = brief?.projectId || projectContext || '';
    DOM.modalCard.innerHTML = `
      <div class="panel-header">
        <div>
          <h3 class="drawer-headline">${brief ? 'Edit brief' : 'Create CEO brief'}</h3>
          <div class="muted">shared workflow status with optional project sync</div>
        </div>
        <button class="icon-button" type="button" data-action="modal-close">x</button>
      </div>
      <form class="modal-grid" data-entity-form="brief">
        <input type="hidden" name="id" value="${escapeHtml(brief?.id || '')}">
        <label class="field full">
          <span>Title</span>
          <input name="title" required value="${escapeHtml(brief?.title || '')}">
        </label>
        <label class="field full">
          <span>Brief body</span>
          <textarea name="body">${escapeHtml(brief?.body || '')}</textarea>
        </label>
        <label class="field">
          <span>Priority</span>
          <select name="priority">
            ${Config.priorities.map((priority) => `<option value="${priority.id}" ${(brief?.priority || 'medium') === priority.id ? 'selected' : ''}>${escapeHtml(priority.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            ${Config.taskStatuses.map((status) => `<option value="${status.id}" ${normalizeWorkflowStatus(brief?.status || 'assigned') === status.id ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Department</span>
          <select name="departmentId">
            ${state.data.departments.map((department) => `<option value="${department.id}" ${(brief?.departmentId || currentUser()?.departmentId) === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Project</span>
          <select name="projectId">
            <option value="">No project</option>
            ${projects.map((project) => `<option value="${project.id}" ${defaultProjectId === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Start date</span>
          <input name="startDate" type="date" value="${escapeHtml(brief?.startDate || todayIso())}">
        </label>
        <label class="field">
          <span>Due date</span>
          <input name="dueDate" type="date" value="${escapeHtml(brief?.dueDate || todayIso())}">
        </label>
        <label class="field full">
          <span>Progress</span>
          <input name="progress" type="range" min="0" max="100" value="${escapeHtml(brief?.progress ?? 0)}">
        </label>
        <fieldset class="field full">
          <span>Visible / Assigned to</span>
          <div class="pill-list">
            ${assignable.map((user) => `
              <label class="person-pill">
                <input type="checkbox" name="assigneeIds" value="${user.id}" ${(brief?.assigneeIds || []).includes(user.id) ? 'checked' : ''}>
                ${avatarHtml(user)} ${escapeHtml(user.nick)}
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class="drawer-actions" style="grid-column:1 / -1;justify-content:flex-end;">
          <button class="ghost-button" type="button" data-action="modal-close">Cancel</button>
          <button class="primary-button" type="submit">Save brief</button>
        </div>
      </form>
    `;
    DOM.modalOverlay.classList.remove('hidden');
  }

  function saveTask(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('t');
    const task = form.elements.id.value ? getTask(id) : null;
    if (task && !canEditTask(task, actor)) return;
    const previousAssigneeIds = task?.assigneeIds || [];

    const selectedProject = getProject(form.elements.projectId.value);
    const assigneeIds = formArray(form, 'assigneeIds');
    const subtasks = parseSubtasksFromForm(form);
    const next = {
      id,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      projectId: form.elements.projectId.value,
      departmentId: form.elements.departmentId.value || selectedProject?.departmentId || actor.departmentId,
      createdBy: task?.createdBy || actor.id,
      assigneeIds,
      status: normalizeWorkflowStatus(form.elements.status.value),
      priority: form.elements.priority.value,
      progress: Number(form.elements.progress.value || 0),
      startDate: form.elements.startDate.value,
      dueDate: form.elements.dueDate.value,
      parentTaskId: task?.parentTaskId || null,
      subtasks,
      comments: task?.comments || [],
      attachments: task?.attachments || [],
      activity: task?.activity || [],
      linkedBriefId: task?.linkedBriefId || null,
      sourceType: task?.sourceType || 'task',
      sourceRefId: task?.sourceRefId || null,
      createdAt: task?.createdAt || nowIso(),
    };

    if (!next.title) {
      showToast('Task not saved', 'Title is required');
      return;
    }

    if (next.startDate && next.dueDate && next.dueDate < next.startDate) {
      showToast('Task not saved', 'Due date must be after start date');
      return;
    }

    if (subtasks.some((item) => item.startDate && item.dueDate && item.dueDate < item.startDate)) {
      showToast('Task not saved', 'Each subtask due date must be after its start date');
      return;
    }

    if (!assigneeIds.every((userId) => canAssign(actor, getUser(userId)))) {
      showToast('Task not saved', 'You cannot assign at least one selected user');
      return;
    }

    const expanded = expandTaskRangeToFitSubtasks(next, subtasks);
    next.progress = subtasks.length ? recalcTaskProgress(next) : next.progress;

    logTaskActivity(next, task ? 'updated task' : 'created task');
    if (task) {
      Object.assign(task, next);
    } else {
      state.data.tasks.unshift(next);
    }
    notifyNewAssignments(previousAssigneeIds, assigneeIds, actor.id, 'task', 'New task assigned', () => `${next.title} was assigned to you`, 'task', next.id);
    saveSnapshot();
    queueRemoteUpsert('task', next);
    closeModal();
    refreshApp();
    if (next.projectId) openProjectDrawer(next.projectId);
    showToast('Task saved', expanded.changed ? `${next.title} timeline expanded to fit subtasks` : next.title);
  }

  function saveProject(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('p');
    const project = form.elements.id.value ? getProject(id) : null;
    if (project && !canEditProject(project, actor)) return;
    if (!project && !canCreateProject(actor)) return;

    const memberIds = Array.from(new Set([actor.id].concat(formArray(form, 'memberIds'))));
    const next = {
      id,
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      departmentId: form.elements.departmentId.value,
      startDate: form.elements.startDate?.value || '',
      deadline: form.elements.deadline.value,
      color: form.elements.color.value,
      ownerId: project?.ownerId || actor.id,
      memberIds,
      isSecret: form.elements.isSecret.checked,
      attachments: project?.attachments || [],
      status: project?.status || 'active',
      createdAt: project?.createdAt || nowIso(),
    };

    if (!next.name) {
      showToast('Project not saved', 'Project name is required');
      return;
    }

    if (project) {
      Object.assign(project, next);
    } else {
      state.data.projects.unshift(next);
    }
    saveSnapshot();
    queueRemoteUpsert('project', next);
    closeModal();
    state.activePage = 'projects';
    refreshApp();
    openProjectDrawer(next.id);
    showToast('Project saved', next.name);
  }

  function saveBrief(form) {
    const actor = currentUser();
    const id = form.elements.id.value || uid('b');
    const brief = form.elements.id.value ? getBrief(id) : null;
    if (brief && !canEditBrief(brief, actor)) return;
    const previousAssigneeIds = brief?.assigneeIds || [];

    const assigneeIds = formArray(form, 'assigneeIds');
    if (!assigneeIds.every((userId) => canAssign(actor, getUser(userId)))) {
      showToast('Brief not saved', 'You cannot assign one of the selected users');
      return;
    }

    const next = {
      id,
      title: form.elements.title.value.trim(),
      body: form.elements.body.value.trim(),
      priority: form.elements.priority.value,
      status: normalizeWorkflowStatus(form.elements.status.value),
      departmentId: form.elements.departmentId.value,
      startDate: form.elements.startDate.value,
      dueDate: form.elements.dueDate.value,
      projectId: form.elements.projectId.value,
      progress: Number(form.elements.progress.value || 0),
      assigneeIds,
      createdBy: brief?.createdBy || actor.id,
      linkedTaskId: brief?.linkedTaskId || null,
      attachments: brief?.attachments || [],
      createdAt: brief?.createdAt || nowIso(),
    };

    if (!next.title) {
      showToast('Brief not saved', 'Brief title is required');
      return;
    }

    if (next.startDate && next.dueDate && next.dueDate < next.startDate) {
      showToast('Brief not saved', 'Due date must be after start date');
      return;
    }

    if (brief) {
      Object.assign(brief, next);
    } else {
      state.data.briefs.unshift(next);
    }
    notifyNewAssignments(previousAssigneeIds, assigneeIds, actor.id, 'brief', 'CEO brief assigned', () => `${next.title} is now visible to you`, 'brief', next.id);
    saveSnapshot();
    queueRemoteUpsert('brief', next);
    closeModal();
    refreshApp();
    showToast('Brief saved', next.title);
  }

  function markNotificationRead(notificationId) {
    const notification = byId(state.data.notifications, notificationId);
    if (!notification || notification.userId !== currentUser()?.id) return;
    notification.readAt = nowIso();
    saveSnapshot();
    queueRemoteUpsert('notification', notification);
    refreshApp();
  }

  function markAllNotificationsRead() {
    getVisibleNotifications().forEach((notification) => {
      notification.readAt = nowIso();
      queueRemoteUpsert('notification', notification);
    });
    saveSnapshot();
    refreshApp();
  }

  async function init() {
    cacheDom();
    bindStaticEvents();
    await bootstrap();
    localStorage.removeItem(storageKeys.session);
    sessionStorage.removeItem(storageKeys.session);
    renderQuickLogin();
    syncStatusBanner();
    refreshApp();
  }

  init();
})();

