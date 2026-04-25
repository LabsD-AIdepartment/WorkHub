window.DireWolfConfig = {
  appName: 'Dire Wolf OS',
  version: 'Rebuild 1',
  supabase: {
    baseUrl: 'https://ubrsapnarwisgpruxszp.supabase.co/rest/v1',
    anonKey: 'sb_publishable_QRAa9gVy92V7gp2k3WOGMg_3kxK-ANF',
    enabled: true,
  },
  roles: {
    admin: { label: 'Admin', rank: 1, color: '#7c3aed' },
    ceo: { label: 'CEO', rank: 2, color: '#2563eb' },
    executive: { label: 'Executive', rank: 3, color: '#0891b2' },
    head: { label: 'Head', rank: 4, color: '#0f766e' },
    member: { label: 'Member', rank: 5, color: '#64748b' },
    viewer: { label: 'Viewer', rank: 6, color: '#94a3b8' },
  },
  taskStatuses: [
    { id: 'backlog', label: 'Backlog', color: '#6366f1' },
    { id: 'inprogress', label: 'In Progress', color: '#2563eb' },
    { id: 'review', label: 'Review', color: '#f59e0b' },
    { id: 'approve', label: 'Approve', color: '#6b7280' },
  ],
  priorities: [
    { id: 'critical', label: 'Critical', color: '#ef4444' },
    { id: 'high', label: 'High', color: '#f97316' },
    { id: 'medium', label: 'Medium', color: '#DBBE00' },
    { id: 'low', label: 'Low', color: '#10b981' },
  ],
  seed: {
    departments: [],
    users: [],
    projects: [],
    tasks: [],
    meetings: [],
    briefs: [],
    notifications: [],
  },
};
