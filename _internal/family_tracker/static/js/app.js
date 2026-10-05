
/* ═══════════════════════════════════════════════════════════════
   GLOBAL STATE
   ═══════════════════════════════════════════════════════════════ */
let members = [];
let groupsData = null;
let currentTab = (function () {
  try {
    const t = localStorage.getItem('kielora_tab');
    return (['dashboard', 'members', 'relatives', 'tree', 'horoscope', 'sources', 'timeline', 'trash', 'settings'].indexOf(t) >= 0) ? t : 'dashboard';
  } catch (e) { return 'dashboard'; }
})();
let treeFocusId = null;
let treeFitted = false;
let treeKeepView = false;
let sortCol = 'name';
let sortDir = 1;
let searchQ = '';
let membersViewMode = localStorage.getItem('kielora_members_view') || 'list';
let pan = { x: 0, y: 0 };
let scale = 1;
let dragging = false;
let dragStart = {};
let panStart = {};
let charts = {};
let editingId = null;
let pendingAddLink = null;
let prevChildIds = [];
let treeCollapsed = new Set();
let treeGenLimit = 0;
let treeDepth = 0;
let treeLineStyle = (function () {
  const raw = localStorage.getItem('kielora_line_style') || 'elegant';
  return ['elegant','flow','neon','ortho'].includes(raw) ? raw : 'elegant';
})();
let LIFE = { countries: [], regions: {}, profiles: {}, defaultProfile: { school: 6, university: 18, retirement: 65 } };
let FAMILY = { name: '', birthCountry: '', birthRegion: '' };

/* ── Family scope: which families to show in dashboard + tree ──
mode: 'blood' (family = an ancestor reached through the paternal chain) | 'marriage' (a component linked by blood and by marriage)
selected: null = show everyone | Set of family names*/
let FAMILY_SCOPE = (function () {
  try {
    const s = JSON.parse(localStorage.getItem('kielora_fam_scope') || 'null');
    return {
      mode: s && (s.mode === 'blood' || s.mode === 'marriage') ? s.mode : 'blood',
      selected: s && Array.isArray(s.selected) ? new Set(s.selected) : null
    };
  } catch (e) { return { mode: 'blood', selected: null }; }
})();
let famscopeCollapsed = true;          // curtain state for THIS session (starts closed every launch)
let FAMILY_CLUSTER_MAP = null;      // Map memberId -> family name (built for current mode+list)
let FAMILY_CLUSTER_ORDER = [];      // [{name,count,color}] for picker
let FAMILY_BLOODLINES = null;       // Map familyName -> Set(memberId) for blood-mode filtering
let FAMILY_SCOPE_ALL = null;        // full member list for cluster recomputation
const FAMILY_COLORS = ['#f4c95d', '#7fb3e0', '#a8d189', '#e5989b', '#b39ddb', '#ffb86b', '#84d2c5', '#f28fa3', '#7dd3fc', '#f6c453', '#a3e635', '#fca5a5', '#93c5fd', '#f9a8d4', '#c4b5fd', '#86efac'];
function famDefaultName(m) { return (m && (m.family || m.name)) || '؟'; }
function famAnd() { return (window.i18n && i18n.current() === 'ar') ? ' و ' : ' & '; }
function uniFamilyName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  let i = 2;
  while (used.has(name + ' ' + i)) i++;
  const n = name + ' ' + i;
  used.add(n);
  return n;
}

/*Couple-based family units (client-side, by blood and marriage: a family = husband + his wife + their children).
Each unit = two spouses linked by spouse_id (or a single parent) + their direct children via parent_id.
Logical classification:
- roots        : the spouses with no parent inside the family (the roots)
- grandparents : they have grandchildren
- parents      : they have children but no grandchildren
- childless    : spouses with no children
A single member belongs to one unit only (before the family root), so the groups stay separate for the tree and the colouring.*/
function famCoupleKey(a, b) { return [String(a), String(b)].sort().join('|'); }
function famUnitName(persons) {
  const ms = (persons || []).filter(Boolean);
  if (!ms.length) return famDefaultName(null);
  const male = ms.find(x => x.gender === 'male');
  const female = ms.find(x => x.gender === 'female');
  if (male && female && male.id !== female.id) return male.name + famAnd() + female.name;
  if (ms.length === 2) return ms[0].name + famAnd() + ms[1].name;
  return ms[0].name;
}
function buildCoupleFamilyUnits(list) {
  const byId = new Map((list || []).map(m => [String(m.id), m]));
  const childrenOf = new Map();
  (list || []).forEach(m => {
    if (m.parentId && byId.has(String(m.parentId))) {
      const k = String(m.parentId);
      if (!childrenOf.has(k)) childrenOf.set(k, []);
      childrenOf.get(k).push(m);
    }
  });
  const spouseOf = new Map();
  (list || []).forEach(m => {
    if (m.spouseId && byId.has(String(m.spouseId))) {
      const a = String(m.id), b = String(m.spouseId);
      if (!spouseOf.has(a)) spouseOf.set(a, b);
      if (!spouseOf.has(b)) spouseOf.set(b, a);
    }
  });
  const units = new Map();
  const headOfMember = new Map();
  const isHead = m => m && (spouseOf.has(String(m.id)) || (childrenOf.get(String(m.id)) || []).length > 0);
  (list || []).forEach(m => {
    const mid = String(m.id);
    if (units.has(mid)) return;
    if (!isHead(m)) return;
    const sp = spouseOf.get(mid);
    const key = sp ? famCoupleKey(mid, sp) : ('s-' + mid);
    if ([...units.values()].some(u => u.key === key)) return;
    const partner = sp ? byId.get(sp) : null;
    const persons = partner ? [m, partner] : [m];
    const members = persons.map(p => String(p.id));
    const kidsIds = new Set();
    members.forEach(pId => (childrenOf.get(pId) || []).forEach(c => kidsIds.add(String(c.id))));
    const kids = [...kidsIds];
    const hasGrand = kids.some(k => (childrenOf.get(k) || []).length > 0);
    const isRoot = members.every(pId => {
      const p = byId.get(pId);
      return !p || !p.parentId || !byId.has(String(p.parentId));
    });
    let tier;
    if (!kids.length) tier = 'childless';
    else if (isRoot) tier = 'roots';
    else if (hasGrand) tier = 'grandparents';
    else tier = 'parents';
    const name = famUnitName(persons);
    units.set(key, { key, name, members, kids: kidsIds, kidsCount: kids.length, isRoot, hasGrand, tier, persons });
    members.forEach(pId => headOfMember.set(pId, key));
  });
  // Link each member to its unit: head → his own unit; child → his father's unit, up the whole paternal chain.
  const memberUnit = new Map();
  (list || []).forEach(m => {
    const mid = String(m.id);
    if (headOfMember.has(mid)) { memberUnit.set(mid, headOfMember.get(mid)); return; }
    let node = m, seen = new Set(), k = null;
    while (node && node.parentId && byId.has(String(node.parentId)) && !seen.has(String(node.id))) {
      seen.add(String(node.id));
      const pid = String(node.parentId);
      if (headOfMember.has(pid)) { k = headOfMember.get(pid); break; }
      node = byId.get(pid);
    }
    if (!k) k = 'i-' + mid; // Isolated (has no parent inside the family)
    memberUnit.set(mid, k);
    if (k.charAt(0) !== 'i-' && !units.has(k)) {
      units.set(k, { key: k, name: famDefaultName(m), members: [mid], kids: new Set(), kidsCount: 0, isRoot: true, hasGrand: false, tier: 'roots', persons: [m] });
    }
  });
  // Isolated units
  (list || []).forEach(m => {
    const mid = String(m.id);
    if (memberUnit.get(mid) && memberUnit.get(mid).charAt(0) === 'i-') {
      const k = memberUnit.get(mid);
      if (![...units.values()].some(u => u.key === k)) {
        units.set(k, { key: k, name: famDefaultName(m), members: [mid], kids: new Set(), kidsCount: 0, isRoot: true, hasGrand: false, tier: 'roots', persons: [m] });
      }
    }
  });
  const unitList = [...units.values()];
  unitList.forEach(u => { u.memberIds = new Set((list || []).filter(m => memberUnit.get(String(m.id)) === u.key).map(m => String(m.id))); });
  return { units: unitList, memberUnit };
}
function saveFamilyScope() {
  try {
    localStorage.setItem('kielora_fam_scope', JSON.stringify({
      mode: FAMILY_SCOPE.mode,
      selected: FAMILY_SCOPE.selected ? [...FAMILY_SCOPE.selected] : null
    }));
  } catch (e) {}
}
function famClusterColor(i) { return FAMILY_COLORS[i % FAMILY_COLORS.length]; }

/*Union-find ladder: collects members connected by blood (parentId) or by marriage (spouseId)*/
function buildFamilyClusters(list, mode) {
  const clusters = [];
  if (!list || !list.length) return clusters;
  if (mode === 'blood') {
    /*By blood and marriage: the family = husband + wife + their descendants (couple-based).
Each unit is classified by family logic:
childless = spouses with no children
roots     = the roots (the spouses with no parent inside the family)
grandparents = the grandparents (they have grandchildren)
parents   = the parents (they have children but no grandchildren)
The count = the size of the unit's full descendant set.*/
    const byId = new Map((list || []).map(m => [String(m.id), m]));
    const childrenOf = new Map();
    (list || []).forEach(m => {
      if (!m.parentId || !byId.has(String(m.parentId))) return;
      const p = String(m.parentId);
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(String(m.id));
    });
    const descOf = heads => {
      const out = new Set(heads.map(h => String(h)));
      const stack = [...out];
      while (stack.length) {
        const id = stack.pop();
        (childrenOf.get(id) || []).forEach(c => { if (!out.has(c)) { out.add(c); stack.push(c); } });
      }
      return out;
    };
    const { units, memberUnit } = buildCoupleFamilyUnits(list);
    const tierSort = { roots: 0, grandparents: 1, parents: 2, childless: 3 };
    const setNames = new Set();
    clusters.push(...units.map(u => {
      const desc = descOf(u.persons.map(p => String(p.id)));
      return {
        name: uniFamilyName(u.name, setNames),
        members: [...desc].map(id => byId.get(id)).filter(Boolean),
        tier: u.tier,
        headIds: u.persons.map(p => String(p.id)),
        unit: u
      };
    }));
    // Sorted by layer, so the roots appear first, then the grandparents, then the parents, then the childless ones
    clusters.sort((a, b) => (tierSort[a.tier] ?? 9) - (tierSort[b.tier] ?? 9) || (b.members.length - a.members.length));
    return clusters;
  }
  const par = {};
  list.forEach(m => { par[m.id] = m.id; });
  const find = id => {
    let r = id;
    while (par[r] !== r) r = par[r];
    let c = id, n;
    while (par[c] !== c) { n = par[c]; par[c] = r; c = n; }
    return r;
  };
  const uni = (a, b) => {
    if (a == null || b == null) return;
    if (par[a] == null || par[b] == null) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) par[ra] = rb;
  };
  list.forEach(m => {
    if (m.parentId != null && m.parentId) uni(m.id, m.parentId);
    if (m.spouseId != null && m.spouseId) uni(m.id, m.spouseId);
  });
  const groups = {};
  list.forEach(m => { const r = find(m.id); (groups[r] = groups[r] || []).push(m); });
  Object.values(groups).forEach(members => {
    const roots = members.filter(x => !x.parentId || !members.some(o => o.id === x.parentId));
    const kid = {};
    members.forEach(x => { if (x.parentId && members.some(o => o.id === x.parentId)) (kid[x.parentId] = kid[x.parentId] || []).push(x.id); });
    const depthOf = mid => { let d = 0; const rec = (i, l) => { d = Math.max(d, l); (kid[i] || []).forEach(c => rec(c, l + 1)); }; rec(mid, 1); return d; };
    const led = roots.slice().sort((a, b) => (depthOf(b.id)) - (depthOf(a.id))).slice(0, 2).map(r => famDefaultName(r)).filter(Boolean);
    let name = led.join(' و ');
    if (roots.length > led.length) name = (name || famDefaultName(roots[0])) + ' ' + (typeof t === 'function' ? t('famScope.relatives') : 'وأقاربهم');
    if (!name) name = roots.map(r => famDefaultName(r)).join(' + ') || famDefaultName(members[0]);
    clusters.push({ name, members });
  });
  return clusters;
}
function refreshFamilyClusters(list) {
  const clusters = buildFamilyClusters(list, FAMILY_SCOPE.mode);
  FAMILY_CLUSTER_MAP = new Map();
  FAMILY_BLOODLINES = null;
  if (FAMILY_SCOPE.mode !== 'blood') clusters.sort((a, b) => b.members.length - a.members.length);
  FAMILY_CLUSTER_ORDER = clusters.map((c, i) => ({ name: c.name, count: c.members.length, color: famClusterColor(i), i, tier: c.tier }));
  if (FAMILY_SCOPE.mode === 'blood') {
    const bl = new Map();
    clusters.forEach(c => bl.set(c.name, new Set(c.members.map(m => String(m.id)))));
    FAMILY_BLOODLINES = bl;
  }
  clusters.forEach(c => c.members.forEach(m => {
    if (!FAMILY_CLUSTER_MAP.has(String(m.id))) FAMILY_CLUSTER_MAP.set(String(m.id), c.name);
  }));
  return clusters;
}
function famScopeOf(m) {
  if (FAMILY_CLUSTER_MAP) {
    const n = FAMILY_CLUSTER_MAP.get(String(m && m.id));
    if (n) return n;
  }
  return famDefaultName(m);
}
let _scopeSetsKey = '', _scopeSetsCache = null;
function scopeMatchedSets() {
  const selected = FAMILY_SCOPE.selected;
  const key = FAMILY_SCOPE.mode + '|' + (selected ? [...selected].sort().join('~') : '');
  if (_scopeSetsKey === key && _scopeSetsCache) return _scopeSetsCache;
  const src = (FAMILY_SCOPE_FULL && FAMILY_SCOPE_FULL.length) ? FAMILY_SCOPE_FULL
    : (FAMILY_SCOPE_ALL && FAMILY_SCOPE_ALL.length ? FAMILY_SCOPE_ALL : null);
  const out = [];
  if (src && selected) {
    const clusters = buildFamilyClusters(src, FAMILY_SCOPE.mode);
    if (FAMILY_SCOPE.mode === 'blood') {
      const bl = new Map(clusters.map(c => [c.name, new Set(c.members.map(m => String(m.id)))]));
      selected.forEach(n => { const s = bl.get(n); if (s) out.push(s); });
    } else {
      const cm = new Map();
      clusters.forEach(c => c.members.forEach(m => { if (!cm.has(String(m.id))) cm.set(String(m.id), c.name); }));
      selected.forEach(n => out.push(new Set(clusters.filter(c => c.name === n).flatMap(c => c.members.map(m => String(m.id))))));
    }
  }
  _scopeSetsKey = key;
  _scopeSetsCache = out;
  return out;
}
function filterMembersByScope(list) {
  if (!list || !list.length) return list;
  if (!FAMILY_SCOPE.selected) return list;
  const fams = scopeMatchedSets();
  if (!fams.length) return list;
  return list.filter(m => fams.some(s => s.has(String(m.id))));
}
function toggleFamilyScope(name) {
  if (!FAMILY_SCOPE.selected) FAMILY_SCOPE.selected = new Set();
  if (FAMILY_SCOPE.selected.has(name)) FAMILY_SCOPE.selected.delete(name);
  else FAMILY_SCOPE.selected.add(name);
  if (!FAMILY_SCOPE.selected.size) FAMILY_SCOPE.selected = null;
  saveFamilyScope();
}
function ensureFamilyScopeList(list) {
  if (Array.isArray(list) && list.length) FAMILY_SCOPE_ALL = list;
  if (!FAMILY_SCOPE_ALL || !FAMILY_SCOPE_ALL.length) return;
  refreshFamilyClusters(FAMILY_SCOPE_ALL);
  if (FAMILY_SCOPE.selected && FAMILY_SCOPE.selected.size) {
    const valid = new Set(FAMILY_CLUSTER_ORDER.map(c => c.name));
    const kept = new Set([...FAMILY_SCOPE.selected].filter(n => valid.has(n)));
    if (kept.size !== FAMILY_SCOPE.selected.size) {
      FAMILY_SCOPE.selected = kept.size ? kept : null;
      saveFamilyScope();
    }
  }
}
let FAMILY_SCOPE_FULL = null;
async function renderGlobalFilter() {
  const host = $('global-fscope');
  if (!host) return;
  if (!FAMILY_SCOPE_FULL || !FAMILY_SCOPE_FULL.length) {
    try {
      const d = await api('/api/members?groupBy=none');
      FAMILY_SCOPE_FULL = (d && d.members && d.members.length) ? d.members : members.slice();
    } catch (e) { FAMILY_SCOPE_FULL = members.slice(); }
    _scopeSetsKey = ''; _scopeSetsCache = null;
  }
  if (!FAMILY_SCOPE_FULL.length) { host.innerHTML = ''; return; }
  ensureFamilyScopeList(FAMILY_SCOPE_FULL);
  renderFamilyScopeUI(host, () => {
    if (currentTab === 'tree') {
      treeFocusId = null;
      const trig = $('tf-trigger');
      if (trig) { trig.innerHTML = '🌳 ' + t('tree.viewAll'); trig.dataset.value = ''; }
    }
    renderCurrentView();
  });
}
function renderFamilyScopeUI(host, onChange) {
  if (!host) return;
  const full = (FAMILY_SCOPE_FULL && FAMILY_SCOPE_FULL.length) ? FAMILY_SCOPE_FULL : FAMILY_SCOPE_ALL;
  if (!full || !full.length) { host.innerHTML = ''; return; }
  ensureFamilyScopeList(full);
  refreshFamilyClusters(full);
  const isAll = !FAMILY_SCOPE.selected;
  const collapsed = famscopeCollapsed;
  const q = normAr((window._fscopeQ = (window._fscopeQ != null ? window._fscopeQ : (localStorage.getItem('kielora_fscope_q') || ''))).trim());
  const qMatch = n => !q || normAr(n).includes(q);
  const selCount = isAll ? 0 : FAMILY_SCOPE.selected.size;
  const mkRow = (c, on, idx) => `<div class="famscope-row${on ? ' active' : ''}" data-fs-fam="${idx}" data-fs-name="${esc(c.name)}">
      <span class="fk-box">${on ? '✓' : ''}</span>
      <span class="fc-dot" style="background:${c.color}"></span>
      <span class="fk-name">${esc(c.name)}</span>
      <span class="fc-count">${c.count}</span>
    </div>`;
  let items = '';
  if (FAMILY_SCOPE.mode === 'blood') {
    const sections = [
      ['roots', t('famScope.roots')],
      ['grandparents', t('famScope.grandparents')],
      ['parents', t('famScope.parents')],
      ['childless', t('famScope.childless')]
    ];
    sections.forEach(([tier, label]) => {
      const grp = FAMILY_CLUSTER_ORDER.filter(c => c.tier === tier && qMatch(c.name));
      if (!grp.length) return;
      items += `<div class="famscope-sect">${esc(label)}</div>` + grp.map(c => mkRow(c, !isAll && FAMILY_SCOPE.selected.has(c.name), c.i)).join('');
    });
  } else {
    FAMILY_CLUSTER_ORDER.filter(c => qMatch(c.name)).forEach(c => { items += mkRow(c, !isAll && FAMILY_SCOPE.selected.has(c.name), c.i); });
  }
  if (!items) items = '<div class="famscope-empty" style="padding:10px 6px">🔍 ' + esc(t('rel.idx.noMatch')) + '</div>';
  const countTxt = isAll
    ? t('famScope.familyCount', { n: FAMILY_CLUSTER_ORDER.length })
    : t('famScope.countSelected', { n: selCount, total: FAMILY_CLUSTER_ORDER.length });
  host.innerHTML = `
    <div class="famscope${collapsed ? ' collapsed' : ''}" id="famscope">
      <div class="famscope-head">
        <div class="famscope-title"><span class="fs-ico">🔎</span><span>${esc(t('famScope.sectionHeader'))}</span></div>
        <div class="famscope-modes">
          <button class="famscope-mode-btn${FAMILY_SCOPE.mode === 'blood' ? ' active' : ''}" data-fs-mode="blood">🔗 ${t('famScope.modeBlood')}</button>
          <button class="famscope-mode-btn${FAMILY_SCOPE.mode === 'marriage' ? ' active' : ''}" data-fs-mode="marriage">💞 ${t('famScope.modeMarriage')}</button>
        </div>
        <div class="famscope-search"><span class="fs-search-ico">🔍</span><input id="famscope-q" type="text" value="${esc(q)}" placeholder="${esc(t('famScope.search'))}" autocomplete="off"></div>
        <div class="famscope-actions">
          <span class="famscope-count-pill" id="famscope-count">${esc(countTxt)}</span>
          <button class="famscope-btn" data-fs-clear title="${esc(t('famScope.clear'))}">✖ ${t('famScope.clear')}</button>
          <button class="famscope-toggle" data-fs-collapse title="${esc(collapsed ? t('famScope.expand') : t('famScope.collapse'))}"><span class="arrow">▼</span></button>
        </div>
      </div>
      <div class="famscope-body">
        ${mkRow({ name: t('famScope.all'), count: full.length, color: '#c8cdd6' }, isAll, -1)}
        ${items}
      </div>
    </div>`;
  host.querySelectorAll('.famscope-mode-btn').forEach(btn => {
    btn.onclick = () => {
      FAMILY_SCOPE.mode = btn.dataset.fsMode;
      refreshFamilyClusters(full);
      if (FAMILY_SCOPE.selected) {
        const valid = new Set(FAMILY_CLUSTER_ORDER.map(c => c.name));
        FAMILY_SCOPE.selected = new Set([...FAMILY_SCOPE.selected].filter(n => valid.has(n)));
        if (!FAMILY_SCOPE.selected.size) FAMILY_SCOPE.selected = null;
      }
      saveFamilyScope();
      renderFamilyScopeUI(host, onChange);
      if (onChange) onChange();
    };
  });
  host.querySelectorAll('.famscope-row').forEach(row => {
    row.onclick = () => {
      const fi = parseInt(row.dataset.fsFam, 10);
      const fname = row.dataset.fsName;
      if (fi === -1 || !fname) FAMILY_SCOPE.selected = null;
      else toggleFamilyScope(fname);
      renderFamilyScopeUI(host, onChange);
      if (onChange) onChange();
    };
  });
  const collapseBtn = host.querySelector('[data-fs-collapse]');
  if (collapseBtn) collapseBtn.onclick = () => {
    const fs = $('famscope');
    if (!fs) return;
    const col = fs.classList.toggle('collapsed');
    famscopeCollapsed = col;
    collapseBtn.title = col ? t('famScope.expand') : t('famScope.collapse');
  };
  const qIn = $('famscope-q');
  if (qIn) {
    qIn.oninput = () => {
      const qq = normAr(qIn.value.trim());
      window._fscopeQ = qIn.value.trim();
      try { localStorage.setItem('kielora_fscope_q', window._fscopeQ); } catch (e) {}
      host.querySelectorAll('.famscope-row').forEach(row => {
        const name = row.dataset.fsName || '';
        row.style.display = (!qq || normAr(name).includes(qq)) ? '' : 'none';
      });
      host.querySelectorAll('.famscope-sect').forEach(sect => {
        const next = sect.nextElementSibling;
        let visible = false;
        for (let el = next; el && el.classList && el.classList.contains('famscope-row'); el = el.nextElementSibling) {
          if (el.style.display !== 'none') { visible = true; break; }
        }
        sect.style.display = visible ? '' : 'none';
      });
    };
  }
  const clearBtn = host.querySelector('[data-fs-clear]');
  if (clearBtn) clearBtn.onclick = () => {
    FAMILY_SCOPE.selected = null;
    saveFamilyScope();
    renderFamilyScopeUI(host, onChange);
    if (onChange) onChange();
  };
}

const KIELANG_TAG = '◈KE';
function encodeRegion(region, lang) {
  region = region || '';
  region = region.replace(new RegExp(KIELANG_TAG + ':[a-z]{2}$'), '');
  if (!lang || lang === 'en') return region;
  return region + KIELANG_TAG + ':' + lang;
}
function decodeRegion(region) {
  const m = /◈KE:([a-z]{2})$/.exec(region || '');
  if (!m) return { region: region || '', lang: null };
  return { region: (region || '').slice(0, region.length - m[0].length), lang: m[1] };
}
async function persistLangToServer(lang) {
  try {
    const { region } = decodeRegion(FAMILY.birthRegion);
    const encoded = encodeRegion(region, lang);
    await api('/api/family/defaults', { method: 'POST', body: JSON.stringify({ birthCountry: FAMILY.birthCountry, birthRegion: encoded }) });
  } catch (e) {}
}

async function loadLifecycle() {
  try {
    const res = await api('/api/lifecycle');
    if (res && Array.isArray(res.countries)) LIFE = res;
  } catch (e) {}
}

async function loadFamilyDefaults() {
  try {
    const info = await api('/api/family/info');
    if (info) {
      FAMILY.name = info.name || FAMILY.name || '';
      FAMILY.birthCountry = info.birthCountry || '';
      const dec = decodeRegion(info.birthRegion || '');
      FAMILY.birthRegion = dec.region;
      window.__famReadyLang = true;
      if (dec.lang && window.i18n && window.i18n.switchLang) {
        window.i18n.switchLang(dec.lang);
      }
    }
  } catch (e) {}
}

function flagFor(code) {
  if (!code) return '';
  try {
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
  } catch (e) { return ''; }
}

function countryTxt(code) {
  if (!code) return '';
  const c = LIFE.countries.find(x => x.code.toUpperCase() === code.toUpperCase());
  if (!c) return code;
  return c.local || (apiLang() === 'en' ? c.en : c.ar);
}

function regionTxt(arName, cc) {
  if (!arName) return arName;
  const ccc = cc || ($('f-birthCountry') ? $('f-birthCountry').value : '');
  const rows = LIFE.regions[ccc] || [];
  const found = rows.find(r => r.ar === arName);
  if (!found) return arName;
  return found.local || (apiLang() === 'en' ? found.en : found.ar);
}

function birthPlaceText(m) {
  if (!m) return '';
  const parts = [];
  if (m.birthCountry) parts.push(flagFor(m.birthCountry) + ' ' + countryTxt(m.birthCountry));
  if (m.birthRegion) parts.push(regionTxt(m.birthRegion, m.birthCountry));
  if (m.birthDetail) parts.push(esc(m.birthDetail));
  return parts.join(' • ');
}

function initBirthPlace(ctx) {
  ctx = ctx || {};
  const isEn = apiLang() === 'en';
  const opts = [{ value: '', label: '— ' + t('memberModal.birthPlaceNone') + ' —' }];
  LIFE.countries.slice().sort((a, b) => (isEn ? a.en : a.ar).localeCompare(isEn ? b.en : b.ar, isEn ? 'en' : 'ar'))
    .forEach(c => opts.push({ value: c.code, label: flagFor(c.code) + ' ' + placeName(c, isEn) }));
  makeSearchableSelect('bc-trigger', 'bc-drop', opts, val => {
    $('f-birthCountry').value = val || '';
    buildRegionSelect();
  });
  const curCountry = ctx.birthCountry || (!ctx.memberId && editingId === null ? FAMILY.birthCountry : '');
  const cTrig = $('bc-trigger');
  if (curCountry) {
    cTrig.innerHTML = flagFor(curCountry) + ' ' + countryTxt(curCountry);
    cTrig.dataset.value = curCountry;
  } else {
    cTrig.innerHTML = '— ' + t('memberModal.birthPlaceNone') + ' —';
    cTrig.dataset.value = '';
  }
  $('f-birthCountry').value = curCountry;
  $('f-birthDetail').value = ctx.birthDetail || '';
  const curRegion = ctx.birthRegion || (!ctx.memberId && editingId === null && curCountry ? FAMILY.birthRegion : '');
  buildRegionSelect(ctx.birthRegion || curRegion || '');

  // If adding locally and family defaults weren't loaded yet, apply them when available
  if (!ctx.birthCountry && editingId === null && !ctx.memberId) {
    api('/api/family/info').then(info => {
      if (info && (info.birthCountry || info.birthRegion) && !$('f-birthCountry').value) {
        const cc = $('f-birthCountry');
        cc.value = info.birthCountry || '';
        const trig = $('bc-trigger');
        if (cc.value) trig.innerHTML = flagFor(cc.value) + ' ' + countryTxt(cc.value);
        else trig.innerHTML = '— ' + t('memberModal.birthPlaceNone') + ' —';
        trig.dataset.value = cc.value;
        const dec = decodeRegion(info.birthRegion || '');
        buildRegionSelect(dec.region);
        if (dec.lang && window.i18n && window.i18n.switchLang) {
          window.i18n.switchLang(dec.lang);
        }
      }
    }).catch(() => {});
  }
}

function buildRegionSelect(preserve) {
  const cc = $('f-birthCountry').value || '';
  const rows = LIFE.regions[cc] || [];
  const wrap = $('br-wrap');
  const free = $('f-birthRegionFree');
  const isEn = apiLang() === 'en';
  if (rows.length) {
    wrap.style.display = '';
    free.style.display = 'none';
    const opts = [{ value: '', label: '— ' + t('memberModal.regionNone') + ' —' }];
    rows.forEach(r => opts.push({ value: r.ar, label: placeName(r, isEn) }));
    makeSearchableSelect('br-trigger', 'br-drop', opts, val => {
      $('f-birthRegion').value = val || '';
      $('f-birthRegionFree').value = '';
    });
    const rTrig = $('br-trigger');
    if (preserve) {
      $('f-birthRegion').value = preserve;
      const found = rows.find(r => r.ar === preserve);
      rTrig.innerHTML = found ? placeName(found, isEn) : preserve;
      rTrig.dataset.value = preserve;
    } else {
      rTrig.innerHTML = '— ' + t('memberModal.regionNone') + ' —';
      rTrig.dataset.value = '';
    }
    free.value = '';
  } else {
    wrap.style.display = 'none';
    $('f-birthRegion').value = '';
    free.style.display = '';
    free.placeholder = t('memberModal.regionFreePh');
    free.value = preserve || cc ? (preserve || '') : '';
  }
}

function getBirthRegion() {
  const hid = $('f-birthRegion');
  const free = $('f-birthRegionFree');
  return (hid && hid.value) || (free && free.value) || '';
}

function initFamilySettings() {
  const isEn = apiLang() === 'en';
  const opts = [{ value: '', label: '— ' + t('memberModal.birthPlaceNone') + ' —' }];
  LIFE.countries.slice().sort((a, b) => (isEn ? a.en : a.ar).localeCompare(isEn ? b.en : b.ar, isEn ? 'en' : 'ar'))
    .forEach(c => opts.push({ value: c.code, label: flagFor(c.code) + ' ' + placeName(c, isEn) }));
  makeSearchableSelect('df-bc-trigger', 'df-bc-drop', opts, val => {
    $('s-default-birth-country').value = val || '';
    buildSettingsRegionSelect();
  });
  const cc = FAMILY.birthCountry || '';
  const cTrig = $('df-bc-trigger');
  if (cc) {
    cTrig.innerHTML = flagFor(cc) + ' ' + countryTxt(cc);
    cTrig.dataset.value = cc;
  }
  $('s-default-birth-country').value = cc;
  buildSettingsRegionSelect(FAMILY.birthRegion || '');
}

function buildSettingsRegionSelect(preserve) {
  const cc = $('s-default-birth-country').value || '';
  const rows = LIFE.regions[cc] || [];
  const wrap = $('s-br-wrap');
  const free = $('s-default-birth-region-free');
  const isEn = apiLang() === 'en';
  if (rows.length) {
    wrap.style.display = '';
    free.style.display = 'none';
    const opts = [{ value: '', label: '— ' + t('memberModal.regionNone') + ' —' }];
    rows.forEach(r => opts.push({ value: r.ar, label: placeName(r, isEn) }));
    makeSearchableSelect('s-br-trigger', 's-br-drop', opts, val => {
      $('s-default-birth-region').value = val || '';
      $('s-default-birth-region-free').value = '';
    });
    const rTrig = $('s-br-trigger');
    if (preserve) {
      $('s-default-birth-region').value = preserve;
      const found = rows.find(r => r.ar === preserve);
      rTrig.innerHTML = found ? placeName(found, isEn) : preserve;
      rTrig.dataset.value = preserve;
    }
  } else {
    wrap.style.display = 'none';
    $('s-default-birth-region').value = '';
    free.style.display = '';
    free.placeholder = t('memberModal.regionFreePh');
    free.value = preserve || '';
  }
}

function getSDefaultRegion() {
  const hid = $('s-default-birth-region');
  const free = $('s-default-birth-region-free');
  return (hid && hid.value) || (free && free.value) || '';
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY
   ═══════════════════════════════════════════════════════════════ */
function photoPeekInit(){var w=document.createElement('div');w.id='photo-peek';var im=document.createElement('img');w.appendChild(im);document.body.appendChild(w);var cur=null;function move(e){var r=w.getBoundingClientRect();var x=e.clientX+22,y=e.clientY-r.height/2;if(x+r.width>innerWidth-12)x=e.clientX-r.width-22;if(y<10)y=10;if(y+r.height>innerHeight-10)y=innerHeight-r.height-10;w.style.left=x+'px';w.style.top=y+'px';}function hide(){cur=null;w.style.display='none';}document.addEventListener('mouseover',function(e){var t=e.target;var c=t&&t.closest?t.closest('.mav-img'):null;if(c&&c.complete&&c.naturalWidth){cur=c;im.src=c.currentSrc||c.src;w.style.display='block';move(e);}else{w.style.display='none';}},true);document.addEventListener('mousemove',function(e){if(cur)move(e);},true);document.addEventListener('mouseout',function(e){if(cur&&(!e.relatedTarget||!e.relatedTarget.closest||!e.relatedTarget.closest('.mav-img')))hide();},true);}photoPeekInit();
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function askConfirm(message) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay show';
    ov.style.zIndex = '900';
    ov.innerHTML = `<div class="modal" style="max-width:420px;padding:22px;text-align:center">
      <div style="font-size:15px;line-height:1.8;color:var(--text);margin-bottom:18px;white-space:pre-line">${esc(message)}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="sidebar-btn sidebar-btn-red" id="ask-ok" style="flex:1;justify-content:center">${esc(window.t('common.delete'))}</button>
        <button class="sidebar-btn sidebar-btn-ghost" id="ask-cancel" style="flex:1;justify-content:center">${esc(window.t('common.cancel'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = v => { ov.remove(); resolve(v); };
    ov.onclick = e => { if (e.target === ov) done(false); };
    ov.querySelector('#ask-ok').onclick = () => done(true);
    ov.querySelector('#ask-cancel').onclick = () => done(false);
  });
}

function apiLang() { return window.i18n ? i18n.current() : 'en'; }

function placeName(o, isEn) {
  return o.local || (isEn ? o.en : o.ar);
}

function listSep() { return (window.i18n && i18n.current() === 'ar') ? '، ' : ', '; }

const REL_KEYS = { 'أب':'father','أم':'mother','ابن':'son','بنت':'daughter','زوج':'husband','زوجة':'wife','جد':'grandfather','جدة':'grandmother','أخ':'brother','أخت':'sister','عم':'paternalUncle','عمة':'paternalAunt','خال':'maternalUncle','خالة':'maternalAunt','ابن أخ':'nephew','بنت أخ':'nieceBrother','ابن أخت':'nephewSister','بنت أخت':'nieceSister','حفيد':'grandson','حفيدة':'granddaughter','صهر':'sonInLaw','كنة':'daughterInLaw' };

/* Birth-date-unknown support.
   The backend always requires a stored birth date, so relatives whose birth
   date is not known yet are saved with this neutral sentinel date and treated
   as "unknown" everywhere in the UI (no fake age, zodiac or birthday). */
const BIRTH_UNKNOWN = '1800-01-01';
function hasRealBirth(m) { return !!(m && m.birthDate && String(m.birthDate) !== BIRTH_UNKNOWN); }
function isBirthUnknown(m) { return !!(m && m.birthDate && String(m.birthDate) === BIRTH_UNKNOWN); }
function birthTxt(m) { return hasRealBirth(m) ? String(m.birthDate) : ''; }
function ageYears(m) { return hasRealBirth(m) && m.age ? m.age.years : null; }
function zodiacOf(m) { return hasRealBirth(m) && m.zodiac ? m.zodiac : null; }
function relTxt(rel) {
  if (!rel) return rel;
  const k = REL_KEYS[rel];
  if (k) {
    const a = 'rel.' + k, va = t(a);
    if (va && va !== a) return va;
    const b = 'memberModal.relation.' + k, vb = t(b);
    if (vb && vb !== b) return vb;
  }
  return rel;
}

function autoRel(m) {
  if (!m) return '';
  if (m.parentId) {
    const p = members.find(x => x.id === m.parentId);
    return m.gender === 'female'
      ? t('relAuto.daughterOf', { name: p ? p.name : '…' })
      : t('relAuto.sonOf', { name: p ? p.name : '…' });
  }
  if (m.spouseId) {
    const s = members.find(x => x.id === m.spouseId);
    return m.gender === 'female'
      ? t('relAuto.wifeOf', { name: s ? s.name : '…' })
      : t('relAuto.husbandOf', { name: s ? s.name : '…' });
  }
  return t('relAuto.head');
}

function dispRel(m) {
  if (!m) return '';
  return m.relation ? relTxt(m.relation) : autoRel(m);
}

function relSuffix(m) {
  if (!m) return '';
  return (m.relation || m.parentId || m.spouseId) ? ' (' + esc(dispRel(m)) + ')' : '';
}
function dispName(m) {
  if (!m) return '';
  const fmt = localStorage.getItem('kielora_name_format') || 'triple';
  if (fmt === 'single' || !m.name) return m.name || '';
  const parts = [m.name];
  let f = m.parentId ? members.find(x => String(x.id) === String(m.parentId)) : null;
  if (f && f.name) {
    parts.push(f.name);
    if (fmt === 'triple' && f.parentId) {
      const g = members.find(x => String(x.id) === String(f.parentId));
      if (g && g.name) parts.push(g.name);
    }
  }
  return parts.join(' ');
}


/* ── Server-Arabic label localization ──
   The backend computes some relationship labels from the Arabic catalog
   regardless of the requested UI language (e.g. path nodes are labelAr).
   Build a reverse index ar-value → i18n-key → t(key) so we can translate
   those labels into the active language on the client. */
let _arRev = null;
let _arRevReady = false;
function normArK(v) {
  return String(v == null ? '' : v).normalize('NFKD').toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}
function i18nDir() {
  const scripts = document.scripts;
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src || '';
    if (/\/i18n\.js(\?|$)/.test(src)) return src.replace(/\/i18n\.js.*$/, '/i18n/');
  }
  return 'static/vendor/i18n/';
}
async function ensureCatalogs() {
  if (_arRev) return true;
  try {
    const base = i18nDir();
    const [en, ar] = await Promise.all([
      fetch(base + 'en.json').then(r => r.json()),
      fetch(base + 'ar.json').then(r => r.json())
    ]);
    _arRev = {};
    Object.keys(ar || {}).forEach(k => {
      const v = ar[k];
      if (typeof v === 'string' && v) {
        const n = normArK(v);
        if (!_arRev[n]) _arRev[n] = k;
      }
    });
    _arRevReady = true;
    return true;
  } catch (e) {
    _arRev = null;
    return false;
  }
}
function arNum(s) {
  const map = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
  return parseInt(String(s).split('').map(c => (map[c] != null ? map[c] : c)).join(''), 10);
}
function arLocalize(s) {
  if (!s) return s;
  if (typeof s !== 'string' || !/[\u0600-\u06FF]/.test(s)) return s;
  if (!_arRev) return s;
  const n = normArK(String(s));
  if (_arRev[n]) return t(_arRev[n]);
  let degree = null, removed = null, core = n, m;
  m = core.match(/من الدرجه\s*([0-9٠-٩]+)/);
  if (m) { degree = arNum(m[1]); core = core.replace(m[0], '').replace(/\s+/g, ' ').trim(); }
  else {
    m = core.match(/ازاله\s*([0-9٠-٩]+)\s*جيل[ايأ]?/);
    if (m) { removed = arNum(m[1]); core = core.replace(m[0], '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim(); }
  }
  let best = null, bestLen = 0;
  if (core && _arRev[core]) { best = _arRev[core]; bestLen = core.length; }
  Object.keys(_arRev).forEach(k => {
    if (k.length > bestLen && core.indexOf(k) === 0) { best = _arRev[k]; bestLen = k.length; }
  });
  if (best) {
    let res = t(best);
    const rest = core.slice(bestLen).replace(/^[\s()]+|[\s()]+$/g, '');
    if (rest) {
      const parts = rest.split(/\s+/).map(tok => (_arRev[tok] ? t(_arRev[tok]) : tok));
      res += (res ? ' ' : '') + parts.join(' ');
    }
    const origParen = /^\(/.test(String(s));
    if (degree != null) { res += ' ' + t('rel.degreeSuffixAr').replace('{n}', String(degree)); }
    if (removed != null) { res += ' ' + t('rel.removedSuffixAr').replace('{n}', String(removed)); }
    if (origParen && res.indexOf('(') !== 0) res = '(' + res + ')';
    return res;
  }
  if (degree != null || removed != null) {
    let res = '';
    if (degree != null) { res = t('rel.degreeSuffixAr').replace('{n}', String(degree)); }
    if (removed != null) { res += (res ? ' ' : '') + t('rel.removedSuffixAr').replace('{n}', String(removed)); }
    if (/^\(/.test(String(s)) && res.indexOf('(') !== 0) res = '(' + res + ')';
    return res;
  }
  const parts = String(s).split(/\s+/).map(tok => (_arRev[tok] ? t(_arRev[tok]) : tok));
  const joined = parts.join(' ');
  return joined !== String(s) ? joined : s;
}
function relLabel(s) {
  const tt = relTxt(s);
  if (tt && tt !== s) return tt;
  return arLocalize(s);
}

async function api(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const L = apiLang();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (url.indexOf('?') === -1) url += '?lang=' + L;
    else url += (url.endsWith('?') || url.endsWith('&') ? '' : '&') + 'lang=' + L;
    let body = opts.body;
    if (body && typeof body === 'object') body = { ...body, lang: L };
    const res = await fetch(url, { ...opts, headers, body, signal: ctl.signal });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || t('toast.serverError')); }
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') showToast('⏱️ ' + (t('toast.timeout') || 'Request timed out'));
    else showToast('❌ ' + err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function $(id) { return document.getElementById(id); }
function $$(sel, root) { return (root || document).querySelectorAll(sel); }

/* ═══════════════════════════════════════════════════════════════
   XSS ESCAPING — wrap all user-controlled fields rendered via
   innerHTML templates with esc().
   ═══════════════════════════════════════════════════════════════ */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function hl(v, q) {
  const s = String(v == null ? '' : v);
  const i = s.toLowerCase().indexOf(String(q || '').toLowerCase());
  if (i < 0 || !q) return esc(s);
  return esc(s.slice(0, i)) + '<b>' + esc(s.slice(i, i + q.length)) + '</b>' + esc(s.slice(i + q.length));
}
function normAr(v) {
  return String(v == null ? '' : v).normalize('NFKD').toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}
function fuzzyScore(q, v) {
  const a = normAr(v), b = normAr(q);
  if (!a || !b) return -1;
  if (a === b) return 10000;
  if (a.startsWith(b)) return 8000 - (a.length - b.length);
  if (a.includes(b)) return 6000 - (a.length - b.length);
  if (b.length < 3 || a.length < b.length - 1) return -1;
  const len = 200;
  let prev = [], cur = [];
  for (let j = 0; j <= b.length && j <= len; j++) prev[j] = j;
  const maxD = Math.max(2, Math.floor((b.length + 1) / 3));
  let best = a.length > len ? a.length : a.length + maxD;
  const N = Math.min(a.length, len);
  for (let i = 1; i <= N; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length && j <= len; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (cur[b.length] < best) best = cur[b.length];
  }
  if (best > maxD) return -1;
  return 4000 - best * 50;
}

/* ═══════════════════════════════════════════════════════════════
   DATA LOADING
   ═══════════════════════════════════════════════════════════════ */
async function loadMembers() {
  const params = new URLSearchParams();
  params.set('lang', apiLang());
  if (searchQ) params.set('search', searchQ);
  const fn = $('filter-name')?.value;
  if (fn && fn !== searchQ) params.set('search', fn);
  const ff = $('filter-family')?.value;
  if (ff) params.set('family', ff);
  const fz = $('filter-zodiac')?.value;
  if (fz) params.set('zodiac', fz);
  const fg = $('filter-gender')?.value;
  if (fg) params.set('gender', fg);
  const fm = $('filter-month')?.value;
  if (fm) params.set('month', fm);
  const fr = $('filter-relation')?.value;
  if (fr) params.set('relation', fr);
  const fd = $('filter-deceased')?.value;
  if (fd) params.set('deceased', fd);
  params.set('groupBy', $('filter-group')?.value || 'none');
  params.set('sortCol', sortCol);
  params.set('sortDir', sortDir === 1 ? 'asc' : 'desc');
  const data = await api('/api/members?' + params);
  if (data) { members = data.members || []; groupsData = data.grouped || null; }
  return data || { members: members };
}

/* Detect and break parentId cycles caused by older edits. A circular parent
   chain makes the backend family/stats endpoints hang, which froze the
   dashboard and the tree. We walk parent chains with a guarded traversal and
   clear the offending parentId (last link that closes the cycle). */
let _cycleCheckDone = false;
async function healParentCycles() {
  if (_cycleCheckDone) return;
  _cycleCheckDone = true;
  if (!members || !members.length) return;
  const byId = new Map();
  members.forEach(m => byId.set(String(m.id), m));
  const fix = new Set();
  members.forEach(m => {
    let cur = m, seen = new Set();
    while (cur && cur.parentId && byId.has(String(cur.parentId))) {
      const k = String(cur.id);
      if (seen.has(k)) { fix.add(k); break; }
      seen.add(k);
      cur = byId.get(String(cur.parentId));
    }
  });
  for (const id of fix) {
    const p = byId.get(id);
    if (p && p.parentId) {
      p.parentId = null;
      await api(`/api/members/${id}`, { method: 'PUT', body: JSON.stringify({ parentId: null }) });
    }
  }
  if (fix.size) {
    showToast('🔄 ' + (t('toast.circularRepaired') || 'Fixed circular parent links'));
  }
}

/* ═══════════════════════════════════════════════════════════════
   SIBLING ORDER (manual order stored in the head member's notes)
   Hidden marker: ⟦SIB⟧["id1","id2",...]⟦/SIB⟧
   ═══════════════════════════════════════════════════════════════ */
const SIB_OPEN = '⟦SIB⟧', SIB_CLOSE = '⟦/SIB⟧';

function sibOrderOf(notes) {
  if (!notes) return null;
  const i = notes.indexOf(SIB_OPEN);
  if (i < 0) return null;
  const j = notes.indexOf(SIB_CLOSE, i + SIB_OPEN.length);
  if (j < 0) return null;
  try {
    const arr = JSON.parse(notes.slice(i + SIB_OPEN.length, j));
    return Array.isArray(arr) ? arr.map(String) : null;
  } catch (e) { return null; }
}

function sibStripNotes(notes) {
  if (!notes) return '';
  const i = notes.indexOf(SIB_OPEN);
  if (i < 0) return notes;
  const j = notes.indexOf(SIB_CLOSE, i + SIB_OPEN.length);
  if (j < 0) return notes;
  return (notes.slice(0, i) + notes.slice(j + SIB_CLOSE.length)).replace(/^\s+|\s+$/g, ' ').trim();
}

function sibNotesWith(notes, ids) {
  const plain = sibStripNotes(notes || '');
  const tag = SIB_OPEN + JSON.stringify(ids) + SIB_CLOSE;
  return plain ? plain + '\n' + tag : tag;
}

function memberById(id) { return members.find(x => String(x.id) === String(id)) || null; }

/* Rank for a member's child-list position: reads order stored on their
   parent (or the parent's spouse, since order is saved on the head). */
function sibRankOf(m) {
  if (!m || !m.parentId) return null;
  const p = memberById(m.parentId);
  const ords = [];
  const o1 = p ? sibOrderOf(p.notes) : null;
  if (o1) ords.push(o1);
  if (p && p.spouseId) {
    const sp = memberById(p.spouseId);
    const o2 = sp ? sibOrderOf(sp.notes) : null;
    if (o2) ords.push(o2);
  }
  for (const ord of ords) {
    const ix = ord.indexOf(String(m.id));
    if (ix >= 0) return ix;
  }
  return null;
}

/* Sort a member array youngest-first; manual order (per parent) wins, then
   real birth date (youngest first), then name. Stable fallback keeps order. */
function sibSortMembers(arr) {
  return arr.slice().sort((a, b) => {
    const ra = sibRankOf(a), rb = sibRankOf(b);
    if (ra != null || rb != null) {
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    }
    const ha = hasRealBirth(a), hb = hasRealBirth(b);
    if (ha && hb) return String(b.birthDate).localeCompare(String(a.birthDate));
    if (ha) return -1;
    if (hb) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });
}

function sibSortIds(ids, headId) {
  const head = memberById(headId);
  const ords = [];
  const o1 = head ? sibOrderOf(head.notes) : null;
  if (o1) ords.push(o1);
  if (head && head.spouseId) {
    const sp = memberById(head.spouseId);
    const o2 = sp ? sibOrderOf(sp.notes) : null;
    if (o2) ords.push(o2);
  }
  const arr = [];
  const seen = new Set();
  for (const ord of ords) ord.forEach(id => {
    if (ids.some(x => String(x) === String(id)) && !seen.has(String(id))) { seen.add(String(id)); arr.push(id); }
  });
  ids.forEach(id => { if (!seen.has(String(id))) { seen.add(String(id)); arr.push(id); } });
  return arr;
}

/* Unified children list of a couple head (own + spouse kids, ordered). */
function sibChildIds(headId) {
  const head = memberById(headId);
  if (!head) return [];
  const sp = head.spouseId ? memberById(head.spouseId) : null;
  const ids = [];
  const seen = new Set();
  [head, sp].forEach(p => {
    if (!p) return;
    members.forEach(c => {
      if (String(c.parentId) === String(p.id) && !seen.has(String(c.id))) { seen.add(String(c.id)); ids.push(c.id); }
    });
  });
  return sibSortIds(ids, headId);
}

window.sibStripNotes = sibStripNotes;
window.sibNotesWith = sibNotesWith;
window.sibSortMembers = sibSortMembers;
window.sibChildIds = sibChildIds;

/* ═══════════════════════════════════════════════════════════════
   SEARCHABLE SELECT
   ═══════════════════════════════════════════════════════════════ */
function makeSearchableSelect(triggerId, dropId, options, onChange) {
  const trigger = $(triggerId);
  const drop = $(dropId);
  if (!trigger || !drop) return;

  if (trigger.getAttribute('data-init') === '1') {
    trigger._opts = options;
    const sel = options.find(o => o.value === trigger.dataset.value);
    if (sel) trigger.innerHTML = sel.label;
    return;
  }
  trigger.setAttribute('data-init', '1');
  trigger._opts = options;
  let open = false, filtered = [...options], selected = options.find(o => o.value === '') || null;

  function renderOpts(container) {
    let html = '';
    if (!filtered.length) {
      container.innerHTML = '<div class="sel-empty">' + t('table.noResults') + '</div>';
      return;
    }
    html = filtered.map(o =>
      `<div class="sel-opt${o.value === selected?.value ? ' active' : ''}" data-value="${o.value}">${o.label}</div>`
    ).join('');
    container.innerHTML = html || '<div class="sel-empty">' + t('table.noResults') + '</div>';
    container.querySelectorAll('.sel-opt').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = el.dataset.value;
        selected = options.find(o => o.value === val) || null;
        trigger.innerHTML = selected ? selected.label : options[0]?.label || '';
        trigger.dataset.value = val || '';
        const hid = $(triggerId.replace('-trigger', '')) || $(triggerId.replace('-trigger', '-id'));
        if (hid) hid.value = val || '';
        close();
        if (onChange) onChange(val);
      });
    });
  }

  function close() {
    drop.classList.remove('show');
    trigger.classList.remove('open');
    open = false;
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) { close(); return; }
    open = true;
    filtered = trigger._opts.filter(o => o.value !== '__add__');
    drop.innerHTML = `
      <div class="sel-search"><input type="text" placeholder="${t('searchableSelect.search')}" autocomplete="off"></div>
      <div class="sel-options"></div>
      <button type="button" class="sel-add" id="sel-add-${dropId}">＋ ${t('common.addMemberShort')}</button>`;
    const searchInput = drop.querySelector('input');
    const optionsContainer = drop.querySelector('.sel-options');
    const addBtn = drop.querySelector('.sel-add');
    const hasAdd = trigger._opts.some(o => o.value === '__add__');
    if (addBtn) addBtn.style.display = hasAdd ? 'block' : 'none';
    if (addBtn) {
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        if (onChange) onChange('__add__');
      });
    }
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      filtered = trigger._opts.filter(o => o.value !== '__add__' && o.label.toLowerCase().includes(q));
      renderOpts(optionsContainer);
    });
    renderOpts(optionsContainer);
    drop.classList.add('show');
    trigger.classList.add('open');
    setTimeout(() => searchInput?.focus(), 50);
  });

  document.addEventListener('click', (e) => {
    if (!trigger.contains(e.target) && !drop.contains(e.target)) close();
  });
}

/* ═══════════════════════════════════════════════════════════════
   PHASE C — SOURCES & EVIDENCE
   ═══════════════════════════════════════════════════════════════ */
function confLabel(c) { return t('confidence.' + c) || c; }
function confBadge(c) { return '<span class="conf-badge conf-' + c + '">' + esc(confLabel(c)) + '</span>'; }
function srcTypeLabel(ty) { return t('sources.type.' + ty) || ty; }
function capStr(s) { return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s; }
function claimFieldLabel(f) {
  if (!f || f === 'general') return t('evidence.general');
  const key = 'evidence.field' + f.split('_').map(capStr).join('');
  const lab = t(key);
  return (lab && lab !== key) ? lab : f;
}
function fieldKeyFor(label) {
  const map = { 'birth_date':'birth_date','death_date':'death_date','birth_place':'birth_place',
    'marriage_date':'marriage_date','father':'father','mother':'mother','spouse':'spouse',
    'residence':'residence','migration':'migration','occupation':'occupation','education':'education','name':'name' };
  return map[label] || 'other';
}

async function renderSources() {
  const con = $('view-sources');
  con.innerHTML = '<div class="loading">' + esc(t('sources.title')) + '…</div>';
  if (window._srcListReady !== true) { await loadMembers(); window._srcListReady = true; }
  const data = await api('/api/sources');
  window._srcs = (data && data.sources) || [];
  con.innerHTML = `
    <div class="tbl-toolbar" style="flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:20px">📚</span>
        <span style="font-weight:800;font-size:16px">${esc(t('sources.title'))}</span>
      </div>
      <input type="search" id="src-search" placeholder="${esc(t('sources.search'))}" autocomplete="off"
        class="tbl-select" style="flex:1;min-width:140px">
      <button class="tb-btn tb-btn-gold" id="btn-add-source">➕ ${esc(t('sources.add'))}</button>
    </div>
    <div class="src-grid">
      <div class="src-col">
        <div class="src-sub">${esc(t('sources.listHeader'))} <span style="font-weight:400">(${window._srcs.length})</span></div>
        <div class="src-list" id="src-list"></div>
      </div>
      <div class="src-col">
        <div class="src-sub">${esc(t('evidence.title'))}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--muted)">${esc(t('evidence.member'))}</label>
          <select id="ev-member" class="tbl-select" style="flex:1;min-width:150px"></select>
        </div>
        <div id="ev-panel"><div class="empty-state">${esc(t('sources.search'))}</div></div>
      </div>
    </div>
    <div id="src-detail" style="margin-top:16px"></div>`;

  const search = $('src-search');
  search.addEventListener('input', () => renderSourceList(search.value));
  $('btn-add-source').onclick = openSourceModal;

  renderSourceList('');
  fillMemberPicker();

  const evSel = $('ev-member');
  evSel.addEventListener('change', () => {
    if (evSel.value) renderEvidence(evSel.value);
    else $('ev-panel').innerHTML = '<div class="empty-state">' + esc(t('sources.search')) + '</div>';
  });
  if (evSel.value) renderEvidence(evSel.value);
  $('src-detail').innerHTML = '';
}

function fillMemberPicker() {
  const sel = $('ev-member');
  sel.innerHTML = '<option value="">' + esc(t('evidence.chooseMember')) + '</option>' +
    members.filter(m => !m.deleted).map(m => '<option value="' + esc(m.id) + '">' + esc(dispName(m)) + '</option>').join('');
}

function renderSourceList(q) {
  const list = $('src-list');
  const s = (q || '').toLowerCase();
  const rows = window._srcs.filter(x => !s || (x.title + ' ' + (x.author || '') + ' ' + (x.repository || '')).toLowerCase().indexOf(s) !== -1);
  list.innerHTML = rows.length ? rows.map(x => `
    <div class="src-item" data-id="${esc(x.id)}">
      <div class="src-item-title">${esc(srcTypeLabel(x.type))} · ${esc(x.title)}</div>
      <div class="src-item-meta">
        <span>${esc(x.author || '')}</span>${x.date ? '<span>· ' + esc(x.date) + '</span>' : ''}
        ${x.repository ? '<span>· ' + esc(x.repository) + '</span>' : ''}
        ${x.citationCount ? '<span class="src-cites">📄 ' + x.citationCount + '</span>' : ''}
      </div>
      ${x.conflictHint ? '<div style="font-size:10px;color:#e06a5a;margin-top:4px">⚠</div>' : ''}
      <div class="src-item-actions">
        <button class="mini-btn" data-act="open">👁</button>
        <button class="mini-btn" data-act="edit">✏️</button>
        <button class="mini-btn" data-act="del">🗑️</button>
      </div>
    </div>`).join('')
    : '<div class="empty-state">' + esc(t('sources.empty')) + '</div>';

  list.querySelectorAll('.src-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      const act = ev.target.closest('.mini-btn')?.dataset.act || 'open';
      const id = item.dataset.id;
      if (act === 'del') deleteSource(id);
      else if (act === 'edit') openSourceModal(id);
      else openSourceDetail(id);
    });
  });
}

function openSourceModal(sourceId) {
  const existing = (window._srcs || []).find(x => x.id === sourceId);
  let overlay = $('src-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = 'src-overlay';
    document.body.appendChild(overlay);
  }
  const f = (v) => esc(v || '');
  const AV = ['document','certificate','civil_registry','family_register','census','church','mosque','cemetery','newspaper','book','archive','website','dna_test','oral_history','family_document','photograph','letter','video','audio','other'];
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${existing ? esc(t('sources.edit')) : esc(t('sources.add'))}</div>
      <div class="src-modal-body">
        <div class="field"><label>${esc(t('sources.colTitle'))} *</label><input type="text" id="sf-title" value="${f(existing && existing.title)}"></div>
        <div class="field"><label>${esc(t('sources.type'))}</label><select id="sf-type">${AV.map(tv => '<option value="' + tv + '"' + ((existing && existing.type === tv) ? ' selected' : '') + '>' + esc(srcTypeLabel(tv)) + '</option>').join('')}</select></div>
        <div class="field"><label>${esc(t('sources.author'))}</label><input type="text" id="sf-author" value="${f(existing && existing.author)}"></div>
        <div class="field"><label>${esc(t('sources.publisher'))}</label><input type="text" id="sf-publisher" value="${f(existing && existing.publisher)}"></div>
        <div class="field"><label>${esc(t('sources.colDate'))}</label><input type="text" id="sf-date" value="${f(existing && existing.date)}"></div>
        <div class="field"><label>${esc(t('sources.repository'))}</label><input type="text" id="sf-repository" value="${f(existing && existing.repository)}"></div>
        <div class="field"><label>${esc(t('sources.url'))}</label><input type="text" id="sf-url" value="${f(existing && existing.url)}"></div>
        <div class="field"><label>${esc(t('sources.archiveId'))}</label><input type="text" id="sf-archive" value="${f(existing && existing.archiveId)}"></div>
        <div class="field"><label>${esc(t('sources.page'))}</label><input type="text" id="sf-page" value="${f(existing && existing.page)}"></div>
        <div class="field"><label>${esc(t('sources.volume'))}</label><input type="text" id="sf-volume" value="${f(existing && existing.volume)}"></div>
        <div class="field"><label>${esc(t('sources.recordNo'))}</label><input type="text" id="sf-record" value="${f(existing && existing.recordNo)}"></div>
        <div class="field"><label>${esc(t('sources.accessDate'))}</label><input type="date" id="sf-access" value="${f(existing && existing.accessDate)}"></div>
        <div class="field span2"><label>${esc(t('sources.notes'))}</label><textarea id="sf-notes" rows="2">${f(existing && existing.notes)}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="tb-btn" id="src-close">${esc(t('common.cancel'))}</button>
        <button class="tb-btn tb-btn-gold" id="src-save">💾 ${esc(t('common.save'))}</button>
      </div>
    </div>`;
  overlay.classList.add('show');
  $('src-close').onclick = () => { overlay.classList.remove('show'); };
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.classList.remove('show'); });
  $('src-save').onclick = async () => {
    const payload = {
      title: $('sf-title').value.trim(), type: $('sf-type').value,
      author: $('sf-author').value.trim(), publisher: $('sf-publisher').value.trim(),
      date: $('sf-date').value.trim(), repository: $('sf-repository').value.trim(),
      url: $('sf-url').value.trim(), archiveId: $('sf-archive').value.trim(),
      page: $('sf-page').value.trim(), volume: $('sf-volume').value.trim(),
      recordNo: $('sf-record').value.trim(), accessDate: $('sf-access').value,
      notes: $('sf-notes').value.trim(),
    };
    if (!payload.title) { showToast('❌ ' + t('toast.nameRequired')); return; }
    const res = await api(existing ? '/api/sources/' + existing.id : '/api/sources',
      { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (!res) return;
    showToast('✅ ' + t(existing ? 'toast.updated' : 'toast.added'));
    overlay.classList.remove('show');
    await renderSources();
  };
}

async function deleteSource(id) {
  if (!(await askConfirm(t('sources.deleteConfirm')))) return;
  const res = await api('/api/sources/' + id, { method: 'DELETE' });
  if (!res) return;
  showToast('✅ ' + t('toast.deleted'));
  await renderSources();
}

async function openSourceDetail(id) {
  const src = window._srcs.find(x => x.id === id) || {};
  const data = await api('/api/citations?source_id=' + encodeURIComponent(id));
  const cits = (data && data.citations) || [];
  const box = $('src-detail');
  box.innerHTML = `
    <div class="src-col">
      <div class="src-sub">${esc(t('sources.selectedHeader'))} — ${esc(src.title || '')} ${'(' + cits.length + ')'}</div>
      ${cits.length ? cits.map(c => `
        <div class="ev-cite">
          <div class="ev-value-h">${confBadge(c.confidence)}
            <b>${esc(claimFieldLabel(c.claimField))}</b> → <span>${esc(c.claimValue)}</span>
            ${c.memberId ? '<span style="color:var(--muted)">(' + esc((members.find(m => m.id === c.memberId) || {}).name || '') + ')</span>' : ''}
          </div>
          ${c.quotedText ? '<div class="ev-cite-q">" ' + esc(c.quotedText) + ' "</div>' : ''}
          ${c.reasoning ? '<div style="font-size:11px;color:var(--muted)">' + esc(c.reasoning) + '</div>' : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:4px">${esc(c.sourceTitle || '')}${c.createdAt ? ' · ' + esc(String(c.createdAt).slice(0, 10)) : ''}</div>
        </div>`).join('')
      : '<div class="empty-state">' + esc(t('sources.noCitations')) + '</div>'}
    </div>`;
}

async function renderEvidence(memberId) {
  const panel = $('ev-panel');
  panel.innerHTML = '<div class="loading">…</div>';
  const sum = await api('/api/evidence/summary?member_id=' + encodeURIComponent(memberId));
  const cits = await api('/api/citations?member_id=' + encodeURIComponent(memberId));
  const med = await api('/api/evidence/media?member_id=' + encodeURIComponent(memberId));
  if (!sum) { panel.innerHTML = '<div class="empty-state">' + esc(t('toast.serverError')) + '</div>'; return; }
  const summ = sum.summary || {};
  const fields = summ.fields || {};
  const conflicts = summ.conflicts || [];
  const citations = (cits && cits.citations) || [];
  const media = (med && med.media) || [];
  const memberName = esc((members.find(m => m.id === memberId) || {}).name || '');
  const MEDIA_KINDS = [
    ['image', '🖼️', 'evidence.evMediaImages'],
    ['pdf', '📄', 'evidence.evMediaDocs'],
    ['audio', '🎵', 'evidence.evMediaAudio'],
    ['video', '🎬', 'evidence.evMediaVideo'],
    ['document', '🗂', 'evidence.evMediaOther']
  ];
  const mediaGroupsHtml = MEDIA_KINDS.map(([k, ic, key]) => {
    const items = media.filter(m => m.kind === k);
    if (!items.length) return '';
    return `<div class="profile-sub-title">${ic} ${t(key)} (${items.length})</div>
      <div class="ev-media-grid" id="ev-media-grid">
        ${items.map(m => `
          <div class="ev-media-item" data-mid="${esc(m.id)}">
            ${m.kind === 'image' ? '<img src="' + esc(m.filePath) + '" alt="">'
              : '<div style="display:flex;align-items:center;justify-content:center;height:86px;font-size:28px">' + ic + '</div>'}
            <div class="ev-media-cap">${esc(m.title || '')}</div>
            <button class="ev-media-del" data-del="1">✕</button>
          </div>`).join('')}
      </div>`;
  }).join('');
  const conflicting = conflicts.map(c => c.field);
  let fieldsHtml = '';
  Object.keys(fields).forEach(fld => {
    const vals = fields[fld];
    const hasConflict = conflicting.indexOf(fld) !== -1;
    fieldsHtml += `<div class="ev-group">
      <div class="ev-group-h">${esc(claimFieldLabel(fld))} ${hasConflict ? '<span style="color:#e06a5a;font-size:11px">⚠</span>' : ''}</div>
      ${Object.keys(vals).map(v => {
        const g = vals[v];
        return `<div class="ev-value">
          <div class="ev-value-h"><b>${esc(v)}</b> ${confBadge(g.bestConfidence)}
            <span style="font-size:10px;color:var(--muted)">${esc(t('evidence.bestConfidence'))}</span>
            <span style="font-size:10px;color:var(--muted)">(${g.citations.length})</span></div>
          ${(g.citations || []).map(cc => `
            <div class="ev-cite">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <b style="font-size:11px">${esc(cc.sourceTitle || t('sources.type.other'))}</b>
                ${cc.confidence !== g.bestConfidence ? confBadge(cc.confidence) : ''}
                <button class="mini-btn" style="margin-left:auto" data-dr="ev" data-cid="${esc(cc.id)}">🗑️</button>
              </div>
              ${cc.quotedText ? '<div class="ev-cite-q">" ' + esc(cc.quotedText) + ' "</div>' : ''}
              ${cc.reasoning ? '<div style="font-size:11px;color:var(--muted)">' + esc(cc.reasoning) + '</div>' : ''}
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  });
  panel.innerHTML = `
    ${conflicts.length ? `<div class="conflict-banner">${esc(t('evidence.conflictDetected'))}</div>` : ''}
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">${esc(t('evidence.claimsFor'))} ${memberName}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px">${esc(t('evidence.computedNote'))}</div>
    <div id="ev-fields">${fieldsHtml || '<div class="empty-state">' + esc(t('evidence.noClaims')) + '</div>'}</div>
    <div style="margin-top:14px">
      <div class="src-sub" style="margin-bottom:8px">${esc(t('evidence.addClaim'))}</div>
      <div class="ev-form">
        <label>${esc(t('evidence.field'))}<select id="cf-field"><option value="birth_date">${esc(t('evidence.fieldBirthDate'))}</option><option value="death_date">${esc(t('evidence.fieldDeathDate'))}</option><option value="name">${esc(t('evidence.fieldName'))}</option><option value="birth_place">${esc(t('evidence.fieldBirthPlace'))}</option><option value="marriage_date">${esc(t('evidence.fieldMarriageDate'))}</option><option value="father">${esc(t('evidence.fieldFather'))}</option><option value="mother">${esc(t('evidence.fieldMother'))}</option><option value="spouse">${esc(t('evidence.fieldSpouse'))}</option><option value="residence">${esc(t('evidence.fieldResidence'))}</option><option value="migration">${esc(t('evidence.fieldMigration'))}</option><option value="occupation">${esc(t('evidence.fieldOccupation'))}</option><option value="education">${esc(t('evidence.fieldEducation'))}</option><option value="other">${esc(t('evidence.fieldOther'))}</option></select></label>
        <label>${esc(t('evidence.source'))}<select id="cf-source"><option value="">—</option>${window._srcs.map(s => '<option value="' + esc(s.id) + '">' + esc(s.title) + '</option>').join('')}</select></label>
        <label>${esc(t('evidence.value'))}<input type="text" id="cf-value"></label>
        <label>${esc(t('evidence.bestConfidence'))}<select id="cf-conf">${Object.keys(CONF_LEVELS || {}).concat(['unverified']).filter((v, i, a) => a.indexOf(v) === i).map(c => '<option value="' + c + '">' + esc(confLabel(c)) + '</option>').join('')}</select></label>
        <label class="ev-span">${esc(t('evidence.quote'))}<input type="text" id="cf-quote"></label>
        <label class="ev-span">${esc(t('evidence.reasoning'))}<textarea id="cf-reason" rows="2"></textarea></label>
      </div>
      <button class="tb-btn tb-btn-gold" id="btn-add-citation" style="margin-top:10px">➕ ${esc(t('evidence.addClaim'))}</button>
    </div>
    <div style="margin-top:18px">
      <div class="src-sub">🗂️ ${esc(t('evidence.media'))} (${media.length})</div>
      ${mediaGroupsHtml || '<div class="empty-state">' + esc(t('evidence.noMedia')) + '</div>'}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input type="text" id="up-title" placeholder="${esc(t('evidence.mediaTitle'))}" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit">
        <input type="file" id="up-file" accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf,.mp3,.wav,.ogg,.m4a,.aac,.mp4,.mkv,.mov,.webm" style="max-width:220px">
        <button class="tb-btn" id="btn-up-media">📎 ${esc(t('evidence.addMedia'))}</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">${esc(t('photo.allowedFormats'))}</div>
    </div>`;
  $('btn-add-citation').onclick = () => addCitation(memberId);
  $('btn-up-media').onclick = () => uploadMedia(memberId);
  panel.querySelectorAll('.ev-media-del').forEach(b => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      await deleteMedia(b.closest('.ev-media-item').dataset.mid, memberId);
    };
  });
  panel.querySelectorAll('[data-dr="ev"]').forEach(b => {
    b.onclick = async () => { await deleteCitation(b.dataset.cid, memberId); };
  });
}

const CONF_LEVELS = { confirmed: 6, strong_evidence: 5, probable: 4, possible: 3, disputed: 2, unverified: 1, rejected: 0 };

async function addCitation(memberId) {
  const payload = {
    sourceId: $('cf-source').value, memberId: memberId,
    claimField: $('cf-field').value, claimValue: $('cf-value').value.trim(),
    confidence: $('cf-conf').value || 'unverified',
    quotedText: $('cf-quote').value.trim(), reasoning: $('cf-reason').value.trim(),
  };
  if (!payload.claimValue) { showToast('❌ ' + t('toast.dateRequired')); return; }
  const res = await api('/api/citations', { method: 'POST', body: JSON.stringify(payload) });
  if (!res) return;
  showToast('✅ ' + t('toast.added'));
  $('cf-value').value = ''; $('cf-quote').value = ''; $('cf-reason').value = '';
  await renderEvidence(memberId);
  await renderSources();
}

async function deleteCitation(cid, memberId) {
  if (!(await askConfirm(t('common.delete') + '?'))) return;
  const res = await api('/api/citations/' + cid, { method: 'DELETE' });
  if (!res) return;
  showToast('✅ ' + t('toast.deleted'));
  await renderEvidence(memberId);
  await renderSources();
}

async function uploadMedia(memberId) {
  const file = $('up-file').files[0];
  if (!file) { showToast('❌ ' + t('evidence.chooseFile')); return; }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('memberId', memberId);
  fd.append('title', ($('up-title').value || '').trim());
  const res = await fetch('/api/evidence/media?lang=' + apiLang(), { method: 'POST', body: fd });
  let body = null; try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) { showToast('❌ ' + ((body && body.error) || t('toast.serverError'))); return; }
  showToast('✅ ' + t('toast.added'));
  $('up-file').value = ''; $('up-title').value = '';
  await renderEvidence(memberId);
}

async function deleteMedia(mid, memberId) {
  if (!(await askConfirm(t('common.delete') + '?'))) return;
  const res = await api('/api/evidence/media/' + mid, { method: 'DELETE' });
  if (!res) return;
  showToast('✅ ' + t('toast.deleted'));
  await renderEvidence(memberId);
}

/* ═══════════════════════════════════════════════════════════════
   PHASE D — TIMELINE / EVENTS / PLACES
   ═══════════════════════════════════════════════════════════════ */
const EVENT_TYPES_UI = ['birth','baptism','circumcision','naming','marriage','engagement','divorce','separation','residence','migration','education','graduation','employment','military_service','religious','hajj','travel','immigration','emigration','death','burial','cremation','award','publication','property','custom'];
const EVENT_ROLES_UI = ['primary','spouse','child','witness','other'];
const DATE_PRECISIONS_UI = ['day','month','year','about','before','after','between','range','unknown','phrase'];
const PLACE_KINDS_UI = ['country','region','city','town','village','neighborhood','street','building','historical','other'];
const TL_ICONS = { birth:'👶', baptism:'⛪', circumcision:'🕌', naming:'📛', marriage:'💍', engagement:'💐', divorce:'💔', separation:'🚪', residence:'🏠', migration:'🚶', education:'🎓', graduation:'🎉', employment:'💼', military_service:'🪖', religious:'🕌', hajj:'🤲', travel:'✈️', immigration:'🛂', emigration:'🌍', death:'🕯️', burial:'⚰️', cremation:'🔥', award:'🏅', publication:'📰', property:'🏘️', custom:'📌' };

function evTypeLabel(ty) { return t('timeline.type.' + ty) || ty; }
function evTypeIcon(ty) { return TL_ICONS[ty] || '📌'; }
function evPrecLabel(p) { return t('timeline.precision.' + p) || p; }
function evRoleLabel(r) { return t('timeline.role.' + r) || r; }
function placeKindLabel(k) { return t('timeline.kind.' + k) || k; }

async function ensureSources() {
  if (!window._srcs || !window._srcs.length) {
    const d = await api('/api/sources');
    window._srcs = (d && d.sources) || [];
  }
}

async function renderTimeline() {
  const con = $('view-timeline');
  con.innerHTML = '<div class="loading">' + esc(t('timeline.title')) + '…</div>';
  if (!window._tlLoaded) { await loadMembers(); await ensureSources(); window._tlLoaded = true; }
  const st = window._tl || (window._tl = { memberId: '', type: '', placeId: '' });
  const qs = [];
  if (st.memberId) qs.push('member_id=' + encodeURIComponent(st.memberId));
  if (st.type) qs.push('type=' + encodeURIComponent(st.type));
  if (st.placeId) qs.push('place_id=' + encodeURIComponent(st.placeId));
  const d = await api('/api/timeline' + (qs.length ? '?' + qs.join('&') : ''));
  if (!d) { con.innerHTML = '<div class="empty-state">' + esc(t('toast.serverError')) + '</div>'; return; }
  const groups = d.groups || [];
  const scopeActive = FAMILY_SCOPE.selected != null;
  const scopedIds = new Set(filterMembersByScope(FAMILY_SCOPE_FULL && FAMILY_SCOPE_FULL.length ? FAMILY_SCOPE_FULL : members).map(m => String(m.id)));
  const evInScope = e => !scopeActive || (e.memberId && scopedIds.has(String(e.memberId))) || (e.participants || []).some(p => p.memberId && scopedIds.has(String(p.memberId)));
  const scopedGroups = groups.map(g => ({
    year: g.year,
    events: (g.events || []).filter(evInScope)
  })).filter(g => g.events.length);
  const allEvents = scopedGroups.flatMap(g => g.events);
  const memberOpts = (d.members || []).filter(x => scopedIds.has(String(x.id))).map(x => '<option value="' + esc(x.id) + '"' + (st.memberId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  con.innerHTML = `
    <div class="tbl-toolbar" style="flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:20px">🗓️</span>
        <span style="font-weight:800;font-size:16px">${esc(t('timeline.title'))}</span>
      </div>
      <select id="tl-member" class="tbl-select" style="max-width:190px"><option value="">${esc(t('timeline.allMembers'))}</option>${memberOpts}</select>
      <select id="tl-type" class="tbl-select" style="max-width:170px"><option value="">${esc(t('timeline.allTypes'))}</option>${EVENT_TYPES_UI.map(x => '<option value="' + x + '"' + (st.type === x ? ' selected' : '') + '>' + esc(evTypeLabel(x)) + '</option>').join('')}</select>
      <select id="tl-place" class="tbl-select" style="max-width:170px"><option value="">${esc(t('timeline.allPlaces'))}</option>${(d.places || []).map(x => '<option value="' + esc(x.id) + '"' + (st.placeId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('')}</select>
      <span style="flex:1"></span>
      <span class="h-pill">🗓️ ${allEvents.length} ${esc(t('timeline.eventsCount'))}</span>
      <span class="h-pill" title="${esc(t('timeline.documentedCount'))}">📄 ${allEvents.filter(e => (e.citationCount || 0) > 0).length} ${esc(t('timeline.documentedCount'))}</span>
      <button class="tb-btn" id="btn-places">📍 ${esc(t('timeline.managePlaces'))}</button>
      <button class="tb-btn tb-btn-gold" id="btn-add-event">➕ ${esc(t('timeline.addEvent'))}</button>
    </div>
    <div id="tl-groups" style="margin-top:14px"></div>`;
  $('tl-member').addEventListener('change', e => { window._tl.memberId = e.target.value; renderTimeline(); });
  $('tl-type').addEventListener('change', e => { window._tl.type = e.target.value; renderTimeline(); });
  $('tl-place').addEventListener('change', e => { window._tl.placeId = e.target.value; renderTimeline(); });
  $('btn-add-event').onclick = () => openEventModal(null, d);
  $('btn-places').onclick = openPlacesModal;

  const gbox = $('tl-groups');
  if (!scopedGroups.length) { gbox.innerHTML = '<div class="empty-state">' + esc(t('timeline.empty')) + '</div>'; return; }
  gbox.innerHTML = scopedGroups.map(gr => `
    <div class="tl-group">
      <div class="tl-year-h">${gr.year === 'undated' ? esc(t('timeline.undated')) : esc(gr.year)} <span class="tl-count">${gr.events.length}</span></div>
      ${gr.events.map(e => tlEventCard(e)).join('')}
    </div>`).join('');

  gbox.querySelectorAll('.tl-event').forEach(card => {
    const id = card.dataset.id;
    const ev = scopedGroups.flatMap(g => g.events).find(x => x.id === id);
    card.querySelector('button[data-act="edit"]').onclick = () => openEventModal(ev, d);
    card.querySelector('button[data-act="del"]').onclick = () => deleteEvent(id, ev);
    card.querySelector('button[data-act="cite"]').onclick = () => openEventCitations(id, card);
  });
}

function tlDateLabel(e) {
  if (e.datePhrase) return esc(e.datePhrase);
  if (e.date) return esc(e.date);
  return esc(t('timeline.undated'));
}

function tlEventCard(e) {
  const parts = (e.participants || []).map(p => '<span class="tl-chip">' + esc(evRoleLabel(p.role || 'witness')) + ' · ' + esc(p.name || '') + '</span>').join('');
  return `
    <div class="tl-event" data-id="${esc(e.id)}">
      <div class="tl-event-h">
        <span class="tl-type-ic">${evTypeIcon(e.type)}</span>
        <span class="tl-event-t">${esc(evTypeLabel(e.type))}</span>
        <span class="tl-chip">${tlDateLabel(e)}</span>
        ${e.date && e.datePrecision && e.datePrecision !== 'day' ? '<span class="tl-chip">' + esc(evPrecLabel(e.datePrecision)) + '</span>' : ''}
        ${e.placeName ? '<span class="tl-chip">📍 ' + esc(e.placeName) + '</span>' : ''}
        ${e.citationCount ? '<span class="src-cites">📄 ' + e.citationCount + '</span>' : ''}
      </div>
      ${parts ? '<div class="tl-event-meta">' + parts + '</div>' : ''}
      ${e.description ? '<div class="tl-notes">' + esc(e.description) + '</div>' : ''}
      <div class="tl-actions">
        <button class="mini-btn" data-act="cite">📄 ${esc(t('timeline.sources'))}</button>
        <button class="mini-btn" data-act="edit">✏️</button>
        <button class="mini-btn" data-act="del">🗑️</button>
      </div>
      <div class="tl-expanded" style="display:none"></div>
    </div>`;
}

async function openEventCitations(id, card) {
  const box = card.querySelector('.tl-expanded');
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div style="font-size:12px">…</div>';
  await ensureSources();
  const d = await api('/api/events/' + id + '/citations');
  const cits = (d && d.citations) || [];
  const sources = window._srcs;
  box.innerHTML = `
    <div class="src-sub" style="margin:0 0 6px">${esc(t('timeline.sources'))} (${cits.length})</div>
    ${cits.map(c => `
      <div class="ev-cite">
        <div class="ev-value-h">${confBadge(c.confidence)} <b>${esc(c.claimField || t('evidence.general'))}</b> → ${esc(c.claimValue)}
          <button class="mini-btn" style="margin-left:auto" data-cd="${esc(c.id)}">🗑️</button></div>
        ${c.quotedText ? '<div class="ev-cite-q">" ' + esc(c.quotedText) + ' "</div>' : ''}
        ${c.reasoning ? '<div style="font-size:11px;color:var(--muted)">' + esc(c.reasoning) + '</div>' : ''}
        <div style="font-size:10px;color:var(--muted)">${esc(c.sourceTitle || '')}</div>
      </div>`).join('') || '<div style="font-size:12px;color:var(--muted)">' + esc(t('sources.noCitations')) + '</div>'}
    <div class="tl-add-cite">
      <select id="citsrc-${esc(id)}" style="flex:1;min-width:130px"><option value="">${esc(t('timeline.sources'))}…</option>${sources.map(s => '<option value="' + esc(s.id) + '">' + esc(s.title) + '</option>').join('')}</select>
      <input type="text" id="citval-${esc(id)}" placeholder="${esc(t('evidence.value'))}" style="flex:1;min-width:100px">
      <select id="citconf-${esc(id)}">${Object.keys(CONF_LEVELS || {}).map(c => '<option value="' + c + '">' + esc(confLabel(c)) + '</option>').join('')}</select>
      <button class="mini-btn tb-btn-gold" id="citadd-${esc(id)}">➕ ${esc(t('timeline.addCitation'))}</button>
    </div>`;
  box.querySelector('.tl-add-cite button').onclick = async () => {
    const payload = {
      sourceId: $('citsrc-' + id).value,
      claimValue: $('citval-' + id).value.trim(),
      confidence: $('citconf-' + id).value || 'unverified',
    };
    if (!payload.claimValue) { showToast('❌ ' + t('toast.dateRequired')); return; }
    const res = await api('/api/events/' + id + '/citations', { method: 'POST', body: JSON.stringify(payload) });
    if (!res) return;
    showToast('✅ ' + t('toast.added'));
    if (window._tl) renderTimeline();
    else openEventCitations(id, card);
  };
  box.querySelectorAll('[data-cd]').forEach(btn => {
    btn.onclick = async () => {
      await api('/api/citations/' + btn.dataset.cd, { method: 'DELETE' });
      showToast('✅ ' + t('toast.deleted'));
      if (window._tl) renderTimeline(); else openEventCitations(id, card);
    };
  });
}

async function deleteEvent(id, ev) {
  if (!(await askConfirm(t('timeline.deleteEvent')))) return;
  const res = await api('/api/events/' + id, { method: 'DELETE' });
  if (!res) return;
  showToast('✅ ' + t('toast.deleted'));
  await renderTimeline();
}

function participantChipsUi() {
  const arr = window._evPart = (window._evPart || []);
  const area = $('p-area') || document.createElement('div');
  area.id = 'p-area';
  area.className = 'tl-people';
  area.innerHTML = arr.map((p, i) => '<span class="tl-chip">' + esc((members.find(m => m.id === p.memberId) || {}).name || '') + ' · ' + esc(evRoleLabel(p.role)) + ' <button type="button" class="mini-btn" data-ri="' + i + '">✕</button></span>').join('');
  area.querySelectorAll('[data-ri]').forEach(b => {
    b.onclick = () => { window._evPart.splice(+b.dataset.ri, 1); participantChipsUi(); };
  });
  return area;
}

async function openEventModal(ev, d) {
  d = d || ({ members: d && d.members } || {});
  let overlay = $('event-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.id = 'event-overlay'; document.body.appendChild(overlay); }
  if (ev) {
    window._evPart = (ev.participants || []).map(p => ({ memberId: p.memberId, role: p.role || 'witness' }));
  } else {
    window._evPart = [];
  }
  const places = await api('/api/places');
  const plist = (places && places.places) || [];
  const personOpts = members.filter(m => !m.deleted).map(m => '<option value="' + esc(m.id) + '">' + esc(dispName(m)) + '</option>').join('');
  overlay.innerHTML = `
    <div class="modal" style="max-height:92vh;overflow:auto">
      <div class="modal-title">${ev ? esc(t('timeline.editEvent')) : esc(t('timeline.addEvent'))}</div>
      <div class="src-modal-body">
        <div class="field"><label>${esc(t('timeline.precision'))}</label><select id="ef-type">${EVENT_TYPES_UI.map(x => '<option value="' + x + '"' + ((ev && ev.type === x) ? ' selected' : '') + '>' + esc(evTypeLabel(x)) + '</option>').join('')}</select></div>
        <div class="field"><label>${esc(t('timeline.eventDate'))}</label><input type="date" id="ef-date" value="${esc((ev && ev.date) || '')}"></div>
        <div class="field"><label>${esc(t('timeline.precision'))}</label><select id="ef-prec">${DATE_PRECISIONS_UI.map(x => '<option value="' + x + '"' + ((ev && ev.datePrecision === x) ? ' selected' : '') + '>' + esc(evPrecLabel(x)) + '</option>').join('')}</select></div>
        <div class="field"><label>${esc(t('timeline.calendar'))}</label><select id="ef-cal"><option value="gregorian"${(!ev || ev.calendar === 'gregorian') ? ' selected' : ''}>${esc(t('timeline.gregorian'))}</option><option value="hijri"${(ev && ev.calendar === 'hijri') ? ' selected' : ''}>${esc(t('timeline.hijri'))}</option></select></div>
        <div class="field span2"><label>${esc(t('timeline.datePhrase'))}</label><input type="text" id="ef-phrase" value="${esc((ev && ev.datePhrase) || '')}"></div>
        <div class="field"><label>${esc(t('timeline.place'))}</label>
          <div style="display:flex;gap:6px">
            <select id="ef-place" style="flex:1"><option value="">—</option>${plist.map(p => '<option value="' + esc(p.id) + '"' + ((ev && ev.placeId === p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('')}</select>
            <button type="button" class="mini-btn" id="ef-newplace">＋</button>
          </div>
        </div>
        <div class="field"><label>${esc(t('timeline.privacy'))}</label><select id="ef-priv"><option value="family"${(!ev || ev.privacy === 'family') ? ' selected' : ''}>${esc(t('timeline.family'))}</option><option value="private"${(ev && ev.privacy === 'private') ? ' selected' : ''}>${esc(t('timeline.private'))}</option></select></div>
        <div class="field span2"><label>${esc(t('sources.notes'))}</label><input type="text" id="ef-desc" value="${esc((ev && ev.description) || '')}" placeholder="${esc(t('sources.notes'))}"></div>
        <div class="field span2" style="border-top:1px dashed var(--border);padding-top:10px">
          <label>${esc(t('timeline.participants'))}</label>
          <div id="p-area"></div>
          <div class="tl-people">
            <select id="p-member" style="flex:1"><option value="">${esc(t('timeline.peoplePlaceholder'))}</option>${personOpts}</select>
            <select id="p-role">${EVENT_ROLES_UI.map(x => '<option value="' + x + '">' + esc(evRoleLabel(x)) + '</option>').join('')}</select>
            <button type="button" class="mini-btn tb-btn-gold" id="p-add">➕ ${esc(t('timeline.addParticipant'))}</button>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="tb-btn" id="ev-close">${esc(t('common.cancel'))}</button>
        <button class="tb-btn tb-btn-gold" id="ev-save">💾 ${esc(t('common.save'))}</button>
      </div>
    </div>`;
  overlay.classList.add('show');
  const area = participantChipsUi();
  $('p-area').replaceWith(area);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('show'); } });
  $('ev-close').onclick = () => { overlay.classList.remove('show'); };
  $('p-add').onclick = () => {
    const mid = $('p-member').value; if (!mid) return;
    const role = $('p-role').value;
    if (!window._evPart.find(p => p.memberId === mid)) { window._evPart.push({ memberId: mid, role }); participantChipsUi(); }
  };
  $('ev-save').onclick = async () => {
    const payload = {
      type: $('ef-type').value, date: $('ef-date').value,
      datePrecision: $('ef-prec').value, calendar: $('ef-cal').value,
      datePhrase: $('ef-phrase').value.trim(), placeId: $('ef-place').value,
      privacy: $('ef-priv').value, description: $('ef-desc').value.trim(),
      participants: (window._evPart || []).map(p => ({ memberId: p.memberId, role: p.role })),
    };
    const res = await api(ev ? '/api/events/' + ev.id : '/api/events',
      { method: ev ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (!res) return;
    showToast('✅ ' + t(ev ? 'toast.updated' : 'toast.added'));
    overlay.classList.remove('show');
    await renderTimeline();
  };
  const np = $('ef-newplace');
  if (np) np.onclick = () => { if ($('np-inline')) { $('np-inline').remove(); return; }
    const px = document.createElement('div');
    px.id = 'np-inline'; px.className = 'tl-add-cite'; px.style.marginTop = '6px';
    px.innerHTML = `<input type="text" id="np-name" placeholder="${esc(t('timeline.placeName'))}" style="flex:1">
      <select id="np-kind">${PLACE_KINDS_UI.map(k => '<option value="' + k + '">' + esc(placeKindLabel(k)) + '</option>').join('')}</select>
      <input type="text" id="np-region" placeholder="${esc(t('timeline.region'))}" style="flex:1">
      <button type="button" class="mini-btn tb-btn-gold" id="np-save">💾</button>`;
    np.parentElement.appendChild(px);
    $('np-save').onclick = async () => {
      const nm = $('np-name').value.trim(); if (!nm) return;
      const res = await api('/api/places', { method: 'POST', body: JSON.stringify({ name: nm, kind: $('np-kind').value, region: $('np-region').value.trim() }) });
      if (!res) return;
      showToast('✅ ' + t('toast.added'));
      const places2 = await api('/api/places');
      const psel = $('ef-place');
      psel.innerHTML = '<option value="">—</option>' + ((places2 && places2.places) || []).map(p => '<option value="' + esc(p.id) + '"' + (p.id === res.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
      px.remove();
    };
  };
}

async function openPlacesModal() {
  let overlay = $('places-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.id = 'places-overlay'; document.body.appendChild(overlay); }
  const d = await api('/api/places');
  const plist = (d && d.places) || [];
  overlay.innerHTML = `
    <div class="modal" style="max-height:92vh;overflow:auto">
      <div class="modal-title">📍 ${esc(t('timeline.placeHdr'))}</div>
      <div class="src-modal-body">
        <div class="field"><label>${esc(t('timeline.placeName'))} *</label><input type="text" id="np2-name"></div>
        <div class="field"><label>${esc(t('timeline.placeKind'))}</label><select id="np2-kind">${PLACE_KINDS_UI.map(k => '<option value="' + k + '">' + esc(placeKindLabel(k)) + '</option>').join('')}</select></div>
        <div class="field"><label>${esc(t('timeline.countryCode'))}</label><input type="text" id="np2-cc" placeholder="IQ"></div>
        <div class="field"><label>${esc(t('timeline.region'))}</label><input type="text" id="np2-region"></div>
        <div class="field"><label>${esc(t('timeline.city'))}</label><input type="text" id="np2-city"></div>
        <div class="field" style="display:flex;align-items:flex-end"><button class="mini-btn tb-btn-gold" id="np2-save" style="width:100%">➕ ${esc(t('timeline.addPlace'))}</button></div>
      </div>
      <div class="tl-place-list" id="place-list" style="margin-top:12px"></div>
      <div style="display:flex;margin-top:14px;justify-content:flex-end"><button class="tb-btn" id="pl-close">${esc(t('common.cancel'))}</button></div>
    </div>`;
  overlay.classList.add('show');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('show'); } });
  $('pl-close').onclick = () => { overlay.classList.remove('show'); };
  $('np2-save').onclick = async () => {
    const nm = $('np2-name').value.trim(); if (!nm) return;
    const res = await api('/api/places', { method: 'POST', body: JSON.stringify({ name: nm, kind: $('np2-kind').value, countryCode: $('np2-cc').value.trim(), region: $('np2-region').value.trim(), city: $('np2-city').value.trim() }) });
    if (!res) return;
    showToast('✅ ' + t('toast.added'));
    openPlacesModal();
  };
  const lbox = $('place-list');
  lbox.innerHTML = plist.map(p => `
    <span class="tl-place-chip">📍 ${esc(p.name)} (${esc(placeKindLabel(p.kind))})
      <button class="mini-btn" data-pid="${esc(p.id)}">🗑️</button></span>`).join('') || '<div class="empty-state">' + esc(t('timeline.empty')) + '</div>';
  lbox.querySelectorAll('[data-pid]').forEach(b => {
    b.onclick = async () => {
      if (!(await askConfirm(t('timeline.deletePlaceConfirm')))) return;
      const res = await api('/api/places/' + b.dataset.pid, { method: 'DELETE' });
      if (!res) { showToast('❌ ' + t('timeline.placeDeleteBlocked')); openPlacesModal(); return; }
      showToast('✅ ' + t('toast.deleted'));
      openPlacesModal();
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════════════ */
async function switchTab(tab) {
  currentTab = tab;
  try { localStorage.setItem('kielora_tab', tab); } catch (e) {}
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.bn-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.remove('active'));
  const viewEl = $('view-' + tab);
  if (viewEl) viewEl.classList.add('active');

  if (members.length === 0) await loadMembers();
  closeSidebar();
  renderCurrentView();
}

function renderCurrentView() {
  if (currentTab === 'dashboard') renderDashboard();
  else if (currentTab === 'members') renderMembers();
  else if (currentTab === 'relatives') renderRelativesIndex();
  else if (currentTab === 'tree') renderTree();
  else if (currentTab === 'horoscope') renderHoroscope();
  else if (currentTab === 'sources') renderSources();
  else if (currentTab === 'timeline') renderTimeline();
  else if (currentTab === 'trash') renderTrash();
  else if (currentTab === 'settings') renderSettings();
}

/* ═══════════════════════════════════════════════════════════════
   HOROSCOPE (Daily predictions)
   ═══════════════════════════════════════════════════════════════ */
/* ── Chinese zodiac (12 animals) + elements ── */
const CN_CYCLE = ['monkey','rooster','dog','pig','rat','ox','tiger','rabbit','dragon','snake','horse','goat'];
const CN_EL_NAME = { metal:{ar:'معدن',en:'Metal'}, water:{ar:'ماء',en:'Water'}, wood:{ar:'خشب',en:'Wood'}, fire:{ar:'نار',en:'Fire'}, earth:{ar:'تراب',en:'Earth'} };
const CN_NAME = { rat:{ar:'فأر',en:'Rat'}, ox:{ar:'ثور',en:'Ox'}, tiger:{ar:'نمر',en:'Tiger'}, rabbit:{ar:'أرنب',en:'Rabbit'}, dragon:{ar:'تنين',en:'Dragon'}, snake:{ar:'ثعبان',en:'Snake'}, horse:{ar:'حصان',en:'Horse'}, goat:{ar:'خروف',en:'Goat'}, monkey:{ar:'قرد',en:'Monkey'}, rooster:{ar:'ديك',en:'Rooster'}, dog:{ar:'كلب',en:'Dog'}, pig:{ar:'خنزير',en:'Pig'} };
function useCnName(k) { const n = CN_NAME[k]; return n ? _bi(n) : k; }
function _cnTrait(s) { return apiLang() === 'ar' ? s.ar.traits : s.en.traits; }
function _cnPred(s) { return apiLang() === 'ar' ? s.ar.pred : s.en.pred; }
const CN_SIGNS = [
  { key:'rat', sym:'🐀', el:'water', color:'#7fb2ff', luckyNums:[2,3,6], luckyColor:{ar:'أزرق فاتح',en:'light blue'}, compatible:['ox','dragon','monkey'],
    ar:{ traits:'ذكي، سريع البديهة، جذّاب، اجتماعي', pred:'سنة حافلة بالفرص؛ استثمر في علاقاتك وخططك الصغيرة، فالباب مفتوح أمامك.' },
    en:{ traits:'Smart, witty, resourceful, charming', pred:'A year full of chances — invest in relationships and small plans; the door is open for you.' } },
  { key:'ox', sym:'🐂', el:'earth', color:'#c9a86a', luckyNums:[1,4,9], luckyColor:{ar:'ذهبي',en:'golden'}, compatible:['rat','snake','rooster'],
    ar:{ traits:'صادق، صبور، مجتهد، موثوق', pred:'العمل الجاد يؤتي ثماره؛ تقدم ثابت نحو أهدافك مهما بدت بعيدة.' },
    en:{ traits:'Honest, patient, hard-working, dependable', pred:'Hard work pays off; steady progress toward your goals, however far they seem.' } },
  { key:'tiger', sym:'🐅', el:'wood', color:'#7fb27f', luckyNums:[3,7,9], luckyColor:{ar:'أخضر',en:'green'}, compatible:['horse','dog','pig'],
    ar:{ traits:'شجاع، واثق، متحمس، مستقل', pred:'سنة الجرأة؛ كل خطوة شجاعة تأخذك مكانًا جديدًا تستحقه.' },
    en:{ traits:'Brave, confident, passionate, independent', pred:'A year of courage — every bold step takes you somewhere new you deserve.' } },
  { key:'rabbit', sym:'🐇', el:'wood', color:'#a3c7a3', luckyNums:[3,6,9], luckyColor:{ar:'وردي',en:'pink'}, compatible:['goat','dog','pig'],
    ar:{ traits:'لطيف، ذكي، دبلوماسي، هادئ', pred:'سنة الانسجام؛ استمع لقلبك وتجنب الجدال ليضيء وجهك كما يحب الجميع.' },
    en:{ traits:'Gentle, sharp, diplomatic, calm', pred:'A year of harmony — listen to your heart and avoid arguments to keep your shine.' } },
  { key:'dragon', sym:'🐉', el:'earth', color:'#d4a64f', luckyNums:[1,6,7], luckyColor:{ar:'ذهبي',en:'gold'}, compatible:['rat','monkey','rooster'],
    ar:{ traits:'قوي، كاريزمي، متفائل، مبتكر', pred:'سنة التألق؛ طاقتك تفتح الأبواب، فقط ثق بحدسك الإبداعي.' },
    en:{ traits:'Powerful, charismatic, optimistic, innovative', pred:'A year of shine — your energy opens doors; just trust your creative instinct.' } },
  { key:'snake', sym:'🐍', el:'fire', color:'#e07b5c', luckyNums:[2,8,9], luckyColor:{ar:'أحمر',en:'red'}, compatible:['ox','rooster'],
    ar:{ traits:'حكيم، غامض، بديهة عالية، عميق', pred:'سنة الحكمة؛ ادرس خطواتك، فالسرّانية الآن تصنع الفارق.' },
    en:{ traits:'Wise, mysterious, intuitive, deep', pred:'A year of wisdom — study your moves; discretion makes the difference now.' } },
  { key:'horse', sym:'🐎', el:'fire', color:'#d95d39', luckyNums:[2,3,7], luckyColor:{ar:'برتقالي',en:'orange'}, compatible:['tiger','goat','dog'],
    ar:{ traits:'نشيط، حر، سريع، اجتماعي', pred:'سنة الحرية؛ انطلق نحو أحلامك ولا تسمح للقيود بكبح شغفك.' },
    en:{ traits:'Energetic, free-spirited, fast, sociable', pred:'A year of freedom — chase your dreams and never let limits curb your passion.' } },
  { key:'goat', sym:'🐐', el:'earth', color:'#b8966a', luckyNums:[2,7,8], luckyColor:{ar:'بني',en:'brown'}, compatible:['rabbit','horse','pig'],
    ar:{ traits:'مبدع، هادئ، عطوف، فني', pred:'سنة الإبداع؛ مساراتك الفنية تصنع رزقك وسعادتك معًا.' },
    en:{ traits:'Creative, calm, gentle, artistic', pred:'A year of creativity — your artistic paths bring both income and joy.' } },
  { key:'monkey', sym:'🐒', el:'metal', color:'#b9b9c8', luckyNums:[1,7,8], luckyColor:{ar:'رمادي',en:'grey'}, compatible:['rat','dragon','snake'],
    ar:{ traits:'ذكي، مرح، مرن، محطم للأفكار', pred:'سنة الخفة؛ مرونتك الذهنية تحوّل العقبات إلى لعبة تكسبها.' },
    en:{ traits:'Clever, playful, flexible, innovative', pred:'A year of lightness — your mental agility turns obstacles into games you win.' } },
  { key:'rooster', sym:'🐓', el:'metal', color:'#c8b0a0', luckyNums:[5,7,8], luckyColor:{ar:'أبيض',en:'white'}, compatible:['ox','snake','dragon'],
    ar:{ traits:'دقيق، شجاع، ملتزم، لامع', pred:'سنة الدقة؛ اهتمامك بالتفاصيل يميزك ويجلب لك التقدير.' },
    en:{ traits:'Precise, brave, committed, bright', pred:'A year of precision — your eye for detail sets you apart and earns respect.' } },
  { key:'dog', sym:'🐕', el:'earth', color:'#c9a86a', luckyNums:[3,4,9], luckyColor:{ar:'بني داكن',en:'dark brown'}, compatible:['tiger','rabbit','horse'],
    ar:{ traits:'وفي، صادق، شجاع، حامٍ', pred:'سنة الوفاء؛ قلوب أحبائك تتعلق بك أكثر من أي وقت مضى.' },
    en:{ traits:'Loyal, honest, brave, protective', pred:'A year of loyalty — the hearts of your loved ones cling to you more than ever.' } },
  { key:'pig', sym:'🐖', el:'water', color:'#8fb8b8', luckyNums:[2,5,8], luckyColor:{ar:'أزرق',en:'blue'}, compatible:['rabbit','goat','tiger'],
    ar:{ traits:'كريم، متفائل، صادق، محب للراحة', pred:'سنة الخير؛ كرمك يعود إليك أضعافًا، وعملك يحقق الأمنيات.' },
    en:{ traits:'Generous, optimistic, honest, comfortable', pred:'A year of abundance — your generosity returns multiplied and work fulfills wishes.' } }
];
function cnSign(yr) { return CN_CYCLE[(((yr % 12) + 12) % 12)]; }
function cnYears(key) { const out = []; for (let y = 1940; y <= 2050; y++) { if (cnSign(y) === key) out.push(y); } return out; }
function cnElColor(el) { return { metal:'#9aa0bd', water:'#7fb2ff', wood:'#93c47d', fire:'#f4a261', earth:'#c9a86a' }[el] || '#f5c518'; }

/* ── Numerology: life-path numbers ── */
function lifePath(bd) {
  if (!bd) return null;
  const ds = String(bd).replace(/\D/g, '');
  if (!ds) return null;
  let n = ds.split('').reduce((a, c) => a + (+c), 0);
  while (n > 9 && n !== 11 && n !== 22 && n !== 33) n = String(n).split('').reduce((a, c) => a + (+c), 0);
  return String(n);
}
const NUM_INFO = {
  '1': { day:{ar:'الأحد',en:'Sunday'}, color:{ar:'ذهبي وأصفر',en:'gold & yellow'}, lucky:'1, 9, 3',
    ar:{ personality:'قائد بالفطرة طموح ولا يحب التقليد.', strength:'شجاعة، ابتكار، عزيمة', fortune:'سنة القيادة؛ انطلق بثقة وستسبق الجميع.' },
    en:{ personality:'A natural leader — ambitious and allergic to imitation.', strength:'Courage, innovation, drive', fortune:'A year of leadership; move confidently and outpace everyone.' } },
  '2': { day:{ar:'الاثنين',en:'Monday'}, color:{ar:'فضي وباستيل',en:'silver & pastel'}, lucky:'2, 8, 6',
    ar:{ personality:'دبلوماسي هادئ يعرف كيف يجمع الناس.', strength:'تعاطف، دبلوماسية، تعاون', fortune:'سنة التوازن؛ العلاقات تنمو وأنت الأكثر تواصلًا.' },
    en:{ personality:'A calm diplomat who knows how to bring people together.', strength:'Empathy, diplomacy, teamwork', fortune:'A year of balance; relationships grow while you connect.' } },
  '3': { day:{ar:'الخميس',en:'Thursday'}, color:{ar:'أصفر',en:'yellow'}, lucky:'3, 12, 21',
    ar:{ personality:'مبدع ومرح يعبر عن نفسه بالفن والكلمة.', strength:'إبداع، فكاهة، تعبير', fortune:'سنة الإلهام؛ أفكارك المشرقة تمسّ قلوب الآخرين.' },
    en:{ personality:'Creative and playful, expressing yourself through art and words.', strength:'Creativity, humor, expression', fortune:'A year of inspiration; your bright ideas touch others’ hearts.' } },
  '4': { day:{ar:'السبت',en:'Saturday'}, color:{ar:'أخضر',en:'green'}, lucky:'4, 8, 13',
    ar:{ personality:'باني موثوق يحب النظام والاستقرار.', strength:'التزام، صبر، تنظيم', fortune:'سنة البناء؛ أساساتك المتينة اليوم تتحول إلى قصور.' },
    en:{ personality:'A dependable builder who loves order and stability.', strength:'Commitment, patience, organization', fortune:'A year of building; your solid foundations turn into palaces.' } },
  '5': { day:{ar:'الأربعاء',en:'Wednesday'}, color:{ar:'أزرق',en:'blue'}, lucky:'5, 15, 19',
    ar:{ personality:'عاشق للحرية والتجربة والتنوع.', strength:'جرأة، مرونة، فضول', fortune:'سنة التغيير؛ سفر جديد أو مهارة جديدة تغير مسارك.' },
    en:{ personality:'A freedom lover of experience and variety.', strength:'Boldness, flexibility, curiosity', fortune:'A year of change; a new trip or skill shifts your path.' } },
  '6': { day:{ar:'الجمعة',en:'Friday'}, color:{ar:'تركواز',en:'teal'}, lucky:'6, 15, 24',
    ar:{ personality:'راعٍ وعطوف، محوره الأسرة والحب.', strength:'رعاية، مسؤولية، دفء', fortune:'سنة الدفء؛ البيت والعلاقات مليئة بالبركة والمودة.' },
    en:{ personality:'A caregiver centered on family and love.', strength:'Nurture, responsibility, warmth', fortune:'A warm year; home and relationships brim with blessing and affection.' } },
  '7': { day:{ar:'السبت',en:'Saturday'}, color:{ar:'بنفسجي',en:'purple'}, lucky:'7, 16, 25',
    ar:{ personality:'مفكر وباحث يبحث عن المعنى العميق.', strength:'تحليل، حكمة، حدس', fortune:'سنة الاكتشاف؛ إجابات كبيرة تنتظرك في الكتب والأسفار.' },
    en:{ personality:'A thinker and seeker of deeper meaning.', strength:'Analysis, wisdom, intuition', fortune:'A year of discovery; big answers await in books and travels.' } },
  '8': { day:{ar:'السبت',en:'Saturday'}, color:{ar:'أسود أنيق',en:'elegant black'}, lucky:'8, 17, 26',
    ar:{ personality:'طموح قوي المنزع يجذب النجاح المادي.', strength:'قيادة، تنفيذ، ثقة', fortune:'سنة القوة؛ قراراتك الجريئة تصنع الثروة والسمعة.' },
    en:{ personality:'A powerfully driven go-getter attracting material success.', strength:'Leadership, execution, confidence', fortune:'A strong year; bold decisions build wealth and reputation.' } },
  '9': { day:{ar:'الاثنين',en:'Monday'}, color:{ar:'أحمر',en:'red'}, lucky:'9, 18, 27',
    ar:{ personality:'إنساني متسامح يحب العطاء بلا حدود.', strength:'عطف، تسامح، مثالية', fortune:'سنة العطاء؛ ما تقدمه للعالم يعود إليك أضعافًا مضاعفة.' },
    en:{ personality:'A tolerant humanitarian who loves endless giving.', strength:'Compassion, tolerance, idealism', fortune:'A year of giving; what you offer the world returns to you multiplied.' } },
  '11': { day:{ar:'الاثنين',en:'Monday'}, color:{ar:'فضي',en:'silver'}, lucky:'11, 22, 29',
    ar:{ personality:'رقم رئيسي: حدس خارق وروحانية عالية.', strength:'إلهام، حدس، رؤية', fortune:'سنة الإلهام؛ حدسك الداخلي خريطة كنز لا تضل أبدًا.' },
    en:{ personality:'Master number: extraordinary intuition and high spirituality.', strength:'Inspiration, intuition, vision', fortune:'A year of inspiration; your inner intuition is a treasure map that never fails.' } },
  '22': { day:{ar:'الأحد',en:'Sunday'}, color:{ar:'أبيض',en:'white'}, lucky:'22, 44',
    ar:{ personality:'رقم رئيسي: الباني العظيم يحول الرؤى إلى واقع.', strength:'تنفيذ، رؤية، تأثير', fortune:'سنة الإنجاز الكبير؛ أحلامك الكبيرة على وشك أن تُبنى.' },
    en:{ personality:'Master number: the great builder turning visions into reality.', strength:'Execution, vision, impact', fortune:'A year of grand achievement; your big dreams are about to be built.' } },
  '33': { day:{ar:'السبت',en:'Saturday'}, color:{ar:'ذهبي',en:'gold'}, lucky:'33, 6',
    ar:{ personality:'رقم رئيسي: المعلم العاطفي يشع الحب للجميع.', strength:'تعاطف، إلهام، تضحية', fortune:'سنة النور؛ كلماتك تلهم وتشفى من حولك.' },
    en:{ personality:'Master number: the loving teacher shining compassion to all.', strength:'Empathy, inspiration, sacrifice', fortune:'A year of light; your words inspire and heal those around you.' } }
};
const LP_MARRY = { '1':[26,28], '2':[27,30], '3':[24,27], '4':[29,33], '5':[25,28], '6':[23,26], '7':[30,34], '8':[27,31], '9':[26,29], '11':[24,27], '22':[28,32], '33':[22,26] };
const LP_MATCH = { '1':['3','5','7'], '2':['6','9'], '3':['1','5','9'], '4':['6','8'], '5':['1','3','7'], '6':['2','4','8'], '7':['1','5'], '8':['4','6'], '9':['2','3','6'], '11':['1','7'], '22':['4','6'], '33':['3','5'] };

let _horoTab = 'daily';
let _horoMembers = null;

function _bi(o) { if (!o) return ''; if (apiLang() === 'ar' && o.ar) return o.ar; return o.en || String(o); }
function loveChance(bd) {
  const ds = String(bd).replace(/\D/g, '');
  if (ds.length < 8) return 50;
  const y = +ds.slice(0, 4), m = +ds.slice(4, 6), d = +ds.slice(6, 8), lp = +(lifePath(bd) || 1);
  return Math.min(96, Math.max(28, ((y * 7 + m * 13 + d * 29 + lp * 43) % 61) + 34));
}
async function getHoroMembers(applyScope) {
  if (!_horoMembers) {
    try { const r = await api('/api/members?groupBy=none'); _horoMembers = (r && r.members) || members.slice(); }
    catch (e) { _horoMembers = members.slice(); }
  }
  return applyScope ? filterMembersByScope(_horoMembers) : _horoMembers;
}

async function renderHoroscope() {
  const con = $('view-horoscope');
  con.innerHTML = '<div class="loading">🔮 ' + t('horoscope.loading') + '</div>';
  const mAll = await getHoroMembers(true);
  con.innerHTML = `
    <div class="tbl-toolbar" style="flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:20px">🔮</span>
        <span style="font-weight:800;font-size:16px">${t('horoscope.title')}</span>
      </div>
    </div>
    <div class="horo-tabs">
      <button class="horo-tab" data-horo-tab="daily">${t('horoTab.daily')}</button>
      <button class="horo-tab" data-horo-tab="chinese">${t('horoTab.chinese')}</button>
      <button class="horo-tab" data-horo-tab="numerology">${t('horoTab.numerology')}</button>
      <button class="horo-tab" data-horo-tab="love">${t('horoTab.love')}</button>
    </div>
    <div class="horo-wrap" id="horo-content"></div>`;
  $$('.horo-tab').forEach(btn => btn.addEventListener('click', () => { _horoTab = btn.dataset.horoTab; renderHoroTab(mAll); }));
  renderHoroTab(mAll);
}

function renderHoroTab(mAll) {
  $$('.horo-tab').forEach(b => b.classList.toggle('active', b.dataset.horoTab === _horoTab));
  const content = $('horo-content');
  if (!content) return;
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  content.onclick = e => {
    const cn = e.target.closest('[data-cn]');
    if (cn) { openChineseDetail(cn.dataset.cn); return; }
    const nm = e.target.closest('[data-numi-idx]');
    if (nm) { openNumDetail(+nm.dataset.numiIdx); return; }
  };
  if (_horoTab === 'chinese') { renderChineseHoro(content, mAll); return; }
  if (_horoTab === 'numerology') { renderNumerologyHoro(content, mAll); return; }
  if (_horoTab === 'love') { renderLoveHoro(content, mAll); return; }
  renderDailyHoro(content, mAll);
}

async function renderDailyHoro(content, mAll) {
  try {
    const data = await api('/api/horoscope?lang=' + encodeURIComponent(apiLang()));
    if (!data || !data.signs) throw new Error('empty');
    window._horoData = data;
    const counts = new Map();
    (mAll || []).forEach(m => {
      const z = zodiacOf(m);
      if (!z) return;
      const k = z.key || String(z);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    content.innerHTML = `
      <div class="funfact">💡 <span>${t('fun.tip')}</span></div>
      <span style="font-size:12px;color:var(--gold);display:block;margin-bottom:10px">${t('horoscope.dateLabel')} ${data.date}</span>
      <div class="horo-grid" id="horo-grid"></div>`;
    const grid = $('horo-grid');
    grid.innerHTML = data.signs.map(s => {
      const key = String(s.key).toLowerCase();
      const n = counts.get(key) || counts.get(String(s.name).toLowerCase()) || 0;
      return `
      <div class="horo-card" data-horo="${s.key}" style="border-top:3px solid ${s.color}">
        <div class="horo-sym" style="color:${s.color}">${s.sym}</div>
        <div class="horo-name">${esc(s.name)}</div>
        <div class="horo-meta">${esc(s.element)} • ${esc(s.dates)}</div>
        ${n ? `<div class="horo-count">👥 ${t('horoscope.membersOfSign', {count: n})}</div>` : ''}
        <div class="horo-snippet">${esc(s.prediction.length > 95 ? s.prediction.slice(0, 95) + '…' : s.prediction)}</div>
        <div class="horo-read">${t('horoscope.readMore')} ←</div>
      </div>`;
    }).join('');
  } catch (e) {
    content.innerHTML = '<div class="empty-state">' + t('horoscope.error') + '</div>';
  }
}

function renderChineseHoro(content, mAll) {
  const bySign = {};
  mAll.forEach(m => {
    if (!m.birthDate) return;
    const yr = +String(m.birthDate).slice(0, 4);
    if (!yr) return;
    const k = cnSign(yr);
    (bySign[k] = bySign[k] || []).push(m);
  });
  const counts = CN_SIGNS.map(s => ({ key: s.key, n: (bySign[s.key] || []).length })).sort((a, b) => b.n - a.n);
  const top = counts[0] && counts[0].n ? CN_SIGNS.find(s => s.key === counts[0].key) : null;
  const topNs = top ? bySign[top.key] : [];
  content.innerHTML = `
    <div class="funfact">🐉 <b>${t('chinese.mostCommon')}</b>${
      top
        ? `&nbsp; ${top.sym} ${esc(top.key === 'rat' ? (apiLang() === 'ar' ? 'فأر' : top.key) : top.key)} (${counts[0].n}) — ${topNs.slice(0, 3).map(m => esc(dispName(m))).join(listSep())}`
        : ''}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${t('chinese.subtitle')}</div>
    <div class="horo-grid">${CN_SIGNS.map(s => {
      const members = bySign[s.key] || [];
      const yrs = cnYears(s.key).filter(y => y >= 1940 && y <= 2040);
      const elBg = cnElColor(s.el);
      const predTxt = _cnPred(s);
      return `<div class="horo-card" data-cn="${s.key}" style="border-top:3px solid ${s.color}">
        <div class="horo-sym" style="color:${s.color}">${s.sym}</div>
        <div class="horo-name" style="color:${s.color}">${useCnName(s.key)}</div>
        <div class="horo-meta">${t('chinese.bornIn')}: ${yrs.slice(0, 6).join('، ')}</div>
        <span class="cn-el" style="background:${elBg}22;color:${elBg}">${_bi(CN_EL_NAME[s.el])}</span>
        ${members.length ? `<div class="horo-count">👥 ${t('chinese.count', {count: members.length})}</div>` : ''}
        <div class="horo-snippet">${esc(predTxt.length > 90 ? predTxt.slice(0, 90) + '…' : predTxt)}</div>
        <div class="horo-read">${t('horoscope.readMore')} ←</div>
      </div>`;
    }).join('')}</div>`;
}

function openChineseDetail(key) {
  const s = CN_SIGNS.find(x => x.key === key);
  if (!s) return;
  const members = (_horoMembers || []).filter(m => hasRealBirth(m) && cnSign(+String(m.birthDate).slice(0, 4)) === key);
  const elBg = cnElColor(s.el);
  const comps = s.compatible.map(c => { const cs = CN_SIGNS.find(x => x.key === c); return cs; }).filter(Boolean);
  const yrs = cnYears(key).filter(y => y >= 1940);
  openHoroOverlay(`
    <div class="modal-title">${s.sym} ${useCnName(key)}</div>
    <div style="text-align:center;font-size:12px;color:var(--muted);margin-bottom:12px">
      <span class="cn-el" style="background:${elBg}22;color:${elBg}">${_bi(CN_EL_NAME[s.el])}</span>
      <span style="margin-inline:6px">${t('chinese.bornIn')}: ${yrs.slice(0, 8).join('، ')}</span>
    </div>
    <div class="horo-sec"><b>💪 ${t('chinese.traits')}</b><div>${esc(_cnTrait(s))}</div></div>
    <div class="horo-sec"><b>🔮 ${t('chinese.outlook')}</b><div>${esc(_cnPred(s))}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      <span class="trait-pill">🍀 ${t('chinese.luckyNums')} ${s.luckyNums.join(', ')}</span>
      <span class="trait-pill">🎨 ${t('chinese.luckyColor')} ${_bi(s.luckyColor)}</span>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">💞 ${t('chinese.compat')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${comps.map(c => `<div class="horo-compat" style="border-color:${c.color}"><span style="color:${c.color}">${c.sym}</span> ${useCnName(c.key)}</div>`).join('')}
    </div>
    ${members.length ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">👥 ${t('chinese.count', {count: members.length})}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${members.map(m => `<span class="trait-pill">${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}</span>`).join('')}</div>` : ''}
    <div style="display:flex;justify-content:center"><button class="m-cancel" data-close-horo style="padding:8px 22px;flex:none">${t('common.close')}</button></div>
  `);
}

function renderNumerologyHoro(content, mAll) {
  const list = mAll.filter(m => hasRealBirth(m) && lifePath(m.birthDate));
  const counts = {};
  list.forEach(m => { const lp = lifePath(m.birthDate); counts[lp] = (counts[lp] || 0) + 1; });
  const topLp = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  content.innerHTML = `
    <div class="funfact">🔢 <b>${t('numerology.mostCommon')}</b>${
      topLp ? `&nbsp; ${topLp} (${counts[topLp]})` : ''}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${t('numerology.subtitle')}</div>
    <div class="numi-grid" id="numi-grid"></div>`;
  const grid = $('numi-grid');
  if (!grid) return;
  if (!list.length) { grid.innerHTML = '<div class="empty-state">' + t('horoscope.error') + '</div>'; return; }
  grid.innerHTML = list.map((m, i) => {
    const lp = lifePath(m.birthDate);
    const N = NUM_INFO[lp];
    if (!N) return '';
    return `<div class="numi-card" data-numi-idx="${i}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <div class="lp-badge">${lp}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:15px">${esc(dispName(m))}</div>
          <div style="font-size:11px;color:var(--muted)">${t('numerology.lifePath')} ${lp}${lp === '11' || lp === '22' || lp === '33' ? ' ✦ ' + t('numerology.master') : ''}</div>
        </div>
      </div>
      <div class="horo-snippet" style="margin:0">${esc(N.ar && apiLang() === 'ar' ? N.ar.personality : N.en.personality)}</div>
      <div class="horo-sec" style="margin:6px 0 0"><b>💪 ${t('numerology.strength')}</b><div>${esc(N.ar && apiLang() === 'ar' ? N.ar.strength : N.en.strength)}</div></div>
      <div class="horo-sec" style="margin:6px 0 0"><b>🚀 ${t('numerology.fortune')}</b><div>${esc(N.ar && apiLang() === 'ar' ? N.ar.fortune : N.en.fortune)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span class="trait-pill">🍀 ${t('chinese.luckyNums')} ${N.lucky}</span>
        <span class="trait-pill">🎨 ${t('chinese.luckyColor')} ${N.color && (N.color.ar ? (apiLang() === 'ar' ? N.color.ar : N.color.en) : N.color)}</span>
        <span class="trait-pill">📅 ${t('numerology.luckyDay')} ${N.day && (N.day.ar ? (apiLang() === 'ar' ? N.day.ar : N.day.en) : N.day)}</span>
      </div>
    </div>`;
  }).join('');
}

function openNumDetail(idx) {
  const list = (_horoMembers || []).filter(m => hasRealBirth(m) && lifePath(m.birthDate));
  const m = list[idx];
  if (!m) return;
  const lp = lifePath(m.birthDate);
  const N = NUM_INFO[lp];
  if (!N) return;
  const yr = +String(m.birthDate).slice(0, 4);
  const cs = CN_SIGNS.find(s => s.key === cnSign(yr));
  const isAr = apiLang() === 'ar';
  openHoroOverlay(`
    <div class="modal-title">${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}</div>
    <div style="text-align:center;font-size:13px;color:var(--gold);margin-bottom:10px">
      ${t('numerology.lifePath')} <b style="font-size:20px">${lp}</b>${lp === '11' || lp === '22' || lp === '33' ? ' ✦ ' + t('numerology.master') : ''}
    </div>
    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <div class="lp-badge" style="width:56px;height:56px;font-size:28px">${lp}</div>
      ${cs ? `<div class="horo-compat" style="border-color:${cs.color};min-width:110px"><span style="color:${cs.color};font-size:20px">${cs.sym}</span><div>${useCnName(cs.key)} — ${t('chinese.title')}</div></div>` : ''}
    </div>
    <div class="horo-sec"><b>🧠 ${t('numerology.personality')}</b><div>${esc(isAr ? N.ar.personality : N.en.personality)}</div></div>
    <div class="horo-sec"><b>💪 ${t('numerology.strength')}</b><div>${esc(isAr ? N.ar.strength : N.en.strength)}</div></div>
    <div class="horo-sec"><b>🚀 ${t('numerology.fortune')}</b><div>${esc(isAr ? N.ar.fortune : N.en.fortune)}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">
      <span class="trait-pill">🍀 ${t('chinese.luckyNums')} ${N.lucky}</span>
      <span class="trait-pill">🎨 ${t('chinese.luckyColor')} ${isAr ? N.color.ar : N.color.en}</span>
      <span class="trait-pill">📅 ${t('numerology.luckyDay')} ${isAr ? N.day.ar : N.day.en}</span>
    </div>
    <div style="display:flex;justify-content:center"><button class="m-cancel" data-close-horo style="padding:8px 22px;flex:none">${t('common.close')}</button></div>
  `);
}

function renderLoveHoro(content, mAll) {
  const singles = mAll.filter(m => !m.isDeceased && !m.spouseId && hasRealBirth(m) && yearsToNow(m.birthDate) >= 18);
  content.innerHTML = `
    <div class="funfact">💡 <span>${t('love.hint')}</span></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${t('love.subtitle')}</div>
    <div class="horo-grid">`;
  if (!singles.length) {
    content.innerHTML += '<div class="empty-state">' + t('love.noBachelors') + '</div></div>';
    return;
  }
  content.innerHTML += singles.map(m => {
    const lp = lifePath(m.birthDate);
    const N = NUM_INFO[lp];
    if (!N) return '';
    const win = LP_MARRY[lp] || [25, 30];
    const matches = (LP_MATCH[lp] || ['3','5','7']).map(x => `<b style="color:var(--gold)">${x}</b>`).join(' ');
    const chance = loveChance(m.birthDate);
    const isAr = apiLang() === 'ar';
    return `<div class="love-card">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="love-ring">${m.gender === 'female' ? '💍👰' : '💍🤵'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:15px">${esc(dispName(m))}</div>
          <div style="font-size:11px;color:var(--muted)">${t('love.unmarried')} • ${t('love.age')}: ${yearsToNow(m.birthDate)} • ${t('numerology.lifePath')} ${lp}</div>
        </div>
      </div>
      <div class="horo-sec"><b>💞 ${t('love.marriageWindow')}</b><div>${t('love.between')}${t('love.between') ? ' ' : ''}${win[0]}–${win[1]} ${t('love.year')}</div></div>
      <div class="horo-sec"><b>👫 ${t('love.bestMatch')}</b><div>${t('numerology.lifePath')}: ${matches}</div></div>
      <div class="horo-sec"><b>💌 ${t('love.fortune')}</b><div>${esc(isAr ? N.ar.fortune : N.en.fortune)}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:12px;color:var(--muted);white-space:nowrap">${t('love.thisYear')}</span>
        <div class="bar-w"><div class="bar-f" style="width:${chance}%"></div></div>
        <b class="love-pct" style="color:var(--pink)">${chance}%</b>
      </div>
    </div>`;
  }).join('');
  content.innerHTML += '</div>';
}

function openHoroOverlay(innerHtml) {
  let ov = $('horo-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'horo-overlay';
    ov.className = 'overlay show';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="modal" style="max-width:540px;max-height:88vh">${innerHtml}</div>`;
  ov.onclick = e => { if (e.target === ov || e.target.closest('[data-close-horo]')) ov.remove(); };
}

function openHoroscopeDetail(key) {
  const data = window._horoData;
  if (!data) return;
  const s = data.signs.find(x => x.key === key);
  if (!s) return;
  openHoroOverlay(`
    <div class="modal-title">${s.sym} ${esc(s.name)}</div>
    <div style="text-align:center;font-size:12px;color:var(--muted);margin-bottom:12px">${esc(s.element)} • ${esc(s.dates)}${s.memberCount ? ' • 👥 ' + s.memberCount : ''}</div>
    <div style="background:var(--s2);border-radius:12px;padding:14px;margin-bottom:12px;line-height:1.8;font-size:13px;color:var(--text)">${esc(s.prediction)}</div>
    <div class="horo-sec"><b>❤️ ${t('horoscope.love')}</b><div>${esc(s.love)}</div></div>
    <div class="horo-sec"><b>💼 ${t('horoscope.career')}</b><div>${esc(s.career)}</div></div>
    <div class="horo-sec"><b>💪 ${t('horoscope.health')}</b><div>${esc(s.health)}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      <span class="trait-pill">🍀 ${t('horoscope.luckyNumber')} ${s.luckyNumber}</span>
      <span class="trait-pill">🎨 ${t('horoscope.luckyColor')} ${s.luckyColor}</span>
      <span class="trait-pill">📅 ${t('horoscope.luckyDay')} ${s.luckyDay}</span>
      <span class="trait-pill">😊 ${t('horoscope.mood')} ${s.mood}</span>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${t('horoscope.compatibility')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${s.compatibility.map(c => `<div class="horo-compat" style="border-color:${c.color}"><span style="color:${c.color}">${c.sym}</span> ${c.name}</div>`).join('')}
    </div>
    <div style="display:flex;justify-content:center">
      <button class="m-cancel" data-close-horo style="padding:8px 22px;flex:none">${t('common.close')}</button>
    </div>
  `);
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════ */
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('show');
}
function toggleSidebar() {
  const sb = $('sidebar');
  const ov = $('sidebar-overlay');
  const isOpen = sb.classList.contains('open');
  if (isOpen) { closeSidebar(); }
  else { sb.classList.add('open'); ov.classList.add('show'); }
}
$$('.sidebar-tab').forEach(tab => tab.addEventListener('click', () => {
  const pane = tab.getAttribute('data-sidebar-tab');
  $$('.sidebar-tab').forEach(x => x.classList.toggle('active', x === tab));
  $$('.sidebar-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-sidebar-pane') === pane));
}));
$$('.quick-icon').forEach(q => q.addEventListener('click', () => {
  const target = $('btn-' + q.getAttribute('data-qid'));
  if (target) target.click();
}));

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════════ */
let dashMonthYear = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

// Full years elapsed between a birth date and today (exact, month/day aware)
function yearsToNow(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const mDiff = now.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < d.getDate())) y--;
  return y;
}

// Determine the real oldest/youngest by exact birth date (ignores members without one)
function computeOldestYoungest(ms) {
  let oldest = null, youngest = null;
  (ms || []).forEach(m => {
    if (!m || !hasRealBirth(m)) return;
    if (!oldest || m.birthDate < oldest.birthDate) oldest = m;
    if (!youngest || m.birthDate > youngest.birthDate) youngest = m;
  });
  return {
    oldest: oldest ? { name: oldest.name, age: yearsToNow(oldest.birthDate) } : null,
    youngest: youngest ? { name: youngest.name, age: yearsToNow(youngest.birthDate) } : null
  };
}

// Determine whether an upcoming event belongs to a member with a real birth date
function memberHasBirth(membersData, ev) {
  const list = membersData && membersData.members ? membersData.members : [];
  const mm = list.find(x => String(x.id) === String(ev && ev.memberId));
  if (mm) return hasRealBirth(mm);
  // No member match (e.g. anniversary of spouse not in this family) — keep unless clearly a sentinel birthday
  return ev ? String(ev.type) !== 'birthday' : true;
}

let DASH_CACHE = null;
async function renderDashboard() {
  const con = $('view-dashboard');
  con.innerHTML = '<div class="loading"><div class="spinner"></div>' + t('dashboard.loading') + '</div>';

  try {
    if (!DASH_CACHE) {
      const [filtersData, statsData, eventsData, membersData] = await Promise.all([
        api('/api/filters'),
        api('/api/stats'),
        api('/api/events/upcoming?days=120'),
        api('/api/members?groupBy=none').catch(() => null)
      ]);
      if (!filtersData || !statsData) {
        con.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div>${t('dashboard.loadError')}</div><div style="font-size:13px;margin-top:10px">${t('dashboard.connectionError')}</div><button onclick="renderAll()" style="margin-top:16px;padding:8px 20px;background:var(--gold);color:var(--gold2);border:none;border-radius:8px;font-family:Tajawal;font-weight:700;cursor:pointer">${t('dashboard.retry')}</button></div>`;
        DASH_CACHE = null;
        return;
      }
      DASH_CACHE = { filtersData, statsData, eventsData, membersData };
    }
    paintDashboard();
  } catch (e) {
    DASH_CACHE = null;
    con.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div>${t('dashboard.loadError')}</div><div style="font-size:13px;margin-top:10px">${t('dashboard.connectionError')}</div><button onclick="renderAll()" style="margin-top:16px;padding:8px 20px;background:var(--gold);color:var(--gold2);border:none;border-radius:8px;font-family:Tajawal;font-weight:700;cursor:pointer">${t('dashboard.retry')}</button></div>`;
  }
}

// Client-side generation depth (max parent-chain length)
function computeGenerationsClient(ms) {
  const byId = {};
  (ms || []).forEach(m => { byId[String(m.id)] = m; });
  const depth = {};
  const seen = new Set();
  const d = (m) => {
    const k = String(m.id);
    if (seen.has(k)) return 1;
    if (depth[k] != null) return depth[k];
    seen.add(k);
    let v = 1;
    if (m.parentId != null && byId[String(m.parentId)]) v = d(byId[String(m.parentId)]) + 1;
    seen.delete(k);
    depth[k] = v;
    return v;
  };
  let mx = 0;
  (ms || []).forEach(m => { mx = Math.max(mx, d(m)); });
  return mx;
}

function paintDashboard() {
  const con = $('view-dashboard');
  if (!DASH_CACHE) return;
  const { filtersData, statsData, eventsData, membersData } = DASH_CACHE;

  if (!filtersData || !statsData) {
    con.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)"><div style="font-size:48px;margin-bottom:12px">⚠️</div><div style="font-size:18px">' + t('dashboard.loadError') + '</div></div>';
    return;
  }

  // ── Family scope: keep ALL-member reference, then apply selection ──
  const allMems = (membersData && membersData.members) || [];
  FAMILY_SCOPE_ALL = allMems;
  refreshFamilyClusters(allMems);
  const scoped = filterMembersByScope(allMems);
  const scopedIds = new Set(scoped.map(m => String(m.id)));
  const scopeActive = FAMILY_SCOPE.selected != null;
  const scopedData = { members: scoped };

  // Recompute server-side aggregates from the scoped set
  statsData.total = scoped.length;
  statsData.maleCount = scoped.filter(m => m.gender === 'male').length;
  statsData.femaleCount = scoped.filter(m => m.gender === 'female').length;
  statsData.generationCount = computeGenerationsClient(scoped);
  const oy = computeOldestYoungest(scoped);
  if (oy) { statsData.oldest = oy.oldest; statsData.youngest = oy.youngest; }
  filtersData.total = scoped.length;
  filtersData.familyCount = scopeActive && FAMILY_SCOPE.selected ? FAMILY_SCOPE.selected.size : FAMILY_CLUSTER_ORDER.length;

  if (!scoped.length) {
    con.innerHTML = `<div class="empty-state"><div class="big">🌫️</div><div style="font-size:18px">${t('dashboard.noScopeMembers')}</div></div>`;
    return;
  }

  // Update header pills for the scoped set only
  const birthdaySoon = (eventsData && eventsData.events || []).filter(e => e.type === 'birthday' && e.daysUntil <= 30 && scopedIds.has(String(e.memberId)) && memberHasBirth(scopedData, e));
  $('stats-pills').innerHTML = `
    <div class="h-pill">` + t('dashboard.statsPillMembers') + ` <b>${scoped.length}</b></div>
    <div class="h-pill">` + t('dashboard.statsPillBirthdays') + ` <b>${birthdaySoon.length}</b></div>
    <div class="h-pill">` + t('dashboard.statsPillFamilies') + ` <b>${filtersData.familyCount}</b></div>`;

  const maleCount = statsData.maleCount || 0;
  const femaleCount = statsData.femaleCount || 0;

  // Average age excludes members without a known birth date (sentinel 1800-01-01)
  const realMems = scoped.filter(hasRealBirth);
  const avgAge = realMems.length ? Math.round(realMems.reduce((s2, mm) => s2 + (mm.age ? mm.age.years : 0), 0) / realMems.length) : (statsData.avgAge || 0);

  // Rebuild the three chart distributions client-side from scoped members
  if (Array.isArray(realMems)) {
    const zdist = {}, edist = {}, adist = {};
    const ageSlug = y => {
      if (y < 1) return 'infant0';
      if (y <= 2) return 'toddler';
      if (y <= 5) return 'preschool';
      if (y <= 12) return 'children';
      if (y <= 17) return 'teenagers';
      if (y <= 24) return 'youngAdults';
      if (y <= 34) return 'adults';
      if (y <= 44) return 'earlyMiddle';
      if (y <= 54) return 'middle';
      if (y <= 64) return 'lateMiddle';
      if (y <= 74) return 'earlySeniors';
      if (y <= 84) return 'seniors';
      return 'longLived';
    };
    realMems.forEach(mm => {
      if (mm.zodiac && mm.zodiac.name) {
        const k = mm.zodiac.name;
        zdist[k] = (zdist[k] || 0) + 1;
      }
      if (mm.zodiac && mm.zodiac.element) {
        const k = mm.zodiac.element;
        edist[k] = (edist[k] || 0) + 1;
      }
      if (mm.age && typeof mm.age.years === 'number' && isFinite(mm.age.years)) {
        const k = t('ageGroup.' + ageSlug(mm.age.years));
        adist[k] = (adist[k] || 0) + 1;
      }
    });
    statsData.zodiacDistribution = zdist;
    statsData.elementDistribution = edist;
    statsData.ageGroupDistribution = adist;
  }

  // Build events lists — scoped to selected families
  const allEvents = ((eventsData && eventsData.events) || []).filter(e => scopedIds.has(String(e.memberId)) && memberHasBirth(scopedData, e)).slice(0, 40);
  const upcomingEvents = allEvents.filter(e => e.daysUntil <= 30);

  con.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card"><span class="dc-icon">👥</span><span class="dc-num">${statsData.total}</span><div class="dc-label">${t('dashboard.totalMembers')}</div></div>
        <div class="dash-card"><span class="dc-icon">📅</span><span class="dc-num">${avgAge}</span><div class="dc-label">${t('dashboard.avgAge')}</div></div>
        <div class="dash-card"><span class="dc-icon">👨</span><span class="dc-num">${maleCount}</span><div class="dc-label">${t('dashboard.males')}</div></div>
        <div class="dash-card"><span class="dc-icon">👩</span><span class="dc-num">${femaleCount}</span><div class="dc-label">${t('dashboard.females')}</div></div>
        ${statsData.oldest ? `<div class="dash-card"><span class="dc-icon">👴</span><span class="dc-num">${statsData.oldest.age}</span><div class="dc-label">${t('dashboard.oldest')} ${esc(statsData.oldest.name)}</div></div>` : ''}
        ${statsData.youngest ? `<div class="dash-card"><span class="dc-icon">👶</span><span class="dc-num">${statsData.youngest.age}</span><div class="dc-label">${t('dashboard.youngest')} ${esc(statsData.youngest.name)}</div></div>` : ''}
        <div class="dash-card"><span class="dc-icon">🌱</span><span class="dc-num">${statsData.generationCount || Object.keys(statsData.generationDistribution || {}).length}</span><div class="dc-label">${t('dashboard.generations')}</div></div>
        <div class="dash-card"><span class="dc-icon">${upcomingEvents.length ? '🔔' : '🤫'}</span><span class="dc-num">${upcomingEvents.length}</span><div class="dc-label">${t('dashboard.upcomingEvents')}</div></div>
      </div>
      <div class="dash-row">
        <div class="dash-box" style="grid-column:1/-1"><div class="dash-box-title">📆 ${t('dashboard.calendarTitle')}</div>
          <div id="dash-cal" style="max-width:100%"></div>
          <div class="cal-nav">
            <button class="cal-nav-btn" data-cal-nav="-1">▶ ${t('dashboard.calPrev')}</button>
            <span class="cal-month-title" id="dash-cal-title"></span>
            <button class="cal-nav-btn" data-cal-nav="1">${t('dashboard.calNext')} ◀</button>
          </div>
        </div>
        <div class="dash-box"><div class="dash-box-title">🎉 ${t('dashboard.eventsTitle')}</div>
          <div>${upcomingEvents.length === 0 ? '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">' + t('dashboard.noEvents') + '</div>' :
          `<div>${upcomingEvents.map(ev =>
            `<div class="ev-row ${ev.type}">
              <span class="ev-ico">${ev.emoji}</span>
              <div><div class="ev-name">${esc(ev.memberName)}</div><div class="ev-sub">${ev.type === 'birthday' ? t('dashboard.eventBirthday') + ' ' + (ev.nextAge ? t('dashboard.eventBirthdayTo') + ' ' + ev.nextAge : '') : t('dashboard.eventAnniversary') + ' ' + (ev.nextAge ? '→ ' + ev.nextAge + ' ' + t('tree.years') : '')}</div></div>
              <div class="ev-days ${ev.type}">${ev.daysUntil === 0 ? t('dashboard.eventToday') : t('dashboard.eventIn') + ' ' + ev.daysUntil + ' ' + t('table.daysUntil')}</div>
            </div>`).join('')}</div>`}</div>
        </div>
        <div class="dash-box"><div class="dash-box-title">📊 ${t('dashboard.chartZodiac')}</div><canvas id="chart-zodiac"></canvas></div>
        <div class="dash-box"><div class="dash-box-title">📈 ${t('dashboard.chartAge')}</div><canvas id="chart-age"></canvas></div>
        <div class="dash-box"><div class="dash-box-title">🌊 ${t('dashboard.chartElement')}</div><canvas id="chart-element"></canvas></div>
      </div>`;

  buildDashCalendar(allEvents);

  setTimeout(() => initDashboardCharts(statsData), 100);
}

function buildDashCalendar(events) {
  const wrap = $('dash-cal');
  if (!wrap) return;
  const y = dashMonthYear.y, m = dashMonthYear.m;
  const monNames = [t('months.jan'),t('months.feb'),t('months.mar'),t('months.apr'),t('months.may'),t('months.jun'),t('months.jul'),t('months.aug'),t('months.sep'),t('months.oct'),t('months.nov'),t('months.dec')];
  $('dash-cal-title').textContent = monNames[m] + ' ' + y;

  const today = new Date();
  const firstDay = new Date(y, m, 1);
  const startDow = firstDay.getDay(); // 0=Sun ... ar week starts Sat
  const arStart = (startDow + 1) % 7; // convert to Sat-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrev = new Date(y, m, 0).getDate();

  // Index events by date (mm-dd)
  const byDate = {};
  (events || []).forEach(ev => {
    if (!ev.date) return;
    const d = new Date(ev.date + 'T00:00:00');
    const key = d.getMonth() + ',' + d.getDate();
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(ev);
  });

  let html = '<div class="cal-month-grid">';
  [t('days.sun'),t('days.mon'),t('days.tue'),t('days.wed'),t('days.thu'),t('days.fri'),t('days.sat')].forEach(dow => {
    html += `<div class="cal-dow">${dow}</div>`;
  });

  for (let i = 0; i < arStart; i++) {
    const d = daysInPrev - arStart + i + 1;
    html += `<div class="cal-day other"><div class="cd-num">${d}</div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = m + ',' + d;
    const evs = byDate[key] || [];
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
    let evHtml = '';
    if (evs.length) {
      evHtml = `<div class="cd-events">`;
      evs.slice(0, 3).forEach(ev => {
        evHtml += `<div class="cd-ico ${ev.type}">${ev.type === 'birthday' ? '🎂' : '💍'}</div><div class="cd-name" title="${esc(ev.memberName)}">${esc(ev.memberName)}</div>`;
      });
      if (evs.length > 3) evHtml += `<div class="cd-name" style="color:var(--gold)">+${evs.length - 3}</div>`;
      evHtml += `</div>`;
    }
    html += `<div class="cal-day${isToday ? ' today' : ''}" data-day="${key}"><div class="cd-num">${d}</div>${evHtml}</div>`;
  }

  const rem = (arStart + daysInMonth) % 7;
  if (rem) for (let i = 0; i < 7 - rem; i++) {
    html += `<div class="cal-day other"><div class="cd-num">${i + 1}</div></div>`;
  }

  html += '</div>';
  wrap.innerHTML = html;

  // Clicking a day shows events for that day
  $$('.cal-day[data-day]', wrap).forEach(el => {
    el.addEventListener('click', () => {
      const [mm, dd] = el.dataset.day.split(',').map(Number);
      const evs = (events || []).filter(ev => {
        const d = ev.date ? new Date(ev.date + 'T00:00:00') : null;
        return d && d.getMonth() === mm && d.getDate() === dd;
      });
      if (!evs.length) { showToast(t('dashboard.noEventsDay')); return; }
      showToast(evs.map(e => `${e.emoji} ${e.memberName}`).join(', '));
    });
  });
}

function chartColors() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    text: light ? '#475569' : '#c3c9e2',
    grid: light ? '#d5dbe8' : '#2a2f4a',
    border: light ? '#ffffff' : '#141625',
    tooltip: {
      backgroundColor: light ? '#ffffff' : '#1f2237',
      titleColor: light ? '#1e293b' : '#e8eaf6',
      bodyColor: light ? '#334155' : '#e8eaf6',
      borderColor: light ? '#e2e8f0' : '#323656',
      borderWidth: 1
    }
  };
}

function bestTextColor(hex) {
  if (!hex) return 'rgba(255,255,255,0.95)';
  const m = String(hex).replace('#', '');
  if (m.length < 6) return 'rgba(255,255,255,0.95)';
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.95)';
}

const arcValueLabelsPlugin = {
  id: 'arcValueLabels',
  afterDatasetsDraw(chart) {
    if (!chart.options.plugins || !chart.options.plugins.arcValueLabels) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = '700 12px Tajawal, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!meta.data || !meta.data.length) return;
      meta.data.forEach((arc, i) => {
        const val = ds.data[i];
        if (typeof val !== 'number' || !isFinite(val)) return;
        const degSpan = Math.abs(((arc.endAngle - arc.startAngle) * 180) / Math.PI);
        if (degSpan < 12) return;
        const a = (arc.startAngle + arc.endAngle) / 2;
        const midR = (arc.innerRadius + arc.outerRadius) / 2;
        const x = arc.x + Math.cos(a) * midR;
        const y = arc.y + Math.sin(a) * midR;
        const bg = (ds.backgroundColor && ds.backgroundColor[i]) || '#888';
        ctx.fillStyle = bestTextColor(bg);
        ctx.fillText(String(val), x, y);
      });
    });
    ctx.restore();
  }
};

const barValueLabelsPlugin = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart) {
    if (!chart.options.plugins || !chart.options.plugins.barValueLabels) return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;
    const ds = chart.data.datasets[0];
    ctx.save();
    ctx.font = '700 11px Tajawal, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = chartColors().text;
    meta.data.forEach((bar, i) => {
      const val = ds.data[i];
      if (typeof val !== 'number' || !isFinite(val)) return;
      ctx.fillText(String(val), bar.x, bar.y - 5);
    });
    ctx.restore();
  }
};

const centerTotalPlugin = {
  id: 'centerTotal',
  afterDatasetsDraw(chart) {
    if (!chart.options.plugins || !chart.options.plugins.centerTotal) return;
    if (chart.config.type !== 'doughnut') return;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data || !meta.data[0]) return;
    const ds = chart.data.datasets[0];
    const total = ds.data.reduce((s, v) => s + (Number(v) || 0), 0);
    const arc = meta.data[0];
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const holeD = Math.max(0, (arc.innerRadius - 3));
    if (holeD > 14) {
      const box = chart.canvas && chart.canvas.closest ? chart.canvas.closest('.dash-box') : null;
      const bg = box ? getComputedStyle(box).backgroundColor : null;
      if (bg && bg !== 'transparent' && bg.indexOf('rgba(0, 0, 0, 0)') !== 0) {
        ctx.beginPath();
        ctx.arc(arc.x, arc.y, holeD, 0, Math.PI * 2);
        ctx.fillStyle = bg;
        ctx.fill();
      }
    }
    ctx.font = '800 26px Tajawal, sans-serif';
    ctx.fillStyle = chartColors().text;
    ctx.fillText(String(total), arc.x, arc.y);
    ctx.restore();
  }
};

function initDashboardCharts(data) {
  Object.values(charts).forEach(c => c?.destroy());
  charts = {};
  Chart.register(arcValueLabelsPlugin, barValueLabelsPlugin, centerTotalPlugin);

  const cc = chartColors();
  const zodiacEl = $('chart-zodiac');
  if (zodiacEl) {
    const zLabels = Object.keys(data.zodiacDistribution);
    const zData = Object.values(data.zodiacDistribution);
    const Z_SLUGS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
    const Z_SIGN_COLORS = { 'aries':'#FF6B6B','taurus':'#4ECDC4','gemini':'#FFD93D','cancer':'#A8DADC','leo':'#F4A261','virgo':'#95B8D1','libra':'#E9AFA3','scorpio':'#9B5DE5','sagittarius':'#F15BB5','capricorn':'#00BBF9','aquarius':'#00F5FF','pisces':'#B8A0FF' };
    const zodiacColor = name => {
      const slug = Z_SLUGS.find(s => t('zodiac.' + s) === name);
      return (slug && Z_SIGN_COLORS[slug]) || '#f5c518';
    };
    const zColors = zLabels.map(name => zodiacColor(name));
    charts.zodiac = new Chart(zodiacEl, {
      type: 'doughnut',
      data: { labels: zLabels, datasets: [{ data: zData, backgroundColor: zColors, borderColor: cc.border, borderWidth: 1 }] },
      options: {
        responsive: true,
        cutout: '68%',
        plugins: {
          arcValueLabels: { enabled: true },
          centerTotal: { enabled: true },
          legend: {
            position: 'bottom',
            labels: { color: cc.text, font: { family: 'Tajawal', size: 11 }, usePointStyle: true, padding: 10 },
            generateLabels: ch => ch.data.labels.map((lab, i) => ({ text: lab + ' (' + ch.data.datasets[0].data[i] + ')', fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: ch.data.datasets[0].backgroundColor[i], hidden: ch.getDataVisibility(i), index: i, pointStyle: 'circle' }))
          },
          tooltip: cc.tooltip
        }
      }
    });
  }

  const ageEl = $('chart-age');
  if (ageEl) {
    const aLabels = Object.keys(data.ageGroupDistribution).sort((a, b) => a.localeCompare(b, apiLang()));
    const aData = aLabels.map(k => data.ageGroupDistribution[k]);
    charts.age = new Chart(ageEl, {
      type: 'bar',
      data: { labels: aLabels, datasets: [{ label: t('dashboard.chartAgeLabel'), data: aData, backgroundColor: '#f5c518', borderRadius: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { barValueLabels: { enabled: true }, legend: { display: false }, tooltip: cc.tooltip },
        scales: {
          y: { beginAtZero: true, grace: 1, ticks: { color: cc.text, stepSize: 1, precision: 0 }, grid: { color: cc.grid } },
          x: { ticks: { color: cc.text, font: { family: 'Tajawal', size: 10 }, autoSkip: false, maxRotation: 50, minRotation: 0, padding: 8 }, grid: { color: cc.grid } }
        }
      }
    });
  }

  const elEl = $('chart-element');
  if (elEl) {
    const eLabels = Object.keys(data.elementDistribution);
    const eData = Object.values(data.elementDistribution);
    const E_SLUGS = ['fire','air','water','earth'];
    const E_COLORS = { 'fire':'#F4A261','air':'#7fb2ff','water':'#A8DADC','earth':'#95B8D1' };
    const elColor = k => {
      const slug = E_SLUGS.find(s => t('element.' + s) === k);
      return (slug && E_COLORS[slug]) || '#f5c518';
    };
    const eColors = eLabels.map(k => elColor(k));
    charts.element = new Chart(elEl, {
      type: 'polarArea',
      data: { labels: eLabels, datasets: [{ data: eData, backgroundColor: eColors.map(c => c + '88'), borderColor: eColors, borderWidth: 2 }] },
      options: {
        responsive: true,
        plugins: {
          arcValueLabels: { enabled: true },
          legend: { position: 'bottom', labels: { color: cc.text, font: { family: 'Tajawal', size: 11 } } },
          tooltip: cc.tooltip
        },
        scales: {
          r: {
            grid: { color: cc.grid, circular: false },
            angleLines: { color: cc.grid },
            ticks: { display: false },
            pointLabels: { color: cc.text, font: { family: 'Tajawal', size: 11 } }
          }
        }
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   MEMBERS TABLE VIEW
   ═══════════════════════════════════════════════════════════════ */
function renderMembers() {
  const avMode = localStorage.getItem('kielora_member_photos') === 'emoji' ? 'emoji' : 'photo';
  const con = $('view-members');
  con.innerHTML = `
    <div class="tbl-toolbar">
      <input type="text" id="filter-name" placeholder="${t('table.filterByName')}" value="${esc(searchQ || '')}" style="background:var(--s2);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:6px 10px;font-family:'Tajawal',sans-serif;font-size:12px;outline:none;width:150px">
      <select class="tbl-select" id="filter-family"><option value="">${t('table.filterAllFamilies')}</option></select>
      <select class="tbl-select" id="filter-zodiac"><option value="">${t('table.filterAllZodiacs')}</option></select>
      <select class="tbl-select" id="filter-month"><option value="">${t('table.filterMonths')}</option>${[1,2,3,4,5,6,7,8,9,10,11,12].map(n => `<option value="${n}">${t('months.' + ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][n-1])}</option>`).join('')}</select>
      <select class="tbl-select" id="filter-relation"><option value="">${t('table.filterRelations')}</option></select>
      <select class="tbl-select" id="filter-deceased"><option value="">${t('table.filterDeceased')}</option><option value="alive">${t('table.filterAlive')}</option><option value="deceased">${t('table.filterDeceasedOnly')}</option></select>
      <select class="tbl-select" id="filter-gender"><option value="">${t('table.filterGenders')}</option><option value="male">${t('table.filterMale')}</option><option value="female">${t('table.filterFemale')}</option></select>
      <select class="tbl-select" id="filter-group"><option value="none">${t('table.groupNone')}</option><option value="family">${t('table.groupByFamily')}</option><option value="zodiac">${t('table.groupByZodiac')}</option><option value="age">${t('table.groupByAge')}</option></select>
      <button class="lm-btn" id="btn-clear-filters" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px">✖ ${t('table.clearFilters')}</button>
      <div style="display:flex;gap:2px;background:var(--s2);border:1px solid var(--border);border-radius:9px;padding:3px">
        <button class="lm-btn view-mode-btn" id="vm-list" data-view-mode="list" title="${t('table.viewList')}">≡ ${t('table.viewList')}</button>
        <button class="lm-btn view-mode-btn" id="vm-cards" data-view-mode="cards" title="${t('table.viewCards')}">▦ ${t('table.viewCards')}</button>
      </div>
      <button class="lm-btn" id="btn-avatar-mode" title="${avMode === 'emoji' ? t('table.showPhotos') : t('table.showEmoji')}" style="border:1px solid var(--border);border-radius:9px;padding:5px 10px">${avMode === 'emoji' ? '🖼️ ' + t('table.showPhotos') : '👤 ' + t('table.showEmoji')}</button>
      <span style="font-size:12px;color:var(--muted);margin-right:auto">${t('common.memberCount', {count: filterMembersByScope(members).length})}</span>
    </div>
    ${(() => { const g = dataGaps(); return g.n ? '<div class="gap-banner">✏️ <span class="gb-t">' + t('gap.title', {n: g.n}) + '</span>' + g.chips + '<button class="lm-btn" id="btn-gap-fix" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px">' + t('gap.view') + '</button></div>' : ''; })()}
    ${(() => { const unk = members.filter(isBirthUnknown); return unk.length ? '<div class="gap-banner">🎂 <span class="gb-t">' + t('gap.unknownBirthTitle', {n: unk.length}) + '</span>' + unk.slice(0, 20).map(u => '<span class="gap-chip" data-gap-birth="' + esc(u.id) + '" style="cursor:pointer" title="' + esc(u.name) + '">' + esc(dispName(u)) + '</span>').join('') + (unk.length > 20 ? '<span class="gap-chip">+' + (unk.length - 20) + '</span>' : '') + '<button class="lm-btn" id="btn-gap-birth" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px">' + t('gap.editDates') + '</button></div>' : ''; })()}
    <div class="tbl-wrap" id="tbl-wrap">
      <table>
        <thead><tr>
          <th data-sort="name"><div class="th-inner">${t('table.colName')} <span class="sort-arrow" id="sa-name"></span></div></th>
          <th><div class="th-inner">${t('table.colRelation')}</div></th>
          <th data-sort="birthDate"><div class="th-inner">${t('table.colBirthDate')} <span class="sort-arrow" id="sa-birthDate"></span></div></th>
          <th data-sort="age"><div class="th-inner">${t('table.colAge')} <span class="sort-arrow" id="sa-age"></span></div></th>
          <th><div class="th-inner">${t('table.colZodiac')} <span class="sort-arrow" id="sa-zodiac"></span></div></th>
          <th><div class="th-inner">${t('table.colTraits')}</div></th>
          <th data-sort="daysUntil"><div class="th-inner">${t('table.colBirthday')} <span class="sort-arrow" id="sa-daysUntil"></span></div></th>
          <th><div class="th-inner">${t('table.colActions')}</div></th>
        </tr></thead>
        <tbody id="tbl-body"></tbody>
      </table>
    </div>
    <div class="members-cards" id="members-cards" style="display:none"></div>`;

  // Restore sort arrow
  const arrowEl = $('sa-' + sortCol);
  if (arrowEl) arrowEl.textContent = sortDir === 1 ? ' ▲' : ' ▼';

  renderTableBody();
  loadFiltersIntoTable();

  const tblWrap = $('tbl-wrap');
  const cards = $('members-cards');
  const listBtn = $('vm-list');
  const cardsBtn = $('vm-cards');
  if (membersViewMode === 'cards') {
    if (tblWrap) tblWrap.style.display = 'none';
    if (cards) cards.style.display = 'grid';
    if (listBtn) listBtn.classList.remove('vm-active');
    if (cardsBtn) cardsBtn.classList.add('vm-active');
  } else {
    if (tblWrap) tblWrap.style.display = '';
    if (cards) cards.style.display = 'none';
    if (listBtn) listBtn.classList.add('vm-active');
    if (cardsBtn) cardsBtn.classList.remove('vm-active');
  }
}

async function loadFiltersIntoTable() {
  try {
    const data = await api('/api/filters');
    const fsel = $('filter-family');
    const zsel = $('filter-zodiac');
    if (fsel) {
      const fv = fsel.value;
      fsel.innerHTML = '<option value="">' + t('table.filterAllFamilies') + '</option>' + data.families.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
      fsel.value = fv;
    }
    if (zsel) {
      const zv = zsel.value;
      zsel.innerHTML = '<option value="">' + t('table.filterAllZodiacs') + '</option>' + data.zodiacs.map(z => `<option value="${esc(z)}">${esc(z)}</option>`).join('');
      zsel.value = zv;
    }
    const rsel = $('filter-relation');
    if (rsel) {
      const rv = rsel.value;
      const rels = [...new Set(members.map(m => (m.relation || '').trim()).filter(Boolean))];
      rsel.innerHTML = '<option value="">' + t('table.filterRelations') + '</option>' + rels.map(r => `<option value="${r}">${esc(relTxt(r))}</option>`).join('');
      rsel.value = rv;
    }
  } catch (e) {}
}

function memberAvatar(m) {
  const mode = localStorage.getItem('kielora_member_photos') === 'emoji' ? 'emoji' : 'photo';
  if (mode === 'photo' && m.photoPath) {
    const fallback = m.gender === 'female' ? '👩' : '👨';
    return `<img class="mav-img" src="${esc(m.photoPath)}" alt="" loading="lazy" onerror="this.outerHTML='${fallback}';">`;
  }
  return m.gender === 'female' ? '👩' : '👨';
}

function memberRow(m) {
    const known = hasRealBirth(m);
    const isSoon = known && m.daysUntilBirthday > 0 && m.daysUntilBirthday <= 30;
    const bdayCell = !known
      ? `<div class="bday-chip bday-normal">—</div>`
      : (isSoon
        ? `<div class="bday-chip bday-soon">🎂 ${m.daysUntilBirthday} ${t('table.daysUntil')}</div>`
        : `<div class="bday-chip bday-normal">📅 ${m.daysUntilBirthday} ${t('table.daysUntil')}</div>`);
    const zodiac = zodiacOf(m);
    return `<tr data-id="${m.id}">
      <td><div class="td-name" data-profile="${m.id}" style="cursor:pointer" title="${t('table.viewProfileTitle')}">${memberAvatar(m)} ${hl(dispName(m), searchQ)}</div></td>
      <td><div class="td-rel">${esc(dispRel(m)) || '—'}</div></td>
      <td style="font-size:12px;color:var(--muted)">${birthTxt(m) || '—'}</td>
      <td>${known ? `<div class="age-cell">${m.age.years}</div><div class="age-detail">${m.age.months}${t('table.monthAbbr')} ${m.age.days}${t('table.dayAbbr')}</div>` : `<div class="age-cell">—</div>`}</td>
      <td>${zodiac ? `<div class="zodiac-cell"><div class="z-dot" style="background:${zodiac.color}">${zodiac.sym}</div><div><div class="z-name">${zodiac.name}</div><div class="z-el">${zodiac.element}</div></div></div>` : '<div class="zodiac-cell">—</div>'}</td>
      <td>${zodiac ? (zodiac.traits || []).map(zt => `<span class="trait-pill">${zt}</span>`).join('') : '—'}</td>
      <td>${bdayCell}</td>
      <td><div class="action-cell"><button class="tbl-action tbl-edit" data-edit="${m.id}">✏️</button><button class="tbl-action tbl-view" data-profile="${m.id}" title="${t('table.viewProfile')}">👁️</button><button class="tbl-action tbl-del" data-delete="${m.id}">🗑️</button></div></td>
    </tr>`;
  }

function renderTableBody() {
  const tbody = $('tbl-body');
  const cards = $('members-cards');
  const tblWrap = $('tbl-wrap');
  const scoped = filterMembersByScope(members);
  if (!scoped.length) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><div class="big">🔍</div>${searchQ ? t('table.emptySearch') : t('table.emptyNoMembers')}</td></tr>`;
    if (cards) cards.innerHTML = `<div class="empty-state"><div class="big">🔍</div>${searchQ ? t('table.emptySearch') : t('table.emptyNoMembers')}</div>`;
    return;
  }
  if (groupsData && groupsData.length) {
    const rows = [];
    groupsData.forEach(g => {
      const ms = filterMembersByScope(g.members || []);
      if (!ms.length) return;
      rows.push(`<tr class="group-header-row"><td colspan="8"><span class="group-header-badge">${esc(g.groupName)}</span><span class="group-header-info">${ms.length} ${t('table.groupHeaderInfo')} ${g.avgAge} ${t('table.groupHeaderYears')}</span></td></tr>`);
      ms.forEach(m => rows.push(memberRow(m)));
    });
    if (tbody) tbody.innerHTML = rows.join('');
    return;
  }
  if (tbody) tbody.innerHTML = scoped.map(m => memberRow(m)).join('');
  if (cards) {
    if (groupsData && groupsData.length) {
      cards.innerHTML = groupsData.map(g => {
        const ms = filterMembersByScope(g.members || []);
        if (!ms.length) return '';
        return `<div style="grid-column:1/-1;margin-top:6px"><span class="group-header-badge">${esc(g.groupName)}</span><span class="group-header-info">${ms.length} ${t('table.groupHeaderInfo')} ${g.avgAge} ${t('table.groupHeaderYears')}</span></div>
        ${ms.map(m => memberCard(m)).join('')}`;
      }).join('');
    } else {
      cards.innerHTML = scoped.map(m => memberCard(m)).join('');
    }
  }
  if (tblWrap && searchQ) {
    tblWrap.scrollTop = 0;
    if (tbody) {
      const first = tbody.querySelector('tr');
      if (first) {
        first.classList.add('s-flash');
        setTimeout(() => first.classList.remove('s-flash'), 1600);
      }
    }
  }
}

function memberCard(m) {
  const known = hasRealBirth(m);
  const isSoon = known && m.daysUntilBirthday > 0 && m.daysUntilBirthday <= 30;
  const zodiac = zodiacOf(m);
  return `<div class="member-card" data-id="${m.id}" style="border-top:3px solid ${zodiac ? zodiac.color : 'var(--border)'}">
    <div class="mc-photo" data-profile="${m.id}" style="cursor:pointer">${memberAvatar(m)}</div>
    <div class="mc-name" data-profile="${m.id}" style="cursor:pointer">${esc(dispName(m))}</div>
    <div class="mc-rel">${esc(dispRel(m)) || '—'}</div>
    <div class="mc-z">${zodiac ? zodiac.sym + ' ' + zodiac.name + ' • ' + zodiac.element : '—'}</div>
    <div class="mc-age">${known && m.age ? `<b>${m.age.years}</b> ${t('tree.years')} • ${m.age.months}${t('table.monthAbbr')} ${m.age.days}${t('table.dayAbbr')}` : '—'}</div>
    <div class="mc-bday">${known
      ? (isSoon
        ? `<span class="bday-chip bday-soon">🎂 ${m.daysUntilBirthday} ${t('table.daysUntil')}</span>`
        : `<span class="bday-chip bday-normal">📅 ${m.daysUntilBirthday} ${t('table.daysUntil')}</span>`)
      : `<span class="bday-chip bday-normal">—</span>`}</div>
    <div class="mc-actions"><button class="tbl-action tbl-edit" data-edit="${m.id}">✏️</button><button class="tbl-action tbl-view" data-profile="${m.id}" title="${t('table.viewProfile')}">👁️</button><button class="tbl-action tbl-del" data-delete="${m.id}">🗑️</button></div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   FAMILY TREE VIEW — DOM-based
   ═══════════════════════════════════════════════════════════════ */
function renderTree() {
  const con = $('view-tree');
  con.innerHTML = `
    <div class="tree-toolbar">
      <div class="sel-wrap" id="tf-wrap"><div class="sel-trigger" id="tf-trigger">🌳 ${t('tree.viewAll')}</div><div class="sel-drop" id="tf-drop"></div></div>
      <div style="display:flex;gap:3px;background:var(--s2);border-radius:9px;padding:3px;border:1px solid var(--border)">
        <button class="lm-btn" data-action="expand-all">＋ ${t('tree.expandAll')}</button>
        <button class="lm-btn" data-action="collapse-all">− ${t('tree.collapseAll')}</button>
      </div>
      <div style="display:flex;align-items:center;gap:4px;background:var(--s2);border:1px solid var(--border);border-radius:9px;padding:3px 8px">
        <button class="lm-btn" data-action="zoom-out">🔍−</button>
        <input type="range" id="tree-zoom" min="20" max="300" value="100" style="width:90px;accent-color:var(--gold)">
        <button class="lm-btn" data-action="zoom-in">🔍+</button>
        <span id="tree-zoom-pct" style="font-size:10px;color:var(--muted);min-width:34px;text-align:center">100%</span>
      </div>
      <button class="lm-btn" data-action="fit">🎯 ${t('tree.fit')}</button>
      <button class="lm-btn" data-action="reset">↺ ${t('tree.center')}</button>
      <div style="display:flex;gap:3px;background:var(--s2);border-radius:9px;padding:3px;border:1px solid var(--border)">
        <button class="lm-btn" data-action="export-png">🖼️ ${t('tree.png')}</button>
        <button class="lm-btn" data-action="export-pdf">📄 ${t('tree.pdf')}</button>
      </div>
    </div>
    <div class="tree-body">
      <div class="tree-wrap" id="tree-wrap">
        <div class="tree-canvas" id="tree-canvas"></div>
        <div class="tree-minimap" id="tree-minimap"></div>
      </div>
      <div class="tree-statusbar">
        <span class="tree-stats" id="tree-stats"></span>
        <span class="ts-sep"></span>
        <div class="tree-legend">
          <span class="tl-item"><i style="background:var(--gen0)"></i> ${t('tree.legend.gen0')}</span>
          <span class="tl-item"><i style="background:var(--gen1)"></i> ${t('tree.legend.gen1')}</span>
          <span class="tl-item"><i style="background:var(--gen2)"></i> ${t('tree.legend.gen2')}</span>
          <span class="tl-item"><i style="background:var(--gen3)"></i> ${t('tree.legend.gen3')}</span>
          <span class="tl-item"><i style="background:var(--gen4)"></i> ${t('tree.legend.gen4')}</span>
          <span class="tl-item"><i class="tl-dead"></i> ✦ ${t('tree.deceased')}</span>
        </div>
        <span class="ts-sep"></span>
        <label>🧩 ${t('tree.showGenerations')}</label>
        <select id="tree-gen-limit" class="tbl-select"></select>
        <div class="tree-style-group" id="tree-style-group">
          <button class="ts-btn" data-style="elegant" title="${t('tree.styleElegant')}">✨ <span>${t('tree.styleElegant')}</span></button>
          <button class="ts-btn" data-style="flow" title="${t('tree.styleFlow')}">🌊 <span>${t('tree.styleFlow')}</span></button>
          <button class="ts-btn" data-style="neon" title="${t('tree.styleNeon')}">💫 <span>${t('tree.styleNeon')}</span></button>
          <button class="ts-btn" data-style="ortho" title="${t('tree.styleOrtho')}">📐 <span>${t('tree.styleOrtho')}</span></button>
        </div>
        <input type="text" id="tree-search" class="tree-search" placeholder="🔍 ${t('tree.searchHint')}">
      </div>
    </div>`;

  treeFitted = false;
  const keptView = treeKeepView;
  treeKeepView = false;
  if (!keptView) {
    pan = { x: 0, y: 0 };
    scale = 1;
  }
  const styleBtn = (btns, st) => { btns.forEach(b => b.classList.toggle('active', b.dataset.style === st)); };
  const styleButtons = Array.from(document.querySelectorAll('#tree-style-group .ts-btn'));
  styleBtn(styleButtons, treeLineStyle);
  const applyStyle = (st) => {
    treeLineStyle = st;
    localStorage.setItem('kielora_line_style', st);
    styleBtn(styleButtons, st);
    buildTreeContent();
    applyTransform();
  };
  styleButtons.forEach(b => { b.onclick = () => applyStyle(b.dataset.style); });
  bindTreeSearch();
  const genSel = $('tree-gen-limit');
  if (genSel) genSel.onchange = function () {
    treeGenLimit = parseInt(this.value, 10) || 0;
    buildTreeContent();
    applyTransform();
    requestAnimationFrame(fitTreeToView);
  };
  try {
    ensureFamilyScopeList(members);
    buildTreeContent();
    applyTransform();
    rebuildTreeFocus();
    setupTreePanZoom();
  } catch (err) {
    console.error('Tree render error:', err);
    const cv = $('tree-canvas');
    if (cv) cv.innerHTML = '<div class="ft-empty" style="margin:auto">⚠️ ' + esc(t('tree.renderError') || 'Tree render error') + '</div>';
    const ts2 = $('tree-stats');
    if (ts2) ts2.textContent = '';
  }
  const treeFit = () => fitTreeToView();
  if (keptView) {
    applyTransform(true);
  } else {
    requestAnimationFrame(treeFit);
    setTimeout(treeFit, 120);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(treeFit);
  }
}

function buildTreeContent() {
  const canvas = $('tree-canvas');
  if (!canvas) return;
  if (!members.length) {
    canvas.innerHTML = '<div class="ft-empty" style="margin:auto">🌳 ' + t('tree.empty') + '</div>';
    const ts = $('tree-stats');
    if (ts) ts.textContent = '';
    return;
  }

  ensureFamilyScopeList(members);
  const fm = treeFocusId ? getSubtreeMembers(treeFocusId) : filterMembersByScope(members);
  const fmIds = new Set(fm.map(m => m.id));
  const famIdxOf = m => {
    const n = famScopeOf(m);
    const c = FAMILY_CLUSTER_ORDER.find(x => x.name === n);
    return c ? c.i : -1;
  };

  // Build spouse pairs (only once per couple).
  // Guard: never couple a person with their own parent/child — a direct
  // parent/child link always wins over a spouse/partner pointer.
  const spouses = {};
  const isDirectParentChild = (a, b) => {
    const ma = fm.find(x => x.id === a);
    const mb = fm.find(x => x.id === b);
    if (!ma || !mb) return false;
    return String(ma.parentId) === String(b) || String(mb.parentId) === String(a);
  };
  fm.forEach(m => {
    if (m.spouseId && fmIds.has(m.spouseId) && !isDirectParentChild(m.id, m.spouseId)) {
      const a = m.id, b = m.spouseId;
      if (a < b && !spouses[a] && !spouses[b]) spouses[a] = b;
      else if (b < a && !spouses[a] && !spouses[b]) spouses[b] = a;
    }
  });

  // Build parent-children map
  const childrenOf = {};
  fm.forEach(m => {
    if (m.parentId && fmIds.has(m.parentId)) {
      if (!childrenOf[m.parentId]) childrenOf[m.parentId] = [];
      childrenOf[m.parentId].push(m.id);
    }
  });
  Object.keys(childrenOf).forEach(k => {
    childrenOf[k] = sibSortIds(childrenOf[k], k);
  });

  // Find roots: members with no parent (or parent not in filtered set)
  // Also exclude spouse-only entries whose partner has a parent
  const spouseIds = new Set(Object.values(spouses));
  const roots = [];
  fm.forEach(m => {
    if (!m.parentId || !fmIds.has(m.parentId)) {
      if (!spouseIds.has(m.id)) {
        roots.push(m.id);
      }
    }
  });
  if (!roots.length && fm.length) {
    roots.push(fm[0].id);
  }

  // Stats
  const counted = new Set();
  function countAll(id) {
    if (counted.has(id)) return 0;
    counted.add(id);
    let c = 1;
    const m = fm.find(x => x.id === id);
    if (m && spouses[id] && fmIds.has(spouses[id]) && !counted.has(spouses[id])) { c++; counted.add(spouses[id]); }
    (childrenOf[id] || []).forEach(ch => { c += countAll(ch); });
    return c;
  }
  let total = 0;
  roots.forEach(r => { total += countAll(r); });

  function maxGen(id, visited = new Set()) {
    if (visited.has(id)) return 0;
    visited.add(id);
    let mx = 0;
    (childrenOf[id] || []).forEach(c => { mx = Math.max(mx, maxGen(c, visited)); });
    return mx + 1;
  }
  let depth = 0;
  roots.forEach(r => { depth = Math.max(depth, maxGen(r)); });
  treeDepth = depth;
  refreshTreeGenOptions();

  const ts = $('tree-stats');
  if (ts) ts.textContent = t('tree.stats', { members: fm.length, generations: depth, roots: roots.length });

  function buildFamilyUnit(parentId, gen) {
    const gc = gen % 5;

function personCard(m, genOverride) {
      const gg = genOverride != null ? genOverride % 5 : gc;
      const isRoot = !m.parentId && !spouseIds.has(m.id);
      const noBirth = !hasRealBirth(m);
      const cls = `gen-${gg}${m.daysUntilBirthday > 0 && m.daysUntilBirthday <= 30 ? ' bday-soon' : ''}${m.isDeceased ? ' deceased' : ''}${isRoot ? ' ft-root' : ''}${noBirth ? ' no-birth' : ''}`;
      const isMother = m.gender === 'female' && m.parentId;
      const photo = m.photoPath ? `<img src="${esc(m.photoPath)}">` : (m.gender === 'female' ? '👩' : '👨');
      const known = hasRealBirth(m);
      const zodiac = zodiacOf(m);
      const info = m.isDeceased
        ? `<div class="pinfo">⚰️ ${t('tree.deceased')}</div>`
        : `<div class="pinfo">${known && m.age && zodiac ? (m.age.years + ' ' + t('tree.years') + ' • ' + zodiac.sym + ' ' + zodiac.name) : (!known ? t('common.unknown') : '?')}</div>`;
      const span = m.isDeceased
        ? `<div class="pspan">${birthTxt(m) || '—'} → ${m.deathDate || ''}</div>`
        : (birthTxt(m) ? `<div class="pspan">${m.birthDate}</div>` : '');
      const myKids = childrenOf[m.id] || [];
      const spId = spouses[m.id];
      const spKids = spId ? (childrenOf[spId] || []).filter(k => k !== m.id && !myKids.includes(k)) : [];
      const kidCount = myKids.length + spKids.length;
      return `<div class="ft-person ${cls}" data-member="${m.id}" data-gen="${gg}" data-fam="${famIdxOf(m)}">
        ${isMother ? '<div class="ft-mother-tag">🧕 ' + esc(t('tree.mother') || 'mother') + '</div>' : ''}
        ${kidCount ? `<div class="ft-kids">👶 ${kidCount}</div>` : ''}
        <div class="photo">${photo}</div>
        <div class="pname">${esc(dispName(m))}</div>
        ${info}
        ${m.relation || m.parentId || m.spouseId ? `<div class="prelation">${esc(dispRel(m))}</div>` : ''}
        ${span}
        <button class="ft-addkids" data-bulk-children="${m.id}" title="${t('tree.addChildren')}">＋</button>
        ${kidCount ? `<button class="ft-sib" data-sib-order="${m.id}" title="${t('sib.reorder')}">🔀</button>` : ''}
        <button class="ft-gender" data-quick-gender="${m.id}" title="${esc(t('memberModal.gender') || 'gender')}">⚥</button>
</div>`;
    }

    // Render ONE couple (each member appears exactly once per branch)
    function coupleHtmlFor(id, genOverride) {
      const m = fm.find(x => x.id === id);
      if (!m) return '';
      let h = personCard(m, genOverride);
      const spId = spouses[id];
      const sp = spId ? fm.find(x => x.id === spId) : null;
      const xfam = sp && famIdxOf(m) !== famIdxOf(sp) ? ' data-xfam="1"' : '';
      if (sp) h += '<div class="ft-heart">💍</div>' + personCard(sp, genOverride);
      return `<div class="ft-couple"${xfam}>${h}</div>`;
    }

    // Render the children/subtree below a couple head (head excluded)
    function descentFor(id, gen, _vis = new Set()) {
      if (treeGenLimit > 0 && gen >= treeGenLimit) return '';
      const spId = spouses[id];
      const kids = (childrenOf[id] || []).filter(k => k !== spId);
      const sp = spId ? fm.find(m => m.id === spId) : null;
      const spouseKids = sp ? (childrenOf[spId] || []).filter(k => k !== id && !kids.includes(k)) : [];
      const allKids = sibSortIds([...new Set([...kids, ...spouseKids])], id);
      if (!allKids.length) return '';
      const isCollapsed = treeCollapsed.has(id);
      if (isCollapsed) {
        return `<div class="ft-descent"><div class="ft-vline"></div><button class="lm-btn" data-expand="${id}" style="font-size:11px;padding:3px 8px;margin-top:2px">＋ (${allKids.length})</button></div>`;
      }
      const kidBranches = allKids.map(kidId => {
        const kid = fm.find(m => m.id === kidId);
        if (!kid) return '';
        if (_vis.has(String(kidId))) return '';
        _vis.add(String(kidId));
        let inner;
        if (!treeCollapsed.has(kidId)) {
          inner = coupleHtmlFor(kidId, gen + 1) + descentFor(kidId, gen + 1, _vis);
        } else {
          inner = coupleHtmlFor(kidId, gen + 1);
          const ksp = spouses[kidId];
          const hasKids = (childrenOf[kidId] || []).length > 0 || (ksp && (childrenOf[ksp] || []).length > 0);
          if (hasKids) {
            inner += `<div class="ft-subtree"><button class="lm-btn" data-expand="${kidId}" style="font-size:11px;padding:4px 10px;margin-top:4px">＋ ${t('tree.expand')}</button></div>`;
          }
        }
        _vis.delete(String(kidId));
        return `<div class="ft-child-branch"><div class="ft-child-link"></div>${inner}</div>`;
      }).join('');

      const collapseBtn = `<button class="lm-btn" data-collapse="${id}" style="font-size:11px;padding:3px 8px;margin-top:2px">−</button>`;

      return `<div class="ft-descent"><div class="ft-vline"></div>${collapseBtn}<div class="ft-children">${kidBranches}</div></div>`;
    }

    return coupleHtmlFor(parentId, gen) + descentFor(parentId, gen);
  }

  let html = '';

  const treeRoots = roots.filter(id => {
    const m = fm.find(x => x.id === id);
    if (!m) return true;
    const hasKids = (childrenOf[id] || []).length > 0 || (m.spouseId && (childrenOf[m.spouseId] || []).length > 0);
    return hasKids;
  });

  const isolatedIds = roots.filter(id => !treeRoots.includes(id));

  // When not focused on a single member, group each family's units into a
  // colored block with a header — distant families become visually distinct.
  const grouped = !treeFocusId && FAMILY_CLUSTER_ORDER.length > 0;
  if (grouped) {
    const byFam = new Map();
    const addTo = (idx, kind, item) => {
      if (!byFam.has(idx)) byFam.set(idx, { roots: [], isolated: [] });
      byFam.get(idx)[kind].push(item);
    };
    treeRoots.forEach(rootId => {
      const m = fm.find(x => x.id === rootId);
      addTo(m ? famIdxOf(m) : -1, 'roots', rootId);
    });
    isolatedIds.forEach(id => {
      const m = fm.find(x => x.id === id);
      if (m) addTo(famIdxOf(m), 'isolated', m);
    });
    const orderedIdxs = [...FAMILY_CLUSTER_ORDER.map(c => c.i)];
    [...byFam.keys()].filter(k => k >= 0 && !orderedIdxs.includes(k)).forEach(k => orderedIdxs.push(k));
    orderedIdxs.forEach(idx => {
      const g = byFam.get(idx);
      if (!g) return;
      const cl = FAMILY_CLUSTER_ORDER.find(c => c.i === idx);
      const color = cl ? cl.color : '#98a2b3';
      const name = cl ? esc(cl.name) : esc(t('famScope.link'));
      let inner = '';
      g.roots.forEach((rootId, ri) => {
        inner += buildFamilyUnit(rootId, 0);
        if (ri < g.roots.length - 1) inner += '<div style="height:18px"></div>';
      });
      if (g.isolated.length) {
        inner += `<div class="ft-iso-grid">${g.isolated.map(m => {
          const photo = m.photoPath ? `<img src="${esc(m.photoPath)}">` : (m.gender === 'female' ? '👩' : '👨');
          const zodiac = zodiacOf(m);
          const info = m.isDeceased
            ? `<div class="pinfo">⚰️ ${t('tree.deceased')}</div>`
            : `<div class="pinfo">${hasRealBirth(m) && m.age && zodiac ? (m.age.years + ' ' + t('tree.years') + ' • ' + zodiac.sym + ' ' + zodiac.name) : (!hasRealBirth(m) ? t('common.unknown') : '?')}</div>`;
          return `<div class="ft-person gen-0 ft-root${m.isDeceased ? ' deceased' : ''}${!hasRealBirth(m) ? ' no-birth' : ''}" data-member="${m.id}" data-gen="0" data-fam="${idx}">
            <div class="photo">${photo}</div>
            <div class="pname">${esc(dispName(m))}</div>
            ${info}
            ${m.relation || m.parentId || m.spouseId ? `<div class="prelation">${esc(dispRel(m))}</div>` : ''}
            ${birthTxt(m) ? `<div class="pspan">${m.birthDate}</div>` : ''}
            <button class="ft-gender" data-quick-gender="${m.id}" title="${esc(t('memberModal.gender') || 'gender')}">⚥</button>
          </div>`;
        }).join('')}</div>`;
      }
      if (!inner) return;
      html += `<div class="ft-fam-block" data-fam="${idx}" style="--famc:${color};--famcbg:${color}14">
        <div class="ft-fam-head"><span class="ft-fam-name">${name}</span><span class="ft-fam-count">👥 ${cl ? cl.count : ''}</span></div>
        ${inner}
      </div>`;
    });
  } else {
    treeRoots.forEach((rootId, i) => {
      html += buildFamilyUnit(rootId, 0);
      if (i < treeRoots.length - 1) html += '<div style="height:30px"></div>';
    });
    let htmlCards = '';
    isolatedIds.forEach(id => {
      const m = fm.find(x => x.id === id);
      if (!m) return;
      const photo = m.photoPath ? `<img src="${esc(m.photoPath)}">` : (m.gender === 'female' ? '👩' : '👨');
      const zodiac = zodiacOf(m);
      const info = m.isDeceased
        ? `<div class="pinfo">⚰️ ${t('tree.deceased')}</div>`
        : `<div class="pinfo">${hasRealBirth(m) && m.age && zodiac ? (m.age.years + ' ' + t('tree.years') + ' • ' + zodiac.sym + ' ' + zodiac.name) : (!hasRealBirth(m) ? t('common.unknown') : '?')}</div>`;
      htmlCards += `<div class="ft-person gen-0 ft-root${m.isDeceased ? ' deceased' : ''}${!hasRealBirth(m) ? ' no-birth' : ''}" data-member="${m.id}" data-gen="0">
        <div class="photo">${photo}</div>
        <div class="pname">${esc(dispName(m))}</div>
        ${info}
        ${m.relation || m.parentId || m.spouseId ? `<div class="prelation">${esc(dispRel(m))}</div>` : ''}
        ${birthTxt(m) ? `<div class="pspan">${m.birthDate}</div>` : ''}
        <button class="ft-gender" data-quick-gender="${m.id}" title="${esc(t('memberModal.gender') || 'gender')}">⚥</button>
      </div>`;
    });
    if (htmlCards) {
      html += `<div class="ft-isolated"><div class="ft-iso-title">👥 ${t('tree.isolated')}</div><div class="ft-iso-grid">${htmlCards}</div></div>`;
    }
  }

  canvas.classList.remove('ls-solid', 'ls-curved', 'ls-dashed', 'ls-dotted', 'svg-mode');
  if (['elegant','flow','neon','ortho'].includes(treeLineStyle)) { canvas.classList.add('svg-mode'); }
  canvas.innerHTML = html;
  if (['elegant','flow','neon','ortho'].includes(treeLineStyle)) { drawSVGConnections(treeLineStyle); } else { const svg = $('tree-svg-layer'); if (svg) svg.innerHTML = ''; }
  buildMinimap();
}


/**
Draw live SVG links between parents, children and spouses — 4 styles:
elegant (elegant curves + hearts) | flow (animated flow) | neon (glow) | ortho (orthogonal 90°)
Re-drawn on every pan/zoom, so the links stay attached to the cards at all times.
 */
function drawSVGConnections(style) {
  const canvas = $('tree-canvas');
  const wrap = $('tree-wrap');
  if (!canvas || !wrap) return;
  const st = style || (['elegant','flow','neon','ortho'].includes(treeLineStyle) ? treeLineStyle : 'solid');
  canvas.classList.toggle('svg-mode', ['elegant','flow','neon','ortho'].includes(st));
  let svg = $('tree-svg-layer');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'tree-svg-layer');
    svg.setAttribute('class', 'tree-svg-layer');
    canvas.appendChild(svg);
  }
  if (!['elegant','flow','neon','ortho'].includes(st)) { svg.innerHTML = ''; return; }

  svg.style.display = 'block';
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = (canvas.scrollWidth || 100) + 'px';
  svg.style.height = (canvas.scrollHeight || 100) + 'px';
  svg.style.pointerEvents = 'none';

  const cr = canvas.getBoundingClientRect();
  const effScale = canvas.offsetWidth > 0 ? cr.width / canvas.offsetWidth : 1;
  const X = v => (v - cr.left) / effScale;
  const Y = v => (v - cr.top) / effScale;
  const W = w => w / effScale;
  const H = h => h / effScale;
  let content = '';

  const isOrtho = st === 'ortho';
  const isFlow = st === 'flow';
  const isElegant = st === 'elegant';
  const isNeon = st === 'neon';
  const flowCls = isFlow ? ' con-flow' : '';
  const neonCls = isNeon ? ' con-neon' : '';

  // ═══ 1. Parents → children ═══
  canvas.querySelectorAll('.ft-descent').forEach(descent => {
    const couple = descent.previousElementSibling;
    if (!couple || !couple.classList || !couple.classList.contains('ft-couple')) return;
    const parents = couple.querySelectorAll(':scope > .ft-person');
    if (!parents.length) return;

    // Anchor point below the couple (the midpoint under the two bottom cards)
    let pX = 0, pY = 0;
    if (parents.length >= 2) {
      const r1 = parents[0].getBoundingClientRect();
      const r2 = parents[1].getBoundingClientRect();
      pX = (X(r1.right) + X(r2.left)) / 2;
      pY = Math.max(Y(r1.bottom), Y(r2.bottom));
    } else {
      const r = parents[0].getBoundingClientRect();
      pX = X(r.left) + W(r.width) / 2;
      pY = Y(r.bottom);
    }

    const childrenBox = descent.querySelector('.ft-children');
    if (!childrenBox) return;
    const branches = childrenBox.querySelectorAll(':scope > .ft-child-branch');
    if (!branches.length) return;

    const anchors = [];
    branches.forEach(branch => {
      const kid = branch.querySelector(':scope .ft-person');
      if (!kid) return;
      const kr = kid.getBoundingClientRect();
      anchors.push({
        x: X(kr.left) + W(kr.width) / 2,
        y: Y(kr.top),
        gen: kid.dataset.gen || '0'
      });
    });
    if (!anchors.length) return;

    if (isOrtho) {
      // A vertical line from the parents down to the generation line, then a vertical drop for each child
      const busY = Math.min(...anchors.map(a => a.y));
      const minX = Math.min(...anchors.map(a => a.x));
      const maxX = Math.max(...anchors.map(a => a.x));
      content += `<path class="con-link gen0${neonCls}" d="M ${pX} ${pY} L ${pX} ${busY}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
      if (maxX - minX > 2) {
        content += `<path class="con-link gen0${neonCls}" d="M ${minX} ${busY} H ${maxX}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
      }
      anchors.forEach(a => {
        content += `<path class="con-link gen${a.gen}${neonCls}" d="M ${a.x} ${busY} L ${a.x} ${a.y}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
        content += `<circle class="con-dot" cx="${a.x}" cy="${busY}" r="3"/>`;
      });
    } else {
      anchors.forEach(a => {
        const midY = (pY + a.y) / 2;
        const dist = Math.abs(a.x - pX);
        let pathD;
        if (dist < 12) {
          pathD = `M ${pX} ${pY} L ${a.x} ${a.y}`;
        } else {
          pathD = `M ${pX} ${pY} C ${pX} ${pY + (a.y - pY) * 0.45}, ${a.x} ${a.y - (a.y - pY) * 0.45}, ${a.x} ${a.y}`;
        }
        content += `<path class="con-link gen${a.gen}${flowCls}${neonCls}" d="${pathD}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
      });
    }
  });

  // ═══ 2. Couples (line + heart) ═══
  const spousePairs = new Set();
  canvas.querySelectorAll('.ft-couple').forEach(couple => {
    const persons = couple.querySelectorAll(':scope > .ft-person');
    if (persons.length < 2) return;
    const r1 = persons[0].getBoundingClientRect();
    const r2 = persons[1].getBoundingClientRect();
    const p1X = X(r1.right);
    const p1Y = Y(r1.top) + H(r1.height) / 2;
    const p2X = X(r2.left);
    const p2Y = Y(r2.top) + H(r2.height) / 2;
    const midX = (p1X + p2X) / 2;
    const midY = Math.min(p1Y, p2Y) - 20;
    const pairKey = [persons[0].dataset.member, persons[1].dataset.member].sort().join('-');
    if (spousePairs.has(pairKey)) return;
    spousePairs.add(pairKey);

    let pathD;
    if (isOrtho) {
      pathD = `M ${p1X} ${p1Y} H ${p2X}`;
    } else {
      pathD = `M ${p1X} ${p1Y} C ${p1X + (p2X - p1X) * 0.4} ${midY - 8}, ${p2X - (p2X - p1X) * 0.15} ${midY + 2}, ${p2X} ${p2Y}`;
    }
    content += `<path class="con-spouse${flowCls}${neonCls}" d="${pathD}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
    content += `<text class="con-heart" x="${midX}" y="${midY - 4}" dominant-baseline="middle">${isElegant ? '💗' : '💖'}</text>`;
  });

  // ═══ 3. Marriage between two different families — a dashed golden line linking the two family blocks ═══
  const famBlocks = new Map();
  canvas.querySelectorAll('.ft-fam-block').forEach(b => famBlocks.set(b.dataset.fam, b));
  const xfamSeen = new Set();
  canvas.querySelectorAll('.ft-couple[data-xfam="1"]').forEach(couple => {
    const persons = couple.querySelectorAll(':scope > .ft-person');
    if (persons.length < 2) return;
    const f0 = persons[0].dataset.fam;
    const f1 = persons[1].dataset.fam;
    if (f0 == null || f1 == null || f0 === f1) return;
    const pairKey = [persons[0].dataset.member, persons[1].dataset.member].sort().join('-');
    if (xfamSeen.has(pairKey)) return;
    xfamSeen.add(pairKey);
    const myBlock = couple.closest('.ft-fam-block');
    const otherFam = (myBlock && myBlock.dataset.fam === f0) ? f1 : f0;
    const otherBlock = famBlocks.get(otherFam);
    if (!otherBlock) return;
    const otherHead = otherBlock.querySelector('.ft-fam-head');
    if (!otherHead) return;
    const rC = couple.getBoundingClientRect();
    const rH = otherHead.getBoundingClientRect();
    const x1 = X(rC.left) + W(rC.width) / 2;
    const y1 = Y(rC.top) + H(rC.height) / 2;
    const x2 = X(rH.left) + W(rH.width) / 2;
    const y2 = Y(rH.top) + H(rH.height) / 2;
    const midX2 = (x1 + x2) / 2;
    const midY2 = (y1 + y2) / 2;
    let pathX;
    if (isOrtho) {
      pathX = `M ${x1} ${y1} L ${x1} ${midY2} L ${x2} ${midY2} L ${x2} ${y2}`;
    } else {
      pathX = `M ${x1} ${y1} C ${x1} ${midY2}, ${x2} ${midY2}, ${x2} ${y2}`;
    }
    content += `<path class="con-xfam" d="${pathX}" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
    content += `<text class="con-xfam-heart" x="${midX2}" y="${midY2 - 8}" dominant-baseline="middle">💍</text>`;
    content += `<text class="con-xfam-label" x="${midX2}" y="${midY2 + 12}" dominant-baseline="middle">${esc(t('famScope.link'))}</text>`;
  });

  svg.innerHTML = content;
}

/*═══ MINIMAP: a miniature map of the tree with a viewport window ═══*/
let __mmData = null;
function buildMinimap() {
  const mm = $('tree-minimap');
  const canvas = $('tree-canvas');
  if (!mm || !canvas) return;
  const cards = canvas.querySelectorAll('.ft-person');
  if (!cards.length) { mm.style.display = 'none'; return; }
  mm.style.display = 'block';

  // Compute the positions in content coordinates (without applying the transform)
  const contentPos = el => {
    const cr = canvas.getBoundingClientRect();
    const eff = canvas.offsetWidth > 0 ? cr.width / canvas.offsetWidth : 1;
    const r = el.getBoundingClientRect();
    return { x: (r.left - cr.left) / eff, y: (r.top - cr.top) / eff, w: r.width / eff, h: r.height / eff };
  };
  const pts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cards.forEach(c => {
    const p = contentPos(c);
    if (!isFinite(p.x) || !isFinite(p.y)) return;
    pts.push({ ...p, gen: c.dataset.gen || '0' });
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
  });
  const fw = canvas.scrollWidth || (maxX - minX), fh = canvas.scrollHeight || (maxY - minY);
  IF: if (fw < 10 || fh < 10 || !pts.length) {
    mm.innerHTML = ''; return;
  }

  const SW = mm.offsetWidth || 170, SH = mm.offsetHeight || 118;
  const pad = 8;
  const scale = Math.min((SW - pad * 2) / fw, (SH - pad * 2) / fh);
  const ox = (SW - fw * scale) / 2, oy = (SH - fh * scale) / 2;
  __mmData = { scale, ox, oy, fw, fh, sw: SW, sh: SH };

  const genColor = [0, 1, 2, 3, 4].map(g => `var(--gen${g})`);
  let s = `<svg width="${SW}" height="${SH}" xmlns="http://www.w3.org/2000/svg">`;
  pts.forEach(p => {
    const g = Math.max(0, Math.min(4, parseInt(p.gen, 10) || 0));
    s += `<rect class="mm-card" x="${ox + p.x * scale}" y="${oy + p.y * scale}" width="${Math.max(3, p.w * scale)}" height="${Math.max(3, p.h * scale)}" fill="${genColor[g]}" opacity="0.55" rx="2"/>`;
  });
  s += '<rect class="mm-view" id="mm-view" fill="rgba(245,197,24,0.14)" stroke="var(--gold)" stroke-width="1" stroke-dasharray="3 2"/></svg>';
  mm.innerHTML = s;
  drawMinimapViewport();
}

function drawMinimapViewport() {
  const mm = $('tree-minimap');
  const wrap = $('tree-wrap');
  if (!mm || !wrap || !__mmData) return;
  const v = mm.querySelector('#mm-view');
  if (!v) return;
  const d = __mmData;
  const vx = -pan.x / scale, vy = -pan.y / scale;
  const vw = wrap.clientWidth / scale, vh = wrap.clientHeight / scale;
  const x = d.ox + vx * d.scale, y = d.oy + vy * d.scale;
  v.setAttribute('x', x);
  v.setAttribute('y', y);
  v.setAttribute('width', vw * d.scale);
  v.setAttribute('height', vh * d.scale);
}

/*Navigate by clicking / dragging on the minimap*/
function setupMinimapNav() {
  const mm = $('tree-minimap');
  const wrap = $('tree-wrap');
  if (!mm || !wrap) return;
  let dragging = false;
  const jump = e => {
    if (!__mmData) return;
    const d = __mmData;
    const r = mm.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const cx = (mx - d.ox) / d.scale, cy = (my - d.oy) / d.scale;
    pan.x = wrap.clientWidth / 2 - cx * scale;
    pan.y = wrap.clientHeight / 2 - cy * scale;
    applyTransform(true);
  };
  mm.addEventListener('mousedown', e => { dragging = true; jump(e); e.preventDefault(); mm.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', e => { if (dragging) jump(e); });
  window.addEventListener('mouseup', () => { dragging = false; if (mm) mm.style.cursor = 'pointer'; });
}

/*═══ In-tree search with highlighting and navigation ═══*/
function bindTreeSearch() {
  const inp = $('tree-search');
  if (!inp) return;
  inp.oninput = () => {
    const q = normAr(inp.value.trim());
    const cards = document.querySelectorAll('#tree-canvas .ft-person');
    cards.forEach(c => c.classList.remove('search-hit'));
    if (!q) return;
    let first = null;
    cards.forEach(c => {
      const m = members.find(x => String(x.id) === String(c.dataset.member));
      if (m && normAr(dispName(m)).includes(q)) {
        c.classList.add('search-hit');
        if (!first) first = c;
      }
    });
    if (first) focusCard(first);
  };
}

function focusCard(card) {
  const wrap = $('tree-wrap');
  if (!wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  const cx = (r.left + r.width / 2) - wrapRect.left;
  const cy = (r.top + r.height / 2) - wrapRect.top;
  pan.x = wrap.clientWidth / 2 - cx;
  pan.y = wrap.clientHeight / 2 - cy;
  applyTransform();
}
function getSubtreeMembers(rootId) {
  if (!rootId) return members;
  const result = [];
  const visited = new Set();
  function collect(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const m = members.find(x => x.id === id);
    if (!m) return;
    result.push(m);
    if (m.spouseId && !visited.has(m.spouseId)) {
      const s = members.find(x => x.id === m.spouseId);
      if (s) collect(s.id);
    }
    members.filter(x => x.parentId === id).forEach(c => collect(c.id));
  }
  collect(rootId);
  return result;
}

function refreshTreeGenOptions() {
  const sel = $('tree-gen-limit');
  if (!sel) return;
  const curStr = String(treeGenLimit);
  sel.innerHTML = '<option value="0">🌳 ' + t('tree.allGenerations') + '</option>';
  for (let i = 1; i <= treeDepth; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = t('tree.genLabel', { n: i });
    sel.appendChild(o);
  }
  if (treeGenLimit > treeDepth) treeGenLimit = 0;
  sel.value = String(treeGenLimit);
}

function rebuildTreeFocus() {
  const opts = [{ value: '', label: '🌳 ' + t('tree.viewAll') }];
  members.forEach(m => {
    opts.push({ value: m.id, label: `${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}${relSuffix(m)}` });
  });
  makeSearchableSelect('tf-trigger', 'tf-drop', opts, val => {
    treeFocusId = val || null;
    buildTreeContent();
    applyTransform();
  });
  if (!treeFocusId) {
    const trigger = $('tf-trigger');
    if (trigger) { trigger.innerHTML = '🌳 ' + t('tree.viewAll'); trigger.dataset.value = ''; }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PAN & ZOOM
   ═══════════════════════════════════════════════════════════════ */
function applyTransform(noAnim = false) {
  const canvas = $('tree-canvas');
  if (!canvas) return;
  if (noAnim) canvas.style.transition = 'none';
  canvas.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
  if (noAnim) requestAnimationFrame(() => { canvas.style.transition = ''; });
  const zs = $('tree-zoom');
  const zp = $('tree-zoom-pct');
  if (zs) zs.value = Math.round(scale * 100);
  if (zp) zp.textContent = Math.round(scale * 100) + '%';
  drawMinimapViewport();
}

function fitTreeToView(noAnim = false) {
  const wrap = $('tree-wrap');
  const canvas = $('tree-canvas');
  if (!wrap || !canvas) return;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  const fw = canvas.scrollWidth, fh = canvas.scrollHeight;
  if (cw < 10 || ch < 10 || fw < 10 || fh < 10) return;
  scale = Math.max(0.4, Math.min(cw / fw, ch / fh) * 0.85);
  pan.x = (cw - fw * scale) / 2;
  pan.y = (ch - fh * scale) / 2;
  applyTransform(noAnim);
}

function setupTreePanZoom() {
  const wrap = $('tree-wrap');
  if (!wrap) return;

  if (!window.__treeResizeBound) {
    window.__treeResizeBound = true;
    let rzTimer = null;
    window.addEventListener('resize', () => {
      if (currentTab !== 'tree') return;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => fitTreeToView(true), 150);
    });
  }

  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    panStart = { ...pan };
    e.preventDefault();
  });

  wrap.addEventListener('wheel', e => {
    if (currentTab !== 'tree') return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const oldScale = scale;
    scale = Math.max(0.15, Math.min(5, scale * (e.deltaY > 0 ? 0.88 : 1.12)));
    const k = scale / oldScale;
    pan.x = mx - (mx - pan.x) * k;
    pan.y = my - (my - pan.y) * k;
    applyTransform();
  }, { passive: false });

  setupMinimapNav();

  // Touch support
  let lastTouchDist = 0;
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true;
      dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStart = { ...pan };
    } else if (e.touches.length === 2) {
      dragging = false;
      lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && dragging) {
      pan.x = panStart.x + (e.touches[0].clientX - dragStart.x);
      pan.y = panStart.y + (e.touches[0].clientY - dragStart.y);
      applyTransform();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (lastTouchDist > 0) {
        scale = Math.max(0.15, Math.min(5, scale * (dist / lastTouchDist)));
        applyTransform();
      }
      lastTouchDist = dist;
    }
  }, { passive: true });

  wrap.addEventListener('touchend', () => { dragging = false; lastTouchDist = 0; });
}

/* ═══════════════════════════════════════════════════════════════
   TRASH VIEW
   ═══════════════════════════════════════════════════════════════ */
async function renderTrash() {
  const con = $('view-trash');
  con.innerHTML = '<div class="loading"><div class="spinner"></div>' + t('trash.loading') + '</div>';
  try {
    const data = await api('/api/members?trash=1');
    if (!data.members.length) {
      con.innerHTML = `<div class="trash-empty"><div style="font-size:60px;margin-bottom:16px">🗑️</div><div style="font-size:18px">${t('trash.empty')}</div></div>`;
      return;
    }
    con.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:18px;font-weight:800">🗑️ ${t('trash.title')} (${data.members.length})</h2>
        <button class="sidebar-btn sidebar-btn-red" id="btn-empty-trash">🗑️ ${t('trash.emptyTrash')}</button>
      </div>
      <div class="trash-list">
        ${data.members.map(m => `
          <div class="trash-item">
            <span style="font-size:20px">${m.gender === 'female' ? '👩' : '👨'}</span>
            <span class="trash-item-name">${esc(dispName(m))}</span>
            <span class="trash-item-rel">${esc(dispRel(m)) || ''}</span>
            <button class="sidebar-btn sidebar-btn-green" data-restore="${m.id}" style="font-size:11px;padding:4px 10px">↩ ${t('trash.restore')}</button>
            <button class="sidebar-btn sidebar-btn-red" data-hard-delete="${m.id}" style="font-size:11px;padding:4px 10px">✕ ${t('trash.deleteForever')}</button>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    con.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div>${t('dashboard.loadError')}</div></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS VIEW
   ═══════════════════════════════════════════════════════════════ */
const APP_VERSION = 'v2.6';      // build/engine version (bump with the monthly build)
const APP_RELEASE = 'v1.0.0';    // public release version (must match the GitHub release tag)
const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=CFANQH892RPH2';
const SPONSOR_URL = 'https://github.com/sponsors/DigiSphereX';
const REPO_URL = 'https://github.com/DigiSphereX/kinelora-family-intelligence';
function renderSettings() {
  let famName = '';
  api('/api/family/info').then(info => {
    if (info && info.name) {
      famName = info.name;
      FAMILY.name = info.name;
      FAMILY.birthCountry = info.birthCountry || '';
      const dec = decodeRegion(info.birthRegion || '');
      FAMILY.birthRegion = dec.region;
      const inp = $('s-family-name');
      if (inp) inp.value = famName;
      const cnt = $('s-family-count');
      if (cnt) cnt.textContent = t('common.memberCount', {count: info.memberCount});
      initFamilySettings();
    }
  }).catch(() => {});

  const con = $('view-settings');
  con.innerHTML = `
    <div class="settings-container">
      <div class="settings-section">
        <div class="settings-section-title">🏠 ${t('settings.currentFamily')}</div>
        <div class="field"><label>${t('settings.familyName')}</label><input type="text" id="s-family-name" placeholder="${t('settings.familyNamePlaceholder')}"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="sidebar-btn sidebar-btn-gold" id="btn-save-family-name">💾 ${t('settings.saveName')}</button>
          <span style="font-size:12px;color:var(--muted)" id="s-family-count"></span>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">🌐 ${t('settings.language')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.languageDesc')}</p>
        <div class="sel-wrap" style="width:100%">
          <div class="sel-trigger" id="s-language-trigger"><span>${(window.i18n && window.i18n.languages && window.i18n.current ? window.i18n.languages[window.i18n.current()].flag + ' ' + window.i18n.languages[window.i18n.current()].label : '')}</span><span class="caret">▾</span></div>
          <div class="sel-menu" id="s-language-menu"></div>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">📛 ${t('settings.nameFormat')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.nameFormatDesc')}</p>
        <div class="field">
          <select id="s-name-format" class="tbl-select" style="width:100%">
            <option value="single">${t('settings.nameFormatSingle')}</option>
            <option value="binary">${t('settings.nameFormatBinary')}</option>
            <option value="triple">${t('settings.nameFormatTriple')}</option>
          </select>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">🔑 ${t('settings.changePassword')}</div>
        <div class="field"><label>${t('settings.currentPassword')}</label><input type="password" id="s-current-password" placeholder="${t('settings.currentPasswordPlaceholder')}" autocomplete="current-password"></div>
        <div class="field"><label>${t('settings.newPassword')}</label><input type="password" id="s-password" placeholder="${t('settings.newPasswordPlaceholder')}" autocomplete="new-password"></div>
        <button class="sidebar-btn sidebar-btn-gold" id="btn-save-password" style="margin-top:8px">💾 ${t('settings.savePassword')}</button>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">🌍 ${t('settings.defaultBirthPlace')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.defaultBirthPlaceDesc')}</p>
        <div class="field"><label data-i18n="memberModal.country">${t('memberModal.country')}</label>
          <div class="sel-wrap" style="width:100%"><div class="sel-trigger" id="df-bc-trigger"><span data-i18n="memberModal.birthPlaceNone">—</span></div><div class="sel-drop" id="df-bc-drop"></div></div>
          <input type="hidden" id="s-default-birth-country" value="">
        </div>
        <div class="field"><label data-i18n="memberModal.region">${t('memberModal.region')}</label>
          <div class="sel-wrap" id="s-br-wrap" style="width:100%"><div class="sel-trigger" id="s-br-trigger"><span data-i18n="memberModal.regionNone">—</span></div><div class="sel-drop" id="s-br-drop"></div></div>
          <input type="text" id="s-default-birth-region-free" class="wide" data-i18n-ph="memberModal.regionFreePh" style="display:none;margin-top:8px">
          <input type="hidden" id="s-default-birth-region" value="">
        </div>
        <button class="sidebar-btn sidebar-btn-gold" id="btn-save-defaults">💾 ${t('settings.saveDefaults')}</button>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">🔗 ${t('settings.share')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.shareDesc')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="sidebar-btn sidebar-btn-gold" id="btn-share-generate">🔗 ${t('settings.shareGenerate')}</button>
          <button class="sidebar-btn sidebar-btn-blue" id="btn-share-copy" style="display:none">📋 ${t('settings.shareCopy')}</button>
          <button class="sidebar-btn sidebar-btn-red" id="btn-share-revoke" style="display:none">🚫 ${t('settings.shareRevoke')}</button>
        </div>
        <div id="settings-share-url" style="display:none;margin-top:10px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:10px;word-break:break-all;font-size:13px;color:var(--gold);direction:ltr"></div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">📱 ${t('settings.networkAccess')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.networkDesc')}</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div id="settings-net-url" style="flex:auto;min-width:180px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;color:var(--gold);direction:ltr;word-break:break-all">${t('settings.networkLoading')}</div>
          <button class="sidebar-btn sidebar-btn-blue" id="btn-net-copy">📋 ${t('settings.shareCopy')}</button>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">💾 ${t('settings.importExport')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="sidebar-btn sidebar-btn-green" id="btn-s-export-csv">⬇️ ${t('settings.exportCsv')}</button>
          <button class="sidebar-btn sidebar-btn-blue" id="btn-s-import-csv">⬆️ ${t('settings.importCsv')}</button>
          <button class="sidebar-btn sidebar-btn-ghost" id="btn-s-export-cal">📅 ${t('settings.exportCal')}</button>
          <button class="sidebar-btn sidebar-btn-ghost" id="btn-s-backup-table">💾 ${t('settings.backup')}</button>
        </div>
        <input type="file" id="csv-inp-s" accept=".csv" style="display:none">
      </div>
      <div class="settings-section">
        <div class="settings-section-title">☕ ${t('settings.support')}</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">${t('settings.supportDesc')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="sidebar-btn sidebar-btn-gold" href="${DONATE_URL}" target="_blank" rel="noopener">💛 ${t('settings.donatePaypal')}</a>
          <a class="sidebar-btn sidebar-btn-blue" href="${SPONSOR_URL}" target="_blank" rel="noopener">☕ ${t('settings.sponsorGithub')}</a>
          <button class="sidebar-btn sidebar-btn-ghost" id="btn-copy-donate">📋 ${t('settings.copyDonateLink')}</button>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">ℹ️ ${t('settings.info')}</div>
        <p style="color:var(--muted);font-size:13px">${t('settings.aboutText')}</p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
<!-- Release badge: APP_RELEASE matches the GitHub release tag; bump APP_VERSION with the monthly build -->
          <span style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,var(--gold),#a9852f);color:#1d1506;font-weight:900;font-size:12.5px;padding:5px 14px;border-radius:20px;direction:ltr;font-family:Consolas,Menlo,monospace;letter-spacing:.4px;box-shadow:0 3px 12px rgba(0,0,0,.38);white-space:nowrap">📦 ${APP_RELEASE}</span>
          <span style="color:var(--dim);font-size:12px;direction:ltr">build ${APP_VERSION}</span>
          <span style="color:var(--dim);font-size:12px">${t('settings.memberCount')} ${members.length}</span>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:grid;gap:7px;font-size:13px;color:var(--muted)">
          <div>🛠️ <span style="color:var(--text);font-weight:600">${t('settings.developerName')}</span></div>
          <div>📄 ${t('settings.licenseName')}</div>
          <div>🔗 <a class="settings-link" href="${REPO_URL}" target="_blank" rel="noopener">github.com/DigiSphereX/kinelora-family-intelligence</a></div>
        </div>
      </div>
    </div>`;
  const nf = $('s-name-format');
  if (nf) {
    nf.value = localStorage.getItem('kielora_name_format') || 'triple';
    nf.addEventListener('change', () => {
      localStorage.setItem('kielora_name_format', nf.value);
      showToast(t('settings.nameFormatSaved'));
      renderCurrentView();
    });
  }

  const langTrig = $('s-language-trigger');
  const langMenu = $('s-language-menu');
  if (langTrig && langMenu && window.i18n && window.i18n.languages) {
    const langs = Object.keys(window.i18n.languages).filter(c => window.i18n.languages[c].active);
    langMenu.innerHTML = langs.map(c => {
      const l = window.i18n.languages[c];
      const cur = window.i18n.current && window.i18n.current() === c;
      return '<div class="sel-opt" data-lang="' + c + '"' + (cur ? ' style="background:var(--gold);color:#1d1506"' : '') + '>' + l.flag + ' ' + esc(l.label) + '</div>';
    }).join('');
    langMenu.querySelectorAll('.sel-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const code = opt.dataset.lang;
        localStorage.setItem('kielora_lang', code);
        if (window.i18n.switchLang) {
          window.i18n.switchLang(code);
          setTimeout(() => { renderCurrentView(); }, 50);
        }
      });
    });
    langTrig.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = langMenu.classList.contains('show');
      document.querySelectorAll('.sel-menu.show').forEach(m => m.classList.remove('show'));
      if (!open) langMenu.classList.add('show');
    });
  }

}

/* ═══════════════════════════════════════════════════════════════
   ADD / EDIT MEMBER MODAL
   ═══════════════════════════════════════════════════════════════ */
function openAddModal(context = {}) {
  editingId = null;
  $('modal-title').textContent = '🌱 ' + t('memberModal.title.add');
  ['f-name', 'f-date', 'f-death-date', 'f-phone', 'f-email', 'f-national', 'f-occupation', 'f-education', 'f-location', 'f-anniversary', 'f-notes'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  $('f-age-years').value = '';
  $('f-age-months').value = '';
  $('f-age-days').value = '';
  $('f-relation').value = context.relation || '';
  $('f-gender').value = context.gender || 'male';
  $('f-blood').value = '';
  $('f-notify').checked = false;
  clearPhoto();
  $('f-age-mode').checked = false;
  toggleAgeMode();
  setUnknownBirth(!!context.unknownBirth);
  pendingAddLink = context.pendingLink || null;
  const ctxParent = context.parentId ? members.find(x => String(x.id) === String(context.parentId)) : null;
  if (ctxParent && ctxParent.gender === 'female') {
    updateParentSel('', null, context.parentExcl || null);
    updateMotherSel(String(ctxParent.id), context.parentExcl || null);
  } else {
    updateParentSel(context.parentId || '', null, context.parentExcl || null);
    updateMotherSel('', context.parentExcl || null);
  }
  updateSpouseAndChildrenSel(null, [], context.spouseExcl || null);
  initBirthPlace(context);
  const lp = $('f-live-preview');
  if (lp) lp.style.display = 'none';
  if (context.name) $('f-name').value = context.name;
  $('modal-overlay').classList.add('show');
  setTimeout(() => $('f-name').focus(), 300);
}

function startEdit(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  editingId = id;
  const editUnk = isBirthUnknown(m);
  $('modal-title').textContent = '✏️ ' + t('memberModal.title.edit');
  $('f-name').value = m.name;
  $('f-date').value = editUnk ? '' : (m.birthDate || '');
  $('f-death-date').value = m.deathDate || '';
  $('f-age-years').value = '';
  $('f-age-months').value = '';
  $('f-age-days').value = '';
  $('f-relation').value = m.relation || '';
  $('f-gender').value = m.gender || 'male';
  $('f-blood').value = m.bloodType || '';
  $('f-phone').value = m.phone || '';
  $('f-email').value = m.email || '';
  $('f-national').value = m.nationalId || '';
  $('f-occupation').value = m.occupation || '';
  $('f-education').value = m.education || '';
  $('f-location').value = m.location || '';
  $('f-anniversary').value = m.anniversaryDate || '';
  $('f-photo-path').value = m.photoPath || '';
  if (m.photoPath) {
    $('f-photo-preview').innerHTML = `<img src="${esc(m.photoPath)}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    $('f-photo-preview').innerHTML = '👤';
  }
  $('f-notes').value = sibStripNotes(m.notes || '');
  $('f-notify').checked = m.notifyBirthday || false;
  $('f-age-mode').checked = false;
  toggleAgeMode();
  setUnknownBirth(editUnk);
  const childIds = members.filter(c => c.parentId === m.id).map(c => c.id);
  prevChildIds = childIds.slice();
  const stParent = m.parentId ? members.find(x => String(x.id) === String(m.parentId)) : null;
  if (stParent && stParent.gender === 'female') {
    updateParentSel('', m.id);
    updateMotherSel(String(stParent.id), m.id);
  } else {
    updateParentSel(m.parentId || '', m.id);
    loadMotherSel(m.id, m.id);
  }
  updateSpouseAndChildrenSel(m.spouseId, childIds, m.id);
  initBirthPlace(m);
  $('modal-overlay').classList.add('show');
  // Remove any node popup
  removeNodePopup();
}

function closeModal() {
  $('modal-overlay').classList.remove('show');
  editingId = null;
  pendingAddLink = null;
  prevChildIds = [];
}

function toggleAgeMode() {
  const enabled = $('f-age-mode').checked;
  const unk = $('f-date-unknown') && $('f-date-unknown').checked;
  const dateWrap = $('f-date').parentElement;
  if (unk) {
    dateWrap.style.display = 'none';
    $('f-age-fields').style.display = 'none';
  } else {
    dateWrap.style.display = enabled ? 'none' : 'block';
    $('f-age-fields').style.display = enabled ? 'flex' : 'none';
  }
  $('f-age-toggle').style.transform = enabled ? 'translateX(18px)' : 'translateX(0)';
  $('f-age-toggle').style.background = enabled ? 'var(--gold)' : 'var(--muted)';
  const hint = $('f-date-unknown-hint');
  if (hint) hint.style.display = unk ? '' : 'none';
}

function setUnknownBirth(unk) {
  const cb = $('f-date-unknown');
  if (!cb) return;
  cb.checked = !!unk;
  toggleAgeMode();
}

function calcAgeDate() {
  const y = parseInt($('f-age-years').value) || 0;
  const m = parseInt($('f-age-months').value) || 0;
  const d = parseInt($('f-age-days').value) || 0;
  if (!y && !m && !d) return '';
  const now = new Date();
  now.setFullYear(now.getFullYear() - y);
  now.setMonth(now.getMonth() - m);
  now.setDate(now.getDate() - d);
  return now.toISOString().slice(0, 10);
}

async function updateLivePreview() {
  const box = $('f-live-preview');
  if (!box) return;
  if (box._t) clearTimeout(box._t);
  box._t = setTimeout(async () => {
    let date = $('f-date').value;
    if ($('f-date-unknown') && $('f-date-unknown').checked) { box.style.display = 'none'; return; }
    if ($('f-age-mode').checked) date = calcAgeDate();
    if (!date) { box.style.display = 'none'; return; }
    const res = await api('/api/age/validate', { method: 'POST', body: JSON.stringify({ birthDate: date }) });
    if (!res || !res.valid) { box.style.display = 'none'; return; }
    const a = res.age;
    const z = res.zodiac || {};
    box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="z-dot" style="background:${z.color};width:34px;height:34px">${z.sym || '⭐'}</span>
      <span><b>${esc(a.inWords)}</b><br><span style="color:var(--muted)">${esc(z.name || '')} • ${esc(z.element || '')}</span></span>
      <span style="margin-right:auto;color:var(--muted)">🌙 ${res.hijriBirthDate || '—'} • ${t('dashboard.eventBirthday')} ${t('dashboard.eventIn')} ${a.nextBirthdayDays} ${t('table.daysUntil')}</span>
    </div>`;
    box.style.display = 'block';
  }, 350);
}

function updateParentSel(sel = '', excl = null, addExcl = null) {
  const opts = [{ value: '', label: '— ' + t('memberModal.rootOption') + ' —' }];
  members.filter(m => m.id !== (excl || addExcl) && m.gender === 'male').forEach(m => {
    opts.push({ value: m.id, label: `${esc(dispName(m))}${relSuffix(m)}` });
  });
  makeSearchableSelect('fp-trigger', 'fp-drop', opts, val => {
    $('f-parent').value = val || '';
  });
  const trigger = $('fp-trigger');
  if (sel) {
    const m = members.find(x => x.id === sel);
    trigger.innerHTML = m ? esc(dispName(m)) + relSuffix(m) : '— ' + t('memberModal.rootOption') + ' —';
    trigger.dataset.value = sel;
    $('f-parent').value = sel;
  } else {
    trigger.innerHTML = '— ' + t('memberModal.rootOption') + ' —';
    trigger.dataset.value = '';
    $('f-parent').value = '';
  }
}

function updateMotherSel(sel = '', excl = null) {
  const opts = [{ value: '', label: '— ' + t('memberModal.noneOption') + ' —' }];
  members.filter(m => m.id !== excl && m.gender === 'female').forEach(m => {
    opts.push({ value: m.id, label: `${esc(dispName(m))}${relSuffix(m)}` });
  });
  makeSearchableSelect('fm-trigger', 'fm-drop', opts, val => {
    $('f-mother').value = val || '';
  });
  const trigger = $('fm-trigger');
  if (sel) {
    const m = members.find(x => String(x.id) === String(sel));
    trigger.innerHTML = m ? esc(dispName(m)) + relSuffix(m) : '— ' + t('memberModal.noneOption') + ' —';
    trigger.dataset.value = sel;
    $('f-mother').value = sel;
  } else {
    trigger.innerHTML = '— ' + t('memberModal.noneOption') + ' —';
    trigger.dataset.value = '';
    $('f-mother').value = '';
  }
}

async function loadMotherSel(memberId, excl) {
  updateMotherSel('', excl);
  if (!memberId) return;
  const d = await api('/api/relationships?member=' + memberId);
  const rows = (d && d.relationships) || [];
  const rel = rows.find(r => String(r.relType) === 'biological_parent');
  if (!rel) return;
  const motherId = String(rel.personAId) === String(memberId) ? rel.personBId : rel.personAId;
  updateMotherSel(motherId, excl);
}

async function syncMotherRel(memberId, motherId) {
  let ok = true;
  if (!memberId) return ok;
  const d = await api('/api/relationships?member=' + memberId);
  const rows = (d && d.relationships) || [];
  const rel = rows.find(r => String(r.relType) === 'biological_parent');
  if (!motherId) {
    if (rel) {
      const r = await api('/api/relationships/' + rel.id, { method: 'DELETE' });
      if (!r) ok = false;
    }
    return ok;
  }
  const payload = { person_a_id: memberId, person_b_id: motherId, rel_type: 'biological_parent', start_date: null, end_date: null, confidence: 'high', notes: '' };
  if (rel) {
    if (String(rel.personAId) === String(memberId) && String(rel.personBId) === String(motherId)) return true;
    const r = await api('/api/relationships/' + rel.id, { method: 'PUT', body: JSON.stringify(payload) });
    if (!r) ok = false;
  } else {
    const r = await api('/api/relationships', { method: 'POST', body: JSON.stringify(payload) });
    if (!r || r.error) ok = false;
  }
  return ok;
}

/* Link a mother to a child so it is reflected instantly in the tree.
   - Keeps the `biological_parent` relationship in sync.
   - If the child has a father without a spouse, attach the mother as his
     wife so the couple renders together with the child underneath.
   - Otherwise the mother becomes the child's direct parent. */
async function linkMotherToChild(childId, motherId) {
  if (!childId || !motherId) return true;
  let ok = await syncMotherRel(childId, motherId);
  try {
    const child = members.find(x => String(x.id) === String(childId)) || await memberByIdFresh(childId);
    if (!child) return ok;
    const mother = await memberByIdFresh(motherId);
    if (!mother) return ok;
    const cur = child.parentId ? (members.find(x => String(x.id) === String(child.parentId)) || null) : null;
    if (cur && cur.gender === 'male' && !cur.spouseId && !mother.spouseId) {
      const fb = memberPutBody(cur); fb.spouseId = mother.id;
      if (!(await api(`/api/members/${cur.id}`, { method: 'PUT', body: JSON.stringify(fb) }))) ok = false;
      const mb = memberPutBody(mother); mb.spouseId = cur.id;
      if (!(await api(`/api/members/${mother.id}`, { method: 'PUT', body: JSON.stringify(mb) }))) ok = false;
    } else {
      const cb = memberPutBody(child); cb.parentId = mother.id;
      if (!(await api(`/api/members/${child.id}`, { method: 'PUT', body: JSON.stringify(cb) }))) ok = false;
    }
  } catch (e) { ok = false; }
  return ok;
}

/* Persist parent links for children chosen through the children picker.
   The embedded server touches child records but may not set parent_id for
   existing members added to a parent, so sync each selected child explicitly. */
async function syncChildrenParents(parentId, childIds, prevChildIds) {
  if (!parentId) return true;
  let ok = true;
  const want = (childIds || []).map(x => String(x));
  const prev = (prevChildIds || []).map(x => String(x));
  const ids = new Set([...want, ...prev]);
  for (const cid of ids) {
    const child = members.find(x => String(x.id) === String(cid));
    if (!child) continue;
    const linked = want.includes(String(child.id));
    const target = linked ? parentId : '';
    if (String(child.parentId || '') === target) continue;
    const cb = memberPutBody(child);
    cb.parentId = target;
    const r = await api(`/api/members/${child.id}`, { method: 'PUT', body: JSON.stringify(cb) });
    if (r && !r.error) { child.parentId = target || ''; }
    else ok = false;
  }
  return ok;
}

function applyMotherLink(memberId, motherId) {
  if (motherId) return linkMotherToChild(memberId, motherId);
  return syncMotherRel(memberId, '');
}

function updateSpouseAndChildrenSel(spouse = '', children = [], excl = null) {
  const opts = [{ value: '', label: '— ' + t('memberModal.noneOption') + ' —' }];
  members.filter(m => m.id !== excl).forEach(m => {
    opts.push({ value: m.id, label: `${esc(dispName(m))}${relSuffix(m)}` });
  });
  makeSearchableSelect('fs-trigger', 'fs-drop', opts, val => {
    $('f-spouse').value = val || '';
  });
  const trigger = $('fs-trigger');
  if (spouse) {
    const m = members.find(x => x.id === spouse);
    trigger.innerHTML = m ? esc(dispName(m)) + relSuffix(m) : '— ' + t('memberModal.noneOption') + ' —';
    trigger.dataset.value = spouse;
    $('f-spouse').value = spouse;
  } else {
    trigger.innerHTML = '— ' + t('memberModal.noneOption') + ' —';
    trigger.dataset.value = '';
    $('f-spouse').value = '';
  }
  const ct = $('fc-trigger');
  ct.dataset.ids = JSON.stringify(children);
  ct.dataset.excl = excl || '';
  updateChildrenTriggerText();
}

function updateChildrenTriggerText() {
  const ct = $('fc-trigger');
  let ids = [];
  try { ids = JSON.parse(ct.dataset.ids || '[]'); } catch (e) {}
  const cnt = ids.length;
  ct.innerHTML = cnt ? '👶 ' + t('memberModal.childrenSelected', {count: cnt}) : t('memberModal.childrenPlaceholder');
}

function openChildrenPopup() {
  const ct = $('fc-trigger');
  const excl = ct.dataset.excl || '';
  let ids = [];
  try { ids = JSON.parse(ct.dataset.ids || '[]'); } catch (e) {}
  const list = $('fc-list');
  const filtered = members.filter(m => m.id !== excl);
  list.innerHTML = filtered.map(m => {
    const checked = ids.includes(m.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s" data-cp-label>
      <input type="checkbox" value="${m.id}" ${checked} style="accent-color:var(--gold);width:16px;height:16px" data-cp-check>
      <span style="font-size:13px;color:var(--text)">${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}</span>
      <span style="font-size:11px;color:var(--muted);margin-right:auto">${esc(dispRel(m)) || ''}</span>
    </label>`;
  }).join('') + `<button type="button" class="lm-btn" id="fc-add-member" style="margin-top:10px;padding:8px 12px;border:1px dashed var(--border);border-radius:8px;width:100%;color:var(--gold)">➕ ${t('common.addMemberShort')}</button>`;
  updateChildrenCount();
  $('fc-search').value = '';
  $('children-overlay').classList.add('show');
  setTimeout(() => $('fc-search').focus(), 200);
}

function updateChildrenCount() {
  const list = $('fc-list');
  const checked = list.querySelectorAll('[data-cp-check]:checked').length;
  $('fc-count').textContent = t('childrenModal.selected', {count: checked});
}

function confirmChildrenPopup() {
  const list = $('fc-list');
  const ids = [...list.querySelectorAll('[data-cp-check]:checked')].map(c => c.value);
  const ct = $('fc-trigger');
  ct.dataset.ids = JSON.stringify(ids);
  updateChildrenTriggerText();
  $('children-overlay').classList.remove('show');
}

function closeChildrenPopup() {
  $('children-overlay').classList.remove('show');
}

async function safeMotherLink(memberId, motherId) {
  try { return await applyMotherLink(memberId, motherId); } catch (e) { return false; }
}

async function apiRetry(url, opts) {
  let res = await api(url, opts);
  if (res === null) {
    await new Promise(r => setTimeout(r, 700));
    res = await api(url, opts);
  }
  return res;
}

function expandAncestors(id) {
  let cur = members.find(m => String(m.id) === String(id));
  const seen = new Set();
  while (cur && cur.parentId && !seen.has(String(cur.parentId))) {
    seen.add(String(cur.parentId));
    treeCollapsed.delete(String(cur.parentId));
    cur = members.find(m => String(m.id) === String(cur.parentId));
  }
}

async function saveMember() {
  const saveBtn = $('btn-modal-save');
  if (saveBtn._saving) return;
  saveBtn._saving = true;
  saveBtn.innerHTML = '⏳ ' + t('memberModal.saving');
  try {
    const name = $('f-name').value.trim();
    const ageMode = $('f-age-mode').checked;
    const unknownBirth = $('f-date-unknown').checked;
    const date = unknownBirth ? BIRTH_UNKNOWN : (ageMode ? calcAgeDate() : $('f-date').value);
    const deathDate = $('f-death-date').value;
    const relation = $('f-relation').value;
    const gender = $('f-gender').value;
    const parentId = $('f-parent').value;
    const motherId = $('f-mother').value;
    const spouseId = $('f-spouse').value;
    let childIds = [];
    try { childIds = JSON.parse($('fc-trigger').dataset.ids || '[]'); } catch (e) {}
    const phone = $('f-phone').value.trim();
    const email = $('f-email').value.trim();
    const nationalId = $('f-national').value.trim();
    const occupation = $('f-occupation').value.trim();
    const education = $('f-education').value.trim();
    const bloodType = $('f-blood').value;
    const location = $('f-location').value.trim();
    const birthCountry = $('f-birthCountry').value.trim();
    const birthRegion = getBirthRegion();
    const birthDetail = $('f-birthDetail').value.trim();
    const anniversary = $('f-anniversary').value;
    const notesRaw = $('f-notes').value.trim();
    let notes = notesRaw;
    if (editingId) {
      const orig = members.find(x => String(x.id) === String(editingId));
      const ord = orig ? sibOrderOf(orig.notes) : null;
      if (ord) notes = sibNotesWith(notesRaw, ord);
    }
    const notifyBirthday = $('f-notify').checked;

    if (!name) { showToast(t('toast.nameRequired'), 'error'); return; }
    if (!unknownBirth) {
      if (!date) { showToast(t('toast.dateRequired'), 'error'); return; }
      if (!(date && /^\d{4}-\d{2}-\d{2}$/.test(date))) { showToast(t('toast.dateFormat'), 'error'); return; }
      if (new Date(date + 'T00:00:00') > new Date()) { showToast(t('toast.futureBirth'), 'error'); return; }
    }
    if (deathDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deathDate)) { showToast(t('toast.dateFormat'), 'error'); return; }
      if (!unknownBirth && new Date(deathDate + 'T00:00:00') < new Date(date + 'T00:00:00')) { showToast(t('toast.deathBeforeBirth'), 'error'); return; }
      if (new Date(deathDate + 'T00:00:00') > new Date()) { showToast(t('toast.futureBirth'), 'error'); return; }
    }

    let photoPath = $('f-photo-path').value || '';
    const hasNewPhoto = !!$('f-photo').files.length;

    let effParentId = parentId || '';
    if (!effParentId) {
      if (editingId) {
        const ex = members.find(x => String(x.id) === String(editingId));
        const exP = ex && ex.parentId ? members.find(x => String(x.id) === String(ex.parentId)) : null;
        if (motherId) {
          effParentId = (exP && exP.gender === 'female' && String(exP.id) === String(motherId)) ? String(exP.id) : motherId;
        } else {
          effParentId = (exP && exP.gender === 'female') ? String(exP.id) : '';
        }
      } else {
        effParentId = motherId || '';
      }
    }

    const body = { name, birthDate: date, deathDate, relation, gender, parentId: effParentId || null, spouseId, childIds, phone, email, nationalId, occupation, education, bloodType, location, birthCountry, birthRegion, birthDetail, anniversaryDate: anniversary, photoPath, notes, notifyBirthday };
    // Guard: never allow creating a parent-cycle (a→b→…→a). A circular parent
    // chain makes the backend family queries hang, leaving the dashboard and
    // tree stuck. Walk the prospective chain and refuse it before saving.
    const wouldCreateCycle = (parentFor, selfId) => {
      const probe = new Set([String(selfId || '')]);
      let cur = parentFor;
      while (cur) {
        if (probe.has(String(cur.id))) return true;
        probe.add(String(cur.id));
        cur = cur.parentId ? memberById(cur.parentId) : null;
      }
      return false;
    };
    if (effParentId && wouldCreateCycle(memberById(effParentId), editingId)) {
      showToast(t('toast.circularParent') || '⚠️ Circular parent link blocked'); return;
    }
    // Choosing a child whose ancestors include the edited member creates the
    // same cycle reversed (child.parentId = member while member is a descendant),
    // so compute the member's prospective ancestor set and refuse those children.
    const ancOfEdit = new Set();
    if (editingId) ancOfEdit.add(String(editingId));
    if (effParentId) {
      let cur = memberById(effParentId);
      while (cur && !ancOfEdit.has(String(cur.id))) {
        ancOfEdit.add(String(cur.id));
        cur = cur.parentId ? memberById(cur.parentId) : null;
      }
    }
    for (const cid of childIds) {
      if (ancOfEdit.has(String(cid))) {
        showToast(t('toast.circularParent') || '⚠️ Circular parent link blocked'); return;
      }
    }
    if (motherId && !effParentId && wouldCreateCycle(memberById(String(motherId)), editingId)) {
      showToast(t('toast.circularParent') || '⚠️ Circular parent link blocked'); return;
    }
    if (editingId) {
      if (hasNewPhoto) {
        photoPath = await uploadPhoto(editingId);
        body.photoPath = photoPath;
      }
      const res = await apiRetry(`/api/members/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!res || res.error) { showToast(res && res.error ? res.error : t('toast.memberSaveFailed'), 'error'); return; }
      const cok = await syncChildrenParents(editingId, childIds, prevChildIds || []);
      if (!cok) showToast(t('toast.motherSaveFailed'), 'error');
      const ok = await safeMotherLink(editingId, motherId);
      if (!ok) showToast(t('toast.motherSaveFailed'), 'error');
      else showToast(t('toast.updated'));
    } else {
      const res = await apiRetry('/api/members', { method: 'POST', body: JSON.stringify(body) });
      if (!res || res.error) { showToast(res && res.error ? res.error : t('toast.memberSaveFailed'), 'error'); return; }
      const newId = res?.member?.id;
      if (newId) {
        const cok = await syncChildrenParents(newId, childIds, []);
        if (!cok) showToast(t('toast.motherSaveFailed'), 'error');
        const ok = await safeMotherLink(newId, motherId);
        if (!ok) showToast(t('toast.motherSaveFailed'), 'error');
      }
      if (newId && pendingAddLink) {
        const L = pendingAddLink; pendingAddLink = null;
        try { await applyPendingLink(newId, L); } catch (e) {}
      }
      if (hasNewPhoto && newId) {
        try {
          const uploaded = await uploadPhoto(newId);
          await api(`/api/members/${newId}`, { method: 'PUT', body: JSON.stringify({ photoPath: uploaded }) });
        } catch (e) {}
      }
      showToast(t('toast.added'));
    }
    closeModal();
    await renderAll();
  } finally {
    saveBtn._saving = false;
    saveBtn.innerHTML = '💾 ' + t('memberModal.save');
  }
}

async function deleteMember(id) {
  if (!(await askConfirm(t('confirm.delete')))) return;
  try {
    await api(`/api/members/${id}`, { method: 'DELETE' });
    showToast(t('toast.deleted'));
    removeNodePopup();
    await renderAll();
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════
   PHOTO UPLOAD
   ═══════════════════════════════════════════════════════════════ */
function previewPhotoHandler(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    $('f-photo-preview').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  $('f-photo').value = '';
  $('f-photo-preview').innerHTML = '👤';
  $('f-photo-path').value = '';
}

async function uploadPhoto(memberId) {
  const file = $('f-photo').files[0];
  if (!file) return '';
  const fd = new FormData();
  fd.append('photo', file);
  fd.append('memberId', memberId);
  fd.append('lang', apiLang());
  try {
    const res = await fetch('/api/upload/photo', { method: 'POST', body: fd });
    const data = await res.json();
    $('f-photo-path').value = data.photoUrl;
    return data.photoUrl;
  } catch (e) { return ''; }
}

/* ═══════════════════════════════════════════════════════════════
   NODE POPUP
   ═══════════════════════════════════════════════════════════════ */
function removeNodePopup() {
  const host = $('node-popup-host');
  if (host) host.innerHTML = '';
}

function openProfile(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  $('profile-title').textContent = '👤 ' + t('profile.title');
  $('profile-body').dataset.profileId = id;
  $('profile-body').dataset.editProfile = id;
  $('profile-overlay').classList.add('show');
  renderProfile(m);
}

function renderProfile(m) {
  const body = $('profile-body');
  const spouse = members.find(x => x.id === m.spouseId);
  const children = sibSortMembers(members.filter(c => c.parentId === m.id || c.parentId === m.spouseId));
  const parent = m.parentId ? members.find(x => x.id === m.parentId) : null;
  const dead = m.isDeceased;
  const photo = m.photoPath ? `<img src="${esc(m.photoPath)}">` : (m.gender === 'female' ? '👩' : '👨');

  // Milestones
  const milestones = m.milestones || [];

  // Zodiac
  const z = zodiacOf(m) || {};
  const pKnown = hasRealBirth(m);

  const sec = (title, inner) =>
    `<div class="profile-sec"><div class="profile-sec-title">${title}</div>${inner}</div>`;

  const rels = [];
  if (parent) rels.push(`<span class="profile-tag">👴 ${t('profile.childOf')} ${esc(parent.name)}</span>`);
  if (spouse) rels.push(`<span class="profile-tag">💍 ${t('profile.spouseOf')} ${esc(spouse.name)}</span>`);
  if (children.length) rels.push(`<span class="profile-tag">👶 ${t('profile.children')} ${children.length} ${children.length > 1 ? `<button class="profile-act" data-sib-order="${m.id}" title="${esc(t('sib.reorder'))}">🔀</button>` : ''}</span>`);
  if (dead) rels.push('<span class="profile-tag dead">⚰️ ' + t('profile.deceased') + '</span>');

  body.innerHTML = `
    <div class="profile-header">
      <div class="profile-photo">${photo}</div>
<button class="profile-photo-edit" id="btn-profile-photo" title="${esc(t('profile.changePhoto'))}">📷</button>
      <div class="profile-basic">
        <div class="pb-name">${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}</div>
        <div class="pb-sub">${esc(dispRel(m)) || t('profile.familyMember')}</div>
        ${birthPlaceText(m) ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">📍 ${birthPlaceText(m)}</div>` : ''}
        <div>${rels.join('')}</div>
      </div>
    </div>

    ${sec('🎂 ' + t('profile.age'), pKnown ? `
      <div class="profile-grid">
        <div class="profile-stat"><div class="ps-num">${m.age && m.age.years}</div><div class="ps-label">${t('profile.year')}</div></div>
        <div class="profile-stat"><div class="ps-num">${m.age && m.age.months}</div><div class="ps-label">${t('profile.month')}</div></div>
        <div class="profile-stat"><div class="ps-num">${m.age && m.age.days}</div><div class="ps-label">${t('profile.day')}</div></div>
        <div class="profile-stat"><div class="ps-num">${m.age ? m.age.inWords : '—'}</div><div class="ps-label">${t('profile.inWords')}</div></div>
        <div class="profile-stat"><div class="ps-num">${m.age ? (m.age.totalDays || 0).toLocaleString() : 0}</div><div class="ps-label">${t('profile.daysApprox')}</div></div>
        <div class="profile-stat"><div class="ps-num">${m.daysUntilBirthday}</div><div class="ps-label">${t('profile.daysToBirthday')}</div></div>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">📅 ${t('profile.nextBirthday')} <b style="color:var(--green)">${m.nextBirthday && m.nextBirthday.date ? m.nextBirthday.date : '—'}</b> ${t('profile.nextBirthdaySuffix')} ${m.nextAge || 0} ${t('profile.year')}</div>
    ` : `<div style="font-size:12px;color:var(--muted)">${t('profile.noBirthDate')}</div>`)}

    ${sec('🔮 ' + t('profile.zodiac'), pKnown ? `
      <div style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px">
        <div class="z-dot" style="background:${z.color};width:44px;height:44px;font-size:22px">${z.sym || ''}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px">${z.name || '—'}</div>
          <div style="font-size:12px;color:var(--muted)">${t('profile.element')} ${z.element || '—'} • ${z.dates || ''}</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${(z.traits || []).map(ztr => `<span class="trait-pill">${ztr}</span>`).join('')}</div>
    ` : `<div style="font-size:12px;color:var(--muted)">${t('profile.noBirthDate')}</div>`)}

    ${sec('🌙 ' + t('profile.hijri'), pKnown && m.hijri && (m.hijri.birthDate || m.hijri.ageYears != null) ? `
      <div class="profile-grid">
        <div class="profile-stat"><div class="ps-num" style="font-size:15px">${m.hijri.birthDate || '—'}</div><div class="ps-label">${t('profile.hijriBirth')}</div></div>
        <div class="profile-stat"><div class="ps-num" style="font-size:15px">${m.hijri.ageYears != null ? m.hijri.ageYears + ' ' + t('profile.year') : '—'}</div><div class="ps-label">${t('profile.hijriAge')}</div></div>
        <div class="profile-stat"><div class="ps-num" style="font-size:15px">${m.hijri.currentDate || '—'}</div><div class="ps-label">${t('profile.hijriToday')}</div></div>
      </div>` : '<div style="font-size:12px;color:var(--muted)">' + t('profile.noHijri') + '</div>')}

    ${sec('💼 ' + t('profile.personalInfo'), `
      <div class="profile-info-grid">
${m.nationalId ? `<div class="profile-info-item"><b>${t('profile.nationalId')}</b><span>${esc(m.nationalId)}</span></div>` : ''}
      ${m.occupation ? `<div class="profile-info-item"><b>${t('profile.occupation')}</b><span>${esc(m.occupation)}</span></div>` : ''}
      ${m.education ? `<div class="profile-info-item"><b>${t('profile.education')}</b><span>${esc(m.education)}</span></div>` : ''}
      ${m.bloodType ? `<div class="profile-info-item"><b>${t('profile.bloodType')}</b><span>${esc(m.bloodType)}</span></div>` : ''}
      ${m.location ? `<div class="profile-info-item"><b>${t('profile.location')}</b><span>${esc(m.location)}</span></div>` : ''}
        ${birthPlaceText(m) ? `<div class="profile-info-item"><b>${t('profile.birthPlace')}</b><span>${birthPlaceText(m)}</span></div>` : ''}
        ${m.phone ? `<div class="profile-info-item"><b>${t('profile.phone')}</b><span>${esc(m.phone)}</span></div>` : ''}
        ${m.email ? `<div class="profile-info-item"><b>${t('profile.email')}</b><span>${esc(m.email)}</span></div>` : ''}
        ${m.anniversaryDate ? `<div class="profile-info-item"><b>${t('profile.anniversary')}</b><span>${m.anniversaryDate}</span></div>` : ''}
        ${!m.nationalId && !m.occupation && !m.education && !m.bloodType && !m.location && !birthPlaceText(m) && !m.phone && !m.email && !m.anniversaryDate ? '<div style="font-size:12px;color:var(--muted)">' + t('profile.noPersonalInfo') + '</div>' : ''}
      </div>`)}
  `;

  // Life stages section (build separately to keep readable)
  if (pKnown && milestones.length) {
    const h = document.createElement('div');
    h.className = 'profile-sec';
    h.innerHTML = '<div class="profile-sec-title">🎯 ' + t('profile.lifeStages') + '</div>' +
      '<div class="profile-ms-wrap">' +
      milestones.map(ms => `
        <div class="profile-ms ${ms.isPassed ? 'passed' : ''}">
          <span>${ms.isPassed ? '✅' : '🎯'}</span>
          <span class="ms-name">${ms.name}</span>
          <span class="ms-age">${ms.age} ${t('profile.year')}</span>
          <span class="ms-date">${ms.isPassed ? (ms.dateReached ? t('profile.stageOn') + ' ' + formatDateArabic(ms.dateReached) : t('milestones.passedOn')) : t('milestones.upcoming') + ' ' + ms.daysUntil + ' ' + t('table.daysUntil')}</span>
        </div>`).join('') + '</div>';
    body.appendChild(h);
  }
  loadProfileMedia(m.id);
}

function loadProfileMedia(memberId) {
  api('/api/evidence/media?member_id=' + encodeURIComponent(memberId)).then(res => {
    const media = (res && res.media) || [];
    if (!media.length) return;
    const body = $('profile-body');
    if (!body || body.dataset.profileId !== memberId) return;
    const K = [
      ['image', '🖼️', 'photo.docImages'],
      ['pdf', '📄', 'photo.docDocs'],
      ['audio', '🎵', 'photo.docAudio'],
      ['video', '🎬', 'photo.docVideo'],
      ['document', '🗂', 'photo.docOther']
    ];
    let html = '<div class="profile-sec"><div class="profile-sec-title">🗂️ ' + t('photo.documents') + ' <span style="font-size:11px;color:var(--muted)">(' + media.length + ')</span></div>';
    K.forEach(([k, ic, key]) => {
      const items = media.filter(x => x.kind === k);
      if (!items.length) return;
      html += '<div class="profile-sub-title">' + ic + ' ' + t(key) + ' (' + items.length + ')</div>' +
        '<div class="ev-media-grid">' + items.map(m => `
          <div class="ev-media-item">
            ${m.kind === 'image' ? '<img src="' + esc(m.filePath) + '" alt="">'
              : '<div style="display:flex;align-items:center;justify-content:center;height:64px;font-size:24px">' + ic + '</div>'}
            <div class="ev-media-cap">${esc(m.title || '')}</div>
          </div>`).join('') + '</div>';
    });
    html += '</div>';
    const holder = document.createElement('div');
    holder.innerHTML = html;
    body.appendChild(holder.firstChild);
  }).catch(() => {});
}

let photoCrop = null;
let cropSession = { targetId: '', mode: 'profile' };

function openPhotoCrop(targetId, mode) {
  cropSession.targetId = targetId || '';
  cropSession.mode = mode || 'profile';
  $('photo-crop-hint').textContent = t('photo.cropHint');
  $('photo-crop-formats').textContent = t('photo.allowedFormats');
  const stage = $('photo-crop-stage');
  if (stage) stage.innerHTML = '';
  const pv = $('pc-preview');
  if (pv) pv.getContext('2d').clearRect(0, 0, pv.width, pv.height);
  const z = $('pc-zoom');
  if (z) z.value = 100;
  const zv = $('pc-zoom-val');
  if (zv) zv.textContent = '100%';
  document.querySelectorAll('#pc-aspect .pc-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.ar === '1:1'));
  $('photo-crop-overlay').classList.add('show');
  pickCropFile();
}

function pickCropFile() {
  const old = $('photo-crop-file');
  if (old) old.parentNode.removeChild(old);
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.id = 'photo-crop-file';
  inp.accept = '.jpg,.jpeg,.png,.gif,.webp';
  inp.style.display = 'none';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (f) loadCropImage(f);
  });
  $('photo-crop-stage').closest('.modal').appendChild(inp);
  inp.click();
}

function loadCropImage(file) {
  if (!file) return;
  const okTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (okTypes.indexOf(file.type) === -1) { closePhotoCrop(); showToast('❌ ' + t('photo.badFormat')); return; }
  if (file.size > 8 * 1024 * 1024) { closePhotoCrop(); showToast('❌ ' + t('photo.bigFile')); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const stage = $('photo-crop-stage');
    if (!stage) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'photo-crop-canvas';
    const bw = stage.clientWidth || stage.offsetWidth || 480;
    canvas.width = bw;
    canvas.height = bw;
    stage.innerHTML = '';
    stage.appendChild(canvas);
    photoCrop = {
      targetId: cropSession.targetId, mode: cropSession.mode, imgSrc: img,
      rot: 0, flip: 1, zoomVal: 1, aspect: '1:1',
      canvas, ctx: canvas.getContext('2d'),
      drag: null
    };
    rebuildCropBuffer();
    $('pc-zoom').value = 100;
    $('pc-zoom-val').textContent = '100%';
    setAspectUI('1:1');
    setupCropPointer(canvas);
    setupCropWheel(canvas);
    drawCrop();
  };
  img.onerror = () => { URL.revokeObjectURL(url); closePhotoCrop(); showToast('❌ ' + t('photo.badFile')); };
  img.src = url;
}

function aspectRatio(a) {
  if (a === 'free') return null;
  const p = a.split(':');
  return { w: +p[0], h: +p[1] };
}

function setAspectUI(a) {
  const c = photoCrop;
  if (!c) return;
  c.aspect = a;
  document.querySelectorAll('#pc-aspect .pc-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.ar === a));
  applyAspectToSel();
  drawCrop();
}

function applyAspectToSel() {
  const c = photoCrop;
  if (!c) return;
  const ar = aspectRatio(c.aspect);
  if (!ar) return;
  const cw = c.canvas.width, ch = c.canvas.height;
  let w = Math.max(40, Math.min(cw * 0.92, c.sel.w || cw * 0.92));
  let h = Math.max(40, Math.min(ch * 0.92, c.sel.h || ch * 0.92));
  const a = ar.w / ar.h;
  if (w / h > a) h = w / a; else w = h * a;
  w = Math.min(cw, w); h = Math.min(ch, h);
  c.sel.w = w; c.sel.h = h;
  c.sel.x = Math.max(0, Math.min(cw - w, c.sel.x));
  c.sel.y = Math.max(0, Math.min(ch - h, c.sel.y));
}

function rebuildCropBuffer() {
  const c = photoCrop;
  const src = c.imgSrc;
  const w = src.naturalWidth, h = src.naturalHeight;
  const rot = c.rot % 360;
  const swap = rot === 90 || rot === 270;
  const b = document.createElement('canvas');
  b.width = swap ? h : w;
  b.height = swap ? w : h;
  const bx = b.getContext('2d');
  bx.translate(b.width / 2, b.height / 2);
  bx.rotate(rot * Math.PI / 180);
  bx.scale(c.flip, 1);
  bx.drawImage(src, -w / 2, -h / 2, w, h);
  c.buffer = b; c.bW = b.width; c.bH = b.height;
  const cw = c.canvas.width, ch = c.canvas.height;
  c.fit = Math.max(cw / b.width, ch / b.height);
  c.disp = c.fit * c.zoomVal;
  c.ox = (cw - b.width * c.disp) / 2;
  c.oy = (ch - b.height * c.disp) / 2;
  if (!c.sel) {
    const side = Math.max(80, Math.min(cw, ch) * 0.62);
    c.sel = { x: (cw - side) / 2, y: (ch - side) / 2, w: side, h: side };
  }
}

function clampOffsets() {
  const c = photoCrop;
  if (!c) return;
  const cw = c.canvas.width, ch = c.canvas.height;
  const bw = c.bW * c.disp, bh = c.bH * c.disp;
  c.ox = Math.max(Math.min(0, cw - bw), Math.min(c.ox, Math.max(0, (cw - bw) / 2)));
  c.oy = Math.max(Math.min(0, ch - bh), Math.min(c.oy, Math.max(0, (ch - bh) / 2)));
}

function rotateCrop(deg) {
  const c = photoCrop;
  if (!c) return;
  c.rot = (c.rot + deg + 360) % 360;
  c.flip = 1;
  rebuildCropBuffer();
  drawCrop();
}

function flipCrop() {
  const c = photoCrop;
  if (!c) return;
  c.flip *= -1;
  rebuildCropBuffer();
  drawCrop();
}

function resetCrop() {
  const c = photoCrop;
  if (!c) return;
  c.rot = 0; c.flip = 1; c.zoomVal = 1; c.sel = null;
  $('pc-zoom').value = 100;
  $('pc-zoom-val').textContent = '100%';
  rebuildCropBuffer();
  drawCrop();
}

function drawCrop() {
  const c = photoCrop;
  if (!c) return;
  const ctx = c.ctx, W = c.canvas.width, H = c.canvas.height;
  c.disp = c.fit * c.zoomVal;
  const disp = c.disp;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(c.buffer, c.ox, c.oy, c.bW * disp, c.bH * disp);
  const X = c.sel.x, Y = c.sel.y, SW = c.sel.w, SH = c.sel.h;
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, 0, W, Y + 1);
  ctx.fillRect(0, Y + SH - 1, W, H - Y - SH + 1);
  ctx.fillRect(0, Y, X, SH);
  ctx.fillRect(X + SW, Y, W - X - SW, SH);
  ctx.strokeStyle = 'rgba(245,197,24,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    ctx.moveTo(X + SW * i / 3, Y); ctx.lineTo(X + SW * i / 3, Y + SH);
    ctx.moveTo(X, Y + SH * i / 3); ctx.lineTo(X + SW, Y + SH * i / 3);
  }
  ctx.stroke();
  ctx.strokeStyle = '#f5c451';
  ctx.lineWidth = 2;
  ctx.strokeRect(X + 1, Y + 1, SW - 2, SH - 2);
  ctx.fillStyle = '#f5c451';
  const hs = 9;
  const pts = [
    [X, Y], [X + SW, Y], [X + SW, Y + SH], [X, Y + SH],
    [X + SW / 2, Y], [X + SW, Y + SH / 2], [X + SW / 2, Y + SH], [X, Y + SH / 2]
  ];
  pts.forEach(([hx, hy]) => {
    if ((hx !== X && hx !== X + SW || hy !== Y && hy !== Y + SH) && (hx === X + SW / 2 || hy === Y + SH / 2)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - hs * 0.45, hy - hs * 0.45, hs * 0.9, hs * 0.9);
      ctx.fillStyle = '#f5c451';
    }
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  });
  updatePreview();
}

function updatePreview() {
  const c = photoCrop;
  if (!c) return;
  const p = $('pc-preview');
  if (!p) return;
  const pctx = p.getContext('2d');
  const disp = c.disp;
  const bcx = (c.sel.x + c.sel.w / 2 - c.ox) / disp;
  const bcy = (c.sel.y + c.sel.h / 2 - c.oy) / disp;
  const bw = c.sel.w / disp, bh = c.sel.h / disp;
  const ratio = bw / bh;
  let pw, ph, oxx, oyy;
  if (ratio >= 1) { pw = 92; ph = 92 / ratio; } else { ph = 92; pw = 92 * ratio; }
  oxx = (96 - pw) / 2; oyy = (96 - ph) / 2;
  pctx.clearRect(0, 0, 96, 96);
  pctx.save();
  pctx.beginPath();
  pctx.arc(48, 48, 47, 0, Math.PI * 2);
  pctx.clip();
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(c.buffer, bcx - bw / 2, bcy - bh / 2, bw, bh, oxx, oyy, pw, ph);
  pctx.restore();
}

function setupCropPointer(canvas) {
  canvas.addEventListener('pointerdown', e => {
    const c = photoCrop;
    if (!c) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const { x, y, w, h } = c.sel;
    const R = 24;
    const corners = [
      { m: 'nw', x, y }, { m: 'ne', x: x + w, y },
      { m: 'se', x: x + w, y: y + h }, { m: 'sw', x, y: y + h }
    ];
    const mids = [
      { m: 'n', x: x + w / 2, y }, { m: 'e', x: x + w, y: y + h / 2 },
      { m: 's', x: x + w / 2, y: y + h }, { m: 'w', x, y: y + h / 2 }
    ];
    let hh = corners.find(hd => Math.hypot(px - hd.x, py - hd.y) <= R);
    if (hh) c.drag = { mode: 'corner', m: hh.m, ax: hh.x, ay: hh.y };
    else {
      hh = mids.find(hd => Math.hypot(px - hd.x, py - hd.y) <= R);
      if (hh) c.drag = { mode: 'edge', m: hh.m, cur: { x, y, w, h } };
      else if (px >= x && px <= x + w && py >= y && py <= y + h) c.drag = { mode: 'move', px, py, ox: x, oy: y };
      else c.drag = { mode: 'new', px, py, x0: px, y0: py };
    }
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    const c = photoCrop;
    if (!c || !c.drag) return;
    const rect = canvas.getBoundingClientRect();
    const cw = c.canvas.width, ch = c.canvas.height;
    const px = Math.max(0, Math.min(cw, e.clientX - rect.left));
    const py = Math.max(0, Math.min(ch, e.clientY - rect.top));
    const d = c.drag, ar = aspectRatio(c.aspect);
    if (d.mode === 'move') {
      let nx = d.ox + (px - d.px), ny = d.oy + (py - d.py);
      nx = Math.max(0, Math.min(cw - c.sel.w, nx));
      ny = Math.max(0, Math.min(ch - c.sel.h, ny));
      c.sel.x = nx; c.sel.y = ny;
    } else if (d.mode === 'new') {
      let w = Math.abs(px - d.x0), hh2 = Math.abs(py - d.y0);
      if (ar) { const a = ar.w / ar.h; if (w / hh2 > a) hh2 = w / a; else w = hh2 * a; }
      w = Math.max(40, Math.min(cw, w)); hh2 = Math.max(40, Math.min(ch, hh2));
      const nx = px < d.x0 ? d.x0 - w : d.x0;
      const ny = py < d.y0 ? d.y0 - hh2 : d.y0;
      c.sel.w = w; c.sel.h = hh2;
      c.sel.x = Math.max(0, Math.min(cw - w, nx));
      c.sel.y = Math.max(0, Math.min(ch - hh2, ny));
    } else if (d.mode === 'corner') {
      let w = Math.abs(px - d.ax), hh2 = Math.abs(py - d.ay);
      if (ar) { const a = ar.w / ar.h; if (w / hh2 > a) hh2 = w / a; else w = hh2 * a; }
      w = Math.max(40, Math.min(cw, w)); hh2 = Math.max(40, Math.min(ch, hh2));
      const nx = px < d.ax ? d.ax - w : d.ax;
      const ny = py < d.ay ? d.ay - hh2 : d.ay;
      c.sel.w = w; c.sel.h = hh2;
      c.sel.x = Math.max(0, Math.min(cw - w, nx));
      c.sel.y = Math.max(0, Math.min(ch - hh2, ny));
    } else if (d.mode === 'edge') {
      const { x, y, w, h } = d.cur;
      if (ar) {
        const a = ar.w / ar.h;
        if (d.m === 'e' || d.m === 'w') {
          const x2 = x + w, cy = y + h / 2;
          let nw = Mabs(d.m === 'e' ? px - x : x2 - px);
          nw = Math.max(40, Math.min(cw, nw));
          const nh = nw / a;
          let nx = d.m === 'e' ? x : x2 - nw;
          nx = Math.max(0, Math.min(cw - nw, nx));
          let ny = cy - nh / 2;
          ny = Math.max(0, Math.min(ch - nh, ny));
          c.sel.x = nx; c.sel.y = ny; c.sel.w = nw; c.sel.h = nh;
        } else {
          const y2 = y + h, cx = x + w / 2;
          let nh = Mabs(d.m === 's' ? py - y : y2 - py);
          nh = Math.max(40, Math.min(ch, nh));
          const nw = nh * a;
          let ny = d.m === 's' ? y : y2 - nh;
          ny = Math.max(0, Math.min(ch - nh, ny));
          let nx = cx - nw / 2;
          nx = Math.max(0, Math.min(cw - nw, nx));
          c.sel.x = nx; c.sel.y = ny; c.sel.w = nw; c.sel.h = nh;
        }
      } else {
        if (d.m === 'n') {
          const nh = Math.max(40, (y + h) - py);
          c.sel.y = Math.max(0, Math.min(y + h - 40, py));
          c.sel.h = Math.min(ch, nh);
        } else if (d.m === 's') {
          c.sel.h = Math.max(40, Math.min(ch, py - y));
        } else if (d.m === 'w') {
          const nw = Math.max(40, (x + w) - px);
          c.sel.x = Math.max(0, Math.min(x + w - 40, px));
          c.sel.w = Math.min(cw, nw);
        } else {
          c.sel.w = Math.max(40, Math.min(cw, px - x));
        }
      }
    }
    drawCrop();
  });
  const up = () => { if (photoCrop) photoCrop.drag = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}

function Mabs(v) { return Math.abs(v); }

function setupCropWheel(canvas) {
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const c = photoCrop;
    if (!c) return;
    const rect = canvas.getBoundingClientRect();
    const cw = c.canvas.width, ch = c.canvas.height;
    const px = Math.max(0, Math.min(cw, e.clientX - rect.left));
    const py = Math.max(0, Math.min(ch, e.clientY - rect.top));
    const cx = c.sel.x + c.sel.w / 2, cy = c.sel.y + c.sel.h / 2;
    const bx = (cx - c.ox) / c.disp, by = (cy - c.oy) / c.disp;
    const nz = Math.max(1, Math.min(3, c.zoomVal * (e.deltaY < 0 ? 1.12 : 0.89)));
    c.zoomVal = nz;
    c.disp = c.fit * c.zoomVal;
    c.ox = cx - bx * c.disp;
    c.oy = cy - by * c.disp;
    clampOffsets();
    const pct = Math.round(c.zoomVal * 100);
    const z = $('pc-zoom');
    if (z) z.value = pct;
    const zv = $('pc-zoom-val');
    if (zv) zv.textContent = pct + '%';
    drawCrop();
  }, { passive: false });
}

async function applyCrop() {
  const c = photoCrop;
  if (!c) return;
  const disp = c.disp;
  const bw = c.sel.w / disp, bh = c.sel.h / disp;
  const bcx = (c.sel.x + c.sel.w / 2 - c.ox) / disp;
  const bcy = (c.sel.y + c.sel.h / 2 - c.oy) / disp;
  const sx = Math.max(0, bcx - bw / 2);
  const sy = Math.max(0, bcy - bh / 2);
  const sw = Math.min(c.bW - sx, bw);
  const sh = Math.min(c.bH - sy, bh);
  if (sw < 4 || sh < 4) { showToast('❌ ' + t('photo.badFile')); return; }
  const ratio = sw / sh;
  let outW, outH;
  if (ratio >= 1) { outW = 384; outH = Math.max(2, Math.round(384 / ratio)); }
  else { outH = 384; outW = Math.max(2, Math.round(384 * ratio)); }
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  octx.save();
  octx.beginPath();
  octx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2);
  octx.clip();
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c.buffer, sx, sy, sw, sh, 0, 0, outW, outH);
  octx.restore();
  const blob = await new Promise(r => out.toBlob(r, 'image/png', 0.92));
  if (!blob) { showToast('❌ ' + t('photo.badFile')); return; }
  const fd = new FormData();
  fd.append('photo', blob, 'photo.png');
  fd.append('memberId', cropSession.targetId);
  const res = await fetch('/api/upload/photo?lang=' + apiLang(), { method: 'POST', body: fd });
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) { showToast('❌ ' + ((body && body.error) || t('toast.serverError'))); return; }
  const url = (body && body.photoUrl) || '';
  if (url && cropSession.mode === 'edit') {
    $('f-photo-path').value = url;
    const fp = $('f-photo');
    if (fp) fp.value = '';
    $('f-photo-preview').innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover">`;
    closePhotoCrop();
    showToast('✅ ' + t('photo.saved'));
    return;
  }
  const m = members.find(x => x.id === cropSession.targetId);
  if (m && url) m.photoPath = url;
  closePhotoCrop();
  if (m && url) {
    try {
      await api('/api/members/' + m.id, { method: 'PUT', body: JSON.stringify({ photoPath: url }) });
    } catch (e) {}
  }
  if (m) renderProfile(m);
  if (currentTab === 'tree' || (document.querySelector('#view-tree') && document.querySelector('#view-tree').classList.contains('active'))) {
    buildTreeContent(); applyTransform();
  }
  showToast('✅ ' + t('photo.saved'));
}

function closePhotoCrop() {
  $('photo-crop-overlay').classList.remove('show');
  photoCrop = null;
}

(function initCropControls() {
  document.querySelectorAll('#pc-aspect .pc-seg-btn').forEach(b => {
    b.addEventListener('click', () => setAspectUI(b.dataset.ar));
  });
  const z = $('pc-zoom');
  if (z) z.addEventListener('input', () => {
    const c = photoCrop;
    if (!c) return;
    const cw = c.canvas.width, ch = c.canvas.height;
    const cx = c.sel.x + c.sel.w / 2, cy = c.sel.y + c.sel.h / 2;
    const oldDisp = c.disp;
    const bx = (cx - c.ox) / oldDisp, by = (cy - c.oy) / oldDisp;
    c.zoomVal = +z.value / 100;
    c.disp = c.fit * c.zoomVal;
    c.ox = cx - bx * c.disp;
    c.oy = cy - by * c.disp;
    clampOffsets();
    $('pc-zoom-val').textContent = z.value + '%';
    drawCrop();
  });
  if ($('pc-rotate-l')) $('pc-rotate-l').onclick = () => rotateCrop(-90);
  if ($('pc-rotate-r')) $('pc-rotate-r').onclick = () => rotateCrop(90);
  if ($('pc-flip')) $('pc-flip').onclick = flipCrop;
  if ($('pc-reset')) $('pc-reset').onclick = resetCrop;
})();

function closeProfile() {
  $('profile-overlay').classList.remove('show');
}

function showNodePopup(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  removeNodePopup();
  const host = $('node-popup-host');
  const spouse = members.find(x => x.id === m.spouseId);
  const children = members.filter(c => c.parentId === m.id || c.parentId === m.spouseId);
  const pKnown = hasRealBirth(m);
  const pz = zodiacOf(m);

  const popup = document.createElement('div');
  popup.id = 'node-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--s1);border:1px solid var(--border);border-top:3px solid ' + m.zodiac.color + ';border-radius:16px;padding:20px;width:320px;z-index:400;font-family:Tajawal,sans-serif;direction:rtl;color:var(--text);box-shadow:0 20px 60px var(--shadow);max-height:90vh;overflow-y:auto';

  popup.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div><div style="font-size:18px;font-weight:900">${m.gender === 'female' ? '👩' : '👨'} ${esc(dispName(m))}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(dispRel(m)) || '—'}</div></div>
    <button data-close-popup style="background:var(--s2);border:none;color:var(--muted);border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:16px">✕</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
    <div style="background:var(--s2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--gold)">${pKnown ? m.age.years : '—'}</div><div style="font-size:10px;color:var(--muted)">${t('profile.year')}</div></div>
    <div style="background:var(--s2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--gold)">${pKnown ? m.age.months : '—'}</div><div style="font-size:10px;color:var(--muted)">${t('profile.month')}</div></div>
    <div style="background:var(--s2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--gold)">${pKnown ? m.age.days : '—'}</div><div style="font-size:10px;color:var(--muted)">${t('profile.day')}</div></div>
  </div>
  ${pKnown ? '' : `<div style="background:rgba(245,197,24,.08);border:1px dashed rgba(245,197,24,.3);border-radius:10px;padding:8px;margin-bottom:10px;font-size:11px;color:var(--gold);text-align:center">${t('profile.noBirthDate')}</div>`}
  ${spouse ? `<div style="background:var(--s2);border-radius:10px;padding:10px;margin-bottom:10px;border-right:3px solid var(--pink)">
    <div style="font-size:11px;color:var(--muted);margin-bottom:4px">💍 ${t('nodePopup.spouse')}</div>
    <div style="font-size:14px;font-weight:700">${spouse.gender === 'female' ? '👩' : '👨'} ${esc(spouse.name)} <span style="font-size:11px;color:var(--muted);font-weight:400">${dispRel(spouse) ? esc(dispRel(spouse)) : ''}</span></div>
  </div>` : ''}
  ${children.length ? `<div style="background:var(--s2);border-radius:10px;padding:10px;margin-bottom:10px">
    <div style="font-size:11px;color:var(--muted);margin-bottom:4px">👶 ${t('nodePopup.children')} (${children.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${sibSortMembers(children).map(c => `<span style="background:var(--s3);color:var(--muted);padding:2px 8px;border-radius:8px;font-size:11px">${c.gender === 'female' ? '👩' : '👨'} ${esc(c.name)}</span>`).join('')}</div>
  </div>` : ''}
  <div style="display:flex;gap:8px;margin-bottom:12px;font-size:12px;color:var(--muted);flex-wrap:wrap">
    <span>📅 ${pKnown ? m.birthDate : t('common.unknown')}</span>
    ${pz ? `<span>⭐ ${pz.name} ${pz.sym}</span>` : ''}
    ${pKnown ? `<span>🎂 ${t('dashboard.eventIn')} ${m.daysUntilBirthday} ${t('table.daysUntil')}</span>` : ''}
  </div>
  ${sibStripNotes(m.notes) ? `<div style="background:var(--s2);border-radius:8px;padding:8px;margin-bottom:10px;font-size:12px;color:var(--muted)">📝 ${esc(sibStripNotes(m.notes))}</div>` : ''}
  ${pz && (pz.traits || []).length ? `<div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap">${(pz.traits || []).map(zt => `<span style="background:var(--s2);color:var(--muted);padding:3px 10px;border-radius:12px;font-size:11px">${zt}</span>`).join('')}</div>` : ''}
  <div style="margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:700">➕ ${t('nodePopup.addRel')}</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
      <button data-add-rel="${m.id}:son" style="padding:7px 4px;background:var(--s2);color:var(--blue);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.son')}</button>
      <button data-add-rel="${m.id}:daughter" style="padding:7px 4px;background:var(--s2);color:var(--pink);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.daughter')}</button>
      <button data-add-rel="${m.id}:brother" style="padding:7px 4px;background:var(--s2);color:var(--blue);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.brother')}</button>
      <button data-add-rel="${m.id}:sister" style="padding:7px 4px;background:var(--s2);color:var(--pink);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.sister')}</button>
      <button data-add-rel="${m.id}:father" style="padding:7px 4px;background:var(--s2);color:var(--gold);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.father')}</button>
      <button data-add-rel="${m.id}:mother" style="padding:7px 4px;background:var(--s2);color:var(--gold);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.mother')}</button>
      <button data-add-rel="${m.id}:husband" style="padding:7px 4px;background:var(--s2);color:var(--blue);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.husband')}</button>
      <button data-add-rel="${m.id}:wife" style="padding:7px 4px;background:var(--s2);color:var(--pink);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.wife')}</button>
      <button data-add-rel="${m.id}:uncle" style="padding:7px 4px;background:var(--s2);color:var(--blue);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.paternalUncle')}</button>
      <button data-add-rel="${m.id}:aunt" style="padding:7px 4px;background:var(--s2);color:var(--pink);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.paternalAunt')}</button>
      <button data-add-rel="${m.id}:muncle" style="padding:7px 4px;background:var(--s2);color:var(--blue);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.maternalUncle')}</button>
      <button data-add-rel="${m.id}:maunt" style="padding:7px 4px;background:var(--s2);color:var(--pink);border:1px solid var(--border);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${t('nodePopup.maternalAunt')}</button>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
    <button data-edit-member="${m.id}" style="padding:9px;background:var(--s2);color:var(--blue);border:1px solid rgba(79,156,249,.25);border-radius:8px;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">✏️ ${t('nodePopup.edit')}</button>
    <button data-delete-member="${m.id}" style="padding:9px;background:rgba(248,113,113,.1);color:var(--red);border:1px solid rgba(248,113,113,.2);border-radius:8px;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">🗑️ ${t('nodePopup.delete')}</button>
  </div>
  <button data-focus-tree="${m.id}" style="width:100%;padding:7px;background:rgba(245,197,24,.1);color:var(--gold);border:1px solid rgba(245,197,24,.2);border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">🌳 ${t('nodePopup.showBranch')}</button>`;

  host.appendChild(popup);
  setTimeout(() => {
    document.addEventListener('click', function oc(e) {
      if (!popup.contains(e.target)) {
        removeNodePopup();
        document.removeEventListener('click', oc);
      }
    });
  }, 100);
}

/* ═══════════════════════════════════════════════════════════════
   QUICK-ADD RELATIVE (node popup) — birth date optional
   ═══════════════════════════════════════════════════════════════ */
function parentOf(m) {
  if (!m || !m.parentId) return null;
  return members.find(x => String(x.id) === String(m.parentId)) || null;
}

function motherOfMember(m) {
  if (!m) return null;
  const p = parentOf(m);
  if (p && p.gender === 'female') return p;
  if (p && p.gender === 'male' && p.spouseId) {
    const s = members.find(x => String(x.id) === String(p.spouseId));
    if (s && s.gender === 'female') return s;
  }
  return null;
}

function quickAddRel(mId, kind) {
  const m = members.find(x => String(x.id) === String(mId));
  if (!m) return;
  const ctx = { unknownBirth: true };
  if (kind === 'son') { ctx.relation = 'ابن'; ctx.gender = 'male'; ctx.parentId = m.id; }
  else if (kind === 'daughter') { ctx.relation = 'بنت'; ctx.gender = 'female'; ctx.parentId = m.id; }
  else if (kind === 'brother') { ctx.relation = 'أخ'; ctx.gender = 'male'; ctx.parentId = m.parentId || null; }
  else if (kind === 'sister') { ctx.relation = 'أخت'; ctx.gender = 'female'; ctx.parentId = m.parentId || null; }
  else if (kind === 'father') { ctx.relation = 'أب'; ctx.gender = 'male'; ctx.pendingLink = { father: true, childId: m.id }; }
  else if (kind === 'mother') { ctx.relation = 'أم'; ctx.gender = 'female'; ctx.pendingLink = { mother: true, childId: m.id }; }
  else if (kind === 'husband') { ctx.relation = 'زوج'; ctx.gender = 'male'; ctx.pendingLink = { spouse: m.id }; }
  else if (kind === 'wife') { ctx.relation = 'زوجة'; ctx.gender = 'female'; ctx.pendingLink = { spouse: m.id }; }
  else if (kind === 'muncle' || kind === 'maunt') {
    const mo = motherOfMember(m);
    ctx.gender = kind === 'maunt' ? 'female' : 'male';
    ctx.relation = kind === 'maunt' ? 'خالة' : 'خال';
    ctx.parentId = (mo && mo.parentId) ? String(mo.parentId) : null;
  }
  else if (kind === 'uncle' || kind === 'aunt') {
    const f = parentOf(m);
    ctx.gender = kind === 'aunt' ? 'female' : 'male';
    ctx.relation = kind === 'aunt' ? 'عمة' : 'عم';
    ctx.parentId = (f && f.parentId) ? String(f.parentId) : null;
  }
  removeNodePopup();
  openAddModal(ctx);
}

/* ═══════════════════════════════════════════════════════════════
   BULK ADD CHILDREN (tree) — quick names + gender, no dates needed
   ═══════════════════════════════════════════════════════════════ */
let bcParentId = null;

function bcRowHtml(name = '', gender = 'male') {
  const m = name ? ` value="${esc(name)}"` : '';
  const maleOn = gender === 'male' ? ' on' : '';
  const femaleOn = gender === 'female' ? ' on' : '';
  return `<div class="bc-row" style="direction:rtl">
    <div class="bc-sex">
      <button type="button" class="bc-m${maleOn}" title="${t('memberModal.gender.male')}">👨</button>
      <button type="button" class="bc-f${femaleOn}" title="${t('memberModal.gender.female')}">👩</button>
    </div>
    <input type="text" placeholder="${esc(t('memberModal.namePlaceholder'))}" autocomplete="off"${m} data-bc-name>
    <button type="button" class="bc-del">✕</button>
  </div>`;
}

function openBulkChildren(parentId) {
  const m = members.find(x => String(x.id) === String(parentId));
  if (!m) return;
  bcParentId = parentId;
  const $l = $('bc-parent-label');
  if ($l) $l.textContent = '👤 ' + (m.gender === 'female' ? '👩' : '👨') + ' ' + dispName(m) + ' — ' + t('bulkChildren.addingTo');
  $('bc-rows').innerHTML = bcRowHtml() + bcRowHtml();
  $('bulk-children-overlay').classList.add('show');
  const first = document.querySelector('#bc-rows input[data-bc-name]');
  if (first) setTimeout(() => first.focus(), 120);
}

function closeBulkChildren() {
  $('bulk-children-overlay').classList.remove('show');
}

/* ───── Quick gender toggle from tree card ───── */
let qgMenuEl = null;

function closeQuickGender() {
  if (qgMenuEl) { qgMenuEl.remove(); qgMenuEl = null; }
  document.removeEventListener('click', qgCloseGlobal);
}

function quickGender(id, btn) {
  closeQuickGender();
  const m = members.find(x => String(x.id) === String(id));
  if (!m) return;
  const el = document.createElement('div');
  el.className = 'ft-gender-menu';
  const mk = (g, icon, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = icon + ' ' + label;
    if (m.gender === g) b.classList.add('on');
    b.onclick = async () => {
      closeQuickGender();
      if (m.gender === g) return;
      const r = await api(`/api/members/${id}`, { method: 'PUT', body: JSON.stringify({ gender: g }) });
      if (!r) return;
      m.gender = g;
      showToast('✅ ' + t('toast.updated'));
      if (currentTab === 'tree') { buildTreeContent(); applyTransform(); }
    };
    return b;
  };
  el.append(
    mk('male', '👨', t('memberModal.gender.male') || 'Male'),
    mk('female', '👩', t('memberModal.gender.female') || 'Female')
  );
  document.body.appendChild(el);
  qgMenuEl = el;
  const r = btn.getBoundingClientRect();
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.top - 10) + 'px';
  document.addEventListener('click', qgCloseGlobal);
}

function qgCloseGlobal(e) {
  if (qgMenuEl && !e.target.closest('.ft-gender-menu')) {
    closeQuickGender();
    document.removeEventListener('click', qgCloseGlobal);
  }
}

/* ───── Sibling order modal ───── */
let sibState = { ids: [], headId: null };

function sibOpen(parentId) {
  const ids = sibChildIds(parentId);
  sibState.ids = ids;
  sibState.headId = String(parentId);
  const $h = $('sib-hint');
  if ($h) $h.textContent = t('sib.hint');
  $('sib-order-overlay').classList.add('show');
  sibRenderList();
  document.querySelector('#sib-list .sib-row')?.scrollIntoView({ block: 'start' });
}

function sibClose() { $('sib-order-overlay').classList.remove('show'); }

function sibRowHtml(m, i) {
  const total = sibState.ids.length;
  const age = m.age && m.age.years != null ? (m.age.years + ' ' + t('profile.year')) : (hasRealBirth(m) ? m.birthDate : '');
  return `<div class="sib-row" data-sib-id="${esc(m.id)}" draggable="true">
    <div class="sib-grip" title="${esc(t('sib.drag'))}">≡</div>
    <div class="sib-pos">${i + 1}</div>
    <div class="photo">${m.photoPath ? `<img src="${esc(m.photoPath)}">` : (m.gender === 'female' ? '👩' : '👨')}</div>
    <div class="sib-name">${esc(dispName(m))}<div class="sib-sub">${age || '—'}</div></div>
    <div class="sib-nav">
      <button data-sib-move="up" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button data-sib-move="down" ${i === total - 1 ? 'disabled' : ''}>▼</button>
    </div>
  </div>`;
}

function sibRenderList() {
  const $l = $('sib-list');
  if (!$l) return;
  $l.innerHTML = sibState.ids.map((id, i) => {
    const m = memberById(id);
    return m ? sibRowHtml(m, i) : '';
  }).join('');
}

function sibDropPos(target, y) {
  const r = target.getBoundingClientRect();
  const py = (y != null ? y : window._sibPtrY);
  if (py == null) return 'after';
  return py < r.top + r.height / 2 ? 'before' : 'after';
}

function sibRebuildTo(targetId, place) {
  if (!sibState.dragId) return;
  const from = sibState.ids.findIndex(x => String(x) === String(sibState.dragId));
  const to = sibState.ids.findIndex(x => String(x) === String(targetId));
  if (from < 0 || to < 0 || from === to) return;
  const ids = sibState.ids.slice();
  let idx = to;
  if (place === 'after') idx = to + 1;
  if (from === idx || from === idx - 1) return;
  const [id] = ids.splice(from, 1);
  if (from < idx) idx -= 1;
  ids.splice(idx, 0, id);
  sibState.ids = ids;
  sibRenderList();
  document.querySelectorAll('.sib-row').forEach(r => {
    if (String(r.dataset.sibId) === String(sibState.dragId)) r.classList.add('drag');
  });
}

function sibMove(id, dir) {
  const i = sibState.ids.findIndex(x => String(x) === String(id));
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= sibState.ids.length) return;
  const ids = sibState.ids.slice();
  const [m] = ids.splice(i, 1);
  ids.splice(j, 0, m);
  sibState.ids = ids;
  sibRenderList();
}

async function sibSave() {
  if (!sibState.headId) return;
  const ids = sibState.ids;
  const head = memberById(sibState.headId);
  if (!head) { sibClose(); return; }
  const body = memberPutBody(head);
  body.notes = sibNotesWith(head.notes, ids);
  const res = await api(`/api/members/${head.id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!res || res.error) { showToast(res && res.error ? res.error : t('toast.memberSaveFailed'), 'error'); return; }
  const updated = memberById(head.id);
  if (updated) updated.notes = body.notes;
  showToast('✅ ' + t('sib.saved'));
  sibClose();
  await renderAll();
}

window.sibOpen = sibOpen;
window.sibClose = sibClose;
window.sibMove = sibMove;
window.sibSave = sibSave;

function sibWireDnD() {
  const $l = $('sib-list');
  if (!$l || $l.dataset.dnd === '1') return;
  $l.dataset.dnd = '1';

  $l.addEventListener('dragstart', e => {
    const row = e.target.closest('.sib-row');
    if (!row) return;
    sibState.dragId = String(row.dataset.sibId);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.sibId); } catch (err) {}
    requestAnimationFrame(() => {
      document.querySelectorAll('.sib-row').forEach(r => {
        r.classList.toggle('drag', String(r.dataset.sibId) === String(sibState.dragId));
      });
    });
  });

  $l.addEventListener('dragover', e => {
    const row = e.target.closest('.sib-row');
    if (!row || !sibState.dragId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    const overId = String(row.dataset.sibId);
    if (overId !== String(sibState.dragId)) {
      sibRebuildTo(overId, sibDropPos(row, e.clientY));
    }
  });

  $l.addEventListener('drop', e => {
    if (e.target.closest('.sib-row')) e.preventDefault();
    sibState.dragId = null;
    document.querySelectorAll('.sib-row').forEach(r => r.classList.remove('drag'));
  });

  $l.addEventListener('dragend', () => {
    sibState.dragId = null;
    document.querySelectorAll('.sib-row').forEach(r => r.classList.remove('drag'));
  });

  /* Touch drag (pointer events) started from the grip handle */
  $l.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const grip = e.target.closest('.sib-grip');
    const row = e.target.closest('.sib-row');
    if (!grip || !row) return;
    sibState.pid = e.pointerId;
    sibState.touchStartY = e.clientY;
    sibState.dragId = String(row.dataset.sibId);
    sibState.touchMoved = false;
  }, { passive: true });

  $l.addEventListener('pointermove', e => {
    if (e.pointerId !== sibState.pid || !sibState.dragId) return;
    if (!sibState.touchMoved) {
      if (Math.abs(e.clientY - (sibState.touchStartY || 0)) < 6) return;
      sibState.touchMoved = true;
      sibState.touchDrag = true;
      document.querySelectorAll('.sib-row').forEach(r => {
        r.classList.toggle('drag', String(r.dataset.sibId) === String(sibState.dragId));
      });
    }
    if (!sibState.touchDrag) return;
    e.preventDefault();
    window._sibPtrY = e.clientY;
    const lr = $l.getBoundingClientRect();
    if (e.clientY < lr.top + 44) $l.scrollTop -= 14;
    else if (e.clientY > lr.bottom - 44) $l.scrollTop += 14;
    const rows = Array.from($l.querySelectorAll('.sib-row'));
    const drop = rows.map(r => ({ el: r, hit: r.getBoundingClientRect() })).find(h => e.clientY >= h.hit.top && e.clientY <= h.hit.bottom);
    if (drop && String(drop.el.dataset.sibId) !== String(sibState.dragId)) {
      sibRebuildTo(String(drop.el.dataset.sibId), sibDropPos(drop.el));
    }
  }, { passive: false });

  const endTouch = e => {
    if (e.pointerId !== sibState.pid) return;
    sibState.pid = null;
    sibState.touchDrag = false;
    sibState.touchMoved = false;
    sibState.dragId = null;
    window._sibPtrY = null;
    document.querySelectorAll('.sib-row').forEach(r => r.classList.remove('drag'));
  };
  $l.addEventListener('pointerup', endTouch);
  $l.addEventListener('pointercancel', endTouch);
}

sibWireDnD();

function setBcGender(input, gender) {
  const row = input.closest('.bc-row');
  if (!row) return;
  row.querySelector('.bc-m').classList.toggle('on', gender === 'male');
  row.querySelector('.bc-f').classList.toggle('on', gender === 'female');
}

function bcRowGender(input) {
  const row = input.closest('.bc-row');
  if (!row) return 'male';
  return row.querySelector('.bc-f') && row.querySelector('.bc-f').classList.contains('on') ? 'female' : 'male';
}

function addBcRow() {
  const wrap = $('bc-rows');
  if (!wrap) return;
  const temp = document.createElement('div');
  temp.innerHTML = bcRowHtml();
  const row = temp.firstElementChild;
  wrap.appendChild(row);
  const inp = row.querySelector('input[data-bc-name]');
  if (inp) inp.focus();
  const cs = $('bc-rows');
  if (cs) cs.scrollTop = cs.scrollHeight;
}

function bcCollect() {
  const out = [];
  document.querySelectorAll('#bc-rows .bc-row').forEach(row => {
    const inp = row.querySelector('input[data-bc-name]');
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    out.push({ name, gender: bcRowGender(inp) });
  });
  return out;
}

async function saveBulkChildren() {
  const list = bcCollect();
  if (!list.length) { showToast(t('bulkChildren.empty'), 'error'); return; }
  const btn = $('btn-bc-save');
  if (btn) { btn._saving = true; btn.innerHTML = '⏳ ' + t('memberModal.saving'); }
  let ok = 0, failed = 0;
  try {
    for (const c of list) {
      const body = {
        name: c.name, gender: c.gender, relation: c.gender === 'male' ? 'ابن' : 'بنت',
        parentId: bcParentId, spouseId: '', birthDate: BIRTH_UNKNOWN, deathDate: '',
        phone: '', email: '', nationalId: '', occupation: '', education: '', bloodType: '',
        location: '', birthCountry: '', birthRegion: '', birthDetail: '', anniversaryDate: '',
        photoPath: '', notes: '', notifyBirthday: false
      };
      const res = await apiRetry('/api/members', { method: 'POST', body: JSON.stringify(body) });
      if (res && !res.error && res.member && res.member.id) ok++;
      else failed++;
    }
  } finally {
    if (btn) { btn._saving = false; btn.innerHTML = '💾 ' + t('bulkChildren.save'); }
  }
  if (!ok && failed) { showToast(t('toast.memberSaveFailed'), 'error'); return; }
  showToast(t('bulkChildren.saved', { n: ok }));
  closeBulkChildren();
  const pid = String(bcParentId);
  if (treeCollapsed) treeCollapsed.delete(pid);
  await renderAll();
}

function bindBulkChildren() {
  const ov = $('bulk-children-overlay');
  if (!ov) return;
  ov.addEventListener('click', e => {
    if (e.target === ov) { closeBulkChildren(); return; }
    const btn = e.target.closest('#btn-bc-save');
    if (btn) { saveBulkChildren(); return; }
    const cbtn = e.target.closest('#btn-bc-cancel');
    if (cbtn) { closeBulkChildren(); return; }
    const add = e.target.closest('#btn-bc-add-row');
    if (add) { addBcRow(); return; }
    const del = e.target.closest('.bc-del');
    if (del) {
      const rows = ov.querySelectorAll('.bc-row');
      if (rows.length > 1) del.closest('.bc-row').remove();
      return;
    }
    const sex = e.target.closest('.bc-sex button');
    if (sex) {
      const row = sex.closest('.bc-row');
      const inp = row.querySelector('input[data-bc-name]');
      if (inp) setBcGender(inp, sex.classList.contains('bc-f') ? 'female' : 'male');
      return;
    }
  });
  ov.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const inp = e.target.closest('input[data-bc-name]');
    if (!inp) return;
    e.preventDefault();
    if (inp.value && inp.value.trim()) addBcRow();
  });
}

async function memberByIdFresh(id) {
  const d = await api('/api/members?groupBy=none');
  const arr = d && d.members ? d.members : (Array.isArray(d) ? d : []);
  return arr.find(x => String(x.id) === String(id)) || null;
}

function memberPutBody(m) {
  return {
    name: m.name, birthDate: m.birthDate, deathDate: m.deathDate || null, relation: m.relation || '',
    gender: m.gender || 'male', parentId: m.parentId || null, spouseId: m.spouseId || null,
    childIds: members.filter(c => String(c.parentId) === String(m.id)).map(c => c.id),
    phone: m.phone || '', email: m.email || '', nationalId: m.nationalId || '',
    occupation: m.occupation || '', education: m.education || '', bloodType: m.bloodType || '',
    location: m.location || '', birthCountry: m.birthCountry || '', birthRegion: m.birthRegion || '',
    birthDetail: m.birthDetail || '', anniversaryDate: m.anniversaryDate || '',
    photoPath: m.photoPath || '', notes: m.notes || '', notifyBirthday: m.notifyBirthday || false
  };
}

async function applyPendingLink(newId, L) {
  if (!newId) return;
  try {
    if (L.mother && L.childId) {
      await linkMotherToChild(L.childId, newId);
    } else if (L.father && L.childId) {
      const child = members.find(x => String(x.id) === String(L.childId));
      if (child) {
        const cb = memberPutBody(child); cb.parentId = newId;
        await api(`/api/members/${child.id}`, { method: 'PUT', body: JSON.stringify(cb) });
        const childView = members.find(x => x.id === child.id);
        if (childView) childView.parentId = newId;
        const father = await memberByIdFresh(newId);
        if (father) {
          const md = await api('/api/relationships?member=' + child.id);
          const rows = (md && md.relationships) || [];
          const rel = rows.find(r => String(r.relType) === 'biological_parent');
          if (rel) {
            const motherId = String(rel.personAId) === String(child.id) ? rel.personBId : rel.personAId;
            const mother = motherId ? await memberByIdFresh(motherId) : null;
            if (mother && String(mother.gender) === 'female' && !mother.spouseId && !father.spouseId) {
              const mb = memberPutBody(mother); mb.spouseId = father.id;
              await api(`/api/members/${mother.id}`, { method: 'PUT', body: JSON.stringify(mb) });
              const fb = memberPutBody(father); fb.spouseId = mother.id;
              await api(`/api/members/${father.id}`, { method: 'PUT', body: JSON.stringify(fb) });
            }
          }
        }
      }
    } else if (L.spouse) {
      const nm = await memberByIdFresh(newId);
      if (nm) {
        nm.spouseId = String(L.spouse);
        await api(`/api/members/${newId}`, { method: 'PUT', body: JSON.stringify(memberPutBody(nm)) });
        const ex = members.find(x => String(x.id) === String(L.spouse));
        if (ex && !ex.spouseId) {
          const eb = memberPutBody(ex); eb.spouseId = newId;
          await api(`/api/members/${ex.id}`, { method: 'PUT', body: JSON.stringify(eb) });
        }
      }
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════
   IMPORT / EXPORT
   ═══════════════════════════════════════════════════════════════ */
async function exportCSV() {
  try {
    const res = await fetch('/api/export/csv?lang=' + apiLang());
    const blob = await res.blob();
    const fname = `${t('download.treeCsv')}_${new Date().toISOString().slice(0, 10)}.csv`;
    await saveUserFile(blob, fname, 'text/csv');
    showToast(t('toast.exportedCsv'));
  } catch (e) { showToast(t('toast.exportError')); }
}

async function importCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const merge = await askConfirm(t('confirm.csvImportMode'));
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', merge ? 'merge' : 'replace');
  formData.append('lang', apiLang());
  try {
    const res = await fetch('/api/import/csv', { method: 'POST', body: formData });
    const data = await res.json();
    showToast(data.message || t('toast.imported'));
    await renderAll();
  } catch (e) { showToast(t('toast.importError')); }
  event.target.value = '';
}

async function exportCalendar() {
  try {
    const res = await fetch('/api/export/calendar?lang=' + apiLang());
    const blob = await res.blob();
    const fname = t('download.calendarIcs') + '.ics';
    await saveUserFile(blob, fname, 'text/calendar');
    showToast(t('toast.exportedCal'));
  } catch (e) { showToast(t('toast.exportError')); }
}

function downloadBlob(blob, fname) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/*Open the real "Save as" dialog via showSaveFilePicker,
and if it is unavailable (an environment that does not support it), download the file with a visible note of where it was placed.
Cancelling the dialog by the user must not trigger the silent download.*/
async function saveUserFile(blob, suggestedName, mime) {
  if (window.showSaveFilePicker && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'File', accept: { [mime || 'application/octet-stream']: [extOf(suggestedName)] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) { return false; } // The user cancelled, or it failed
  }
  downloadBlob(blob, suggestedName);
  showToast(t('toast.downloadedFallback') || ('💾 ' + (suggestedName || t('download.tree'))));
  return false;
}
function extOf(fname) {
  const i = (fname || '').lastIndexOf('.');
  return i >= 0 ? fname.slice(i) : '';
}

async function exportTreeImage(kind) {
  try {
    if (typeof html2canvas !== 'function') { showToast(t('toast.exportError')); return; }
    const canvas = $('tree-canvas');
    if (!canvas) return;
    const prevTransform = canvas.style.transform;
    canvas.style.transform = 'none';
    if (['elegant','flow','neon','ortho'].includes(treeLineStyle)) drawSVGConnections(treeLineStyle);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = canvas.scrollWidth, h = canvas.scrollHeight;
    const cnt = document.createElement('canvas');
    cnt.width = w; cnt.height = h;
    const ctx = cnt.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#ffffff';
    ctx.fillRect(0, 0, w, h);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const snap = await html2canvas(canvas, { backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#ffffff', scale: 2, useCORS: true, logging: false });
    ctx.drawImage(snap, 0, 0, w, h);
    canvas.style.transform = prevTransform;
    // Redraw the links after exporting (the coordinate transforms return to live mode)
    if (['elegant','flow','neon','ortho'].includes(treeLineStyle)) drawSVGConnections(treeLineStyle);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'pdf') {
      const jspMod = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!jspMod) {
        const pngBlob = await new Promise(r => cnt.toBlob(r, 'image/png', 0.92));
        await saveUserFile(pngBlob, `family_tree_${stamp}.png`, 'image/png');
        showToast(t('toast.exportedPng'));
        return;
      }
      const pdf = new jspMod({ orientation: w >= h ? 'l' : 'p', unit: 'px', format: [w / 2, h / 2], hotfixes: ['px_scaling'] });
      pdf.addImage(cnt.toDataURL('image/png'), 'PNG', 0, 0, w / 2, h / 2);
      const pdfBlob = pdf.output('blob');
      await saveUserFile(pdfBlob, `family_tree_${stamp}.pdf`, 'application/pdf');
      showToast(t('toast.exportedPdf'));
    } else {
      const pngBlob = await new Promise(r => cnt.toBlob(r, 'image/png', 0.92));
      await saveUserFile(pngBlob, `family_tree_${stamp}.png`, 'image/png');
      showToast(t('toast.exportedPng'));
    }
  } catch (e) { showToast(t('toast.exportError')); }
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT WIZARD (multi-format, client-side)
   ═══════════════════════════════════════════════════════════════ */
const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV', txt: 'exportWizard.fmtCsv', mime: 'text/csv', ext: 'csv', icon: '📄' },
  { id: 'xls', label: 'Excel (.xls)', txt: 'exportWizard.fmtXls', mime: 'application/vnd.ms-excel', ext: 'xls', icon: '📊' },
  { id: 'json', label: 'JSON', txt: 'exportWizard.fmtJson', mime: 'application/json', ext: 'json', icon: '🗃️' },
  { id: 'vcf', label: 'vCard', txt: 'exportWizard.fmtVcf', mime: 'text/vcard', ext: 'vcf', icon: '👤' },
  { id: 'html', label: 'HTML', txt: 'exportWizard.fmtHtml', mime: 'text/html', ext: 'html', icon: '🌐' },
  { id: 'pdf', label: 'PDF', txt: 'exportWizard.fmtPdf', mime: 'application/pdf', ext: 'pdf', icon: '🖨️' }
];

/*Export columns with headers translated from the values stored on the member.
Values are written in the selected interface language (t()): gender, kinship relation and zodiac sign are translated locally.*/
const EXPORT_FIELDS = [
  /*Columns 0..16 match exactly the /api/import/csv order on the server:
     name, birth_date, death_date, gender, relation, parent_id, phone, email,
     national_id, occupation, education, blood_type, location, notes,
birth_country, birth_region, birth_detail — so that the export can be re-imported
safely (keep the core values in their raw form), then the extended columns after them.*/
  { id: 'name', h: 'table.colName', get: m => m.name || '' },
  { id: 'birthDate', h: 'memberModal.birthDate', get: m => m.birthDate || '' },
  { id: 'deathDate', h: 'memberModal.deathDate', get: m => m.deathDate || '' },
  { id: 'gender', h: 'memberModal.gender', get: m => (m.gender === 'female' ? 'female' : m.gender === 'male' ? 'male' : '') },
  { id: 'relation', h: 'table.colRelation', get: m => m.relation || '' },
  { id: 'parentId', h: 'exportWizard.colParentId', get: m => m.parentId || '' },
  { id: 'phone', h: 'memberModal.phone', get: m => m.phone || '' },
  { id: 'email', h: 'memberModal.email', get: m => m.email || '' },
  { id: 'nationalId', h: 'memberModal.nationalId', get: m => m.nationalId || '' },
  { id: 'occupation', h: 'memberModal.occupation', get: m => m.occupation || '' },
  { id: 'education', h: 'memberModal.education', get: m => m.education || '' },
  { id: 'bloodType', h: 'memberModal.bloodType', get: m => m.bloodType || '' },
  { id: 'location', h: 'memberModal.location', get: m => m.location || '' },
  { id: 'notes', h: 'memberModal.notes', get: m => m.notes || '' },
  { id: 'birthCountry', h: 'memberModal.country', get: m => m.birthCountry || '' },
  { id: 'birthRegion', h: 'memberModal.region', get: m => (typeof decodeRegion === 'function' ? decodeRegion(m.birthRegion || '').region : m.birthRegion) || '' },
  { id: 'birthDetail', h: 'exportWizard.colBirthDetail', get: m => m.birthDetail || '' },
  /*The extended columns come afterwards for the translated display and human readability (the server-side importer safely ignores them)*/
  { id: 'id', h: 'exportWizard.colId', get: m => (m.id != null ? String(m.id) : '') },
  { id: 'father', h: 'memberModal.fatherLabel', get: m => nameOf(m.parentId) },
  { id: 'fatherId', h: 'exportWizard.colFatherId', get: m => m.parentId || '' },
  { id: 'mother', h: 'memberModal.motherLabel', get: m => motherOf(m) },
  { id: 'motherId', h: 'exportWizard.colMotherId', get: m => EXPORT_MOTHERS[String(m.id)] || '' },
  { id: 'spouse', h: 'memberModal.spouseLabel', get: m => nameOf(m.spouseId) },
  { id: 'spouseId', h: 'exportWizard.colSpouseId', get: m => m.spouseId || '' },
  { id: 'children', h: 'memberModal.childrenLabel', get: m => childrenOf(m).map(c => c.name).join('; ') },
  { id: 'childIds', h: 'exportWizard.colChildIds', get: m => childrenOf(m).map(c => c.id).join('; ') },
  { id: 'age', h: 'table.colAge', get: m => yearsToNow(m.birthDate) },
  { id: 'zodiac', h: 'table.colZodiac', get: m => zodiacName(m) },
  { id: 'anniversaryDate', h: 'memberModal.anniversary', get: m => m.anniversaryDate || '' },
  { id: 'photoPath', h: 'memberModal.photo', get: m => m.photoPath || '' },
  { id: 'notifyBirthday', h: 'memberModal.notifyBirthday', get: m => (m.notifyBirthday ? '1' : '0') },
  { id: 'genderLocalized', h: 'exportWizard.colGenderLocalized', get: m => _expGender(m) },
  { id: 'relationLocalized', h: 'exportWizard.colRelationLocalized', get: m => relTxt(m.relation || '') },
  { id: 'birthCountryLocalized', h: 'exportWizard.colCountryLocalized', get: m => (typeof countryTxt === 'function' ? countryTxt(m.birthCountry || '') : m.birthCountry) || '' },
  { id: 'birthRegionLocalized', h: 'exportWizard.colRegionLocalized', get: m => (typeof regionTxt === 'function' ? regionTxt((typeof decodeRegion === 'function' ? decodeRegion(m.birthRegion || '').region : m.birthRegion) || '', m.birthCountry) : m.birthRegion) || '' }
];

function _expGender(m) {
  const g = (m && m.gender) || '';
  if (g === 'male') { const v = t('memberModal.gender.male'); return (v && v !== 'memberModal.gender.male') ? v : g; }
  if (g === 'female') { const v = t('memberModal.gender.female'); return (v && v !== 'memberModal.gender.female') ? v : g; }
  return g;
}

function zodiacName(m) {
  const z = zodiacOf(m);
  if (!z) return '';
  const key = String(z.key || z.name || '').toLowerCase();
  if (key) {
    const v = t('zodiac.' + key);
    if (v && v !== 'zodiac.' + key) return v;
  }
  return z.name || '';
}

let EXPORT_MOTHERS = {}; // childId -> motherId (from the biological_parent relations, with a fallback)

function exportColumns() {
  const list = exportViews();
  const byId = new Map(list.map(m => [String(m.id), m]));
  window._expNameOf = id => { const o = byId.get(String(id == null ? '' : id)); return o ? o.name : ''; };
  window._expChildrenOf = m => list.filter(c => String(c.parentId) === String(m.id));
  window._expMotherOf = m => {
    const kid = String(m.id);
    if (EXPORT_MOTHERS[kid]) return window._expNameOf(EXPORT_MOTHERS[kid]);
    const p = byId.get(String(m.parentId == null ? '' : m.parentId));
    if (p && p.gender === 'female') return p.name;
    if (p && p.spouseId) { const s = byId.get(String(p.spouseId)); if (s && s.gender === 'female') return s.name; }
    return '';
  };
  return EXPORT_FIELDS.map(f => ({ h: t(f.h), get: f.get }));
}
const nameOf = id => (window._expNameOf ? window._expNameOf(id) : '');
const childrenOf = m => (window._expChildrenOf ? window._expChildrenOf(m) : []);
const motherOf = m => (window._expMotherOf ? window._expMotherOf(m) : '');

function openExportWizard() {
  $('export-fmt-list').innerHTML = EXPORT_FORMATS.map((f, i) => `
    <label style="display:flex;gap:8px;align-items:center;background:var(--s3);border:1px solid var(--border);border-radius:10px;padding:9px 12px;cursor:pointer;font-size:13px;color:var(--text)">
      <input type="checkbox" value="${f.id}" ${i === 0 ? 'checked' : ''} style="accent-color:var(--gold);transform:scale(1.15);cursor:pointer">
      <span>${f.icon} ${esc(t(f.txt))}</span>
    </label>`).join('');
  $('export-wizard-overlay').classList.add('show');
}

function closeExportWizard() {
  $('export-wizard-overlay').classList.remove('show');
}

function buildExportCSV() {
  const cols = exportColumns();
  const escCsv = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // Prevent formula injection
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.map(c => escCsv(c.h)).join(',')];
  exportViews().forEach(m => lines.push(cols.map(c => escCsv(c.get(m))).join(',')));
  return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

function buildExportXLS() {
  const cols = exportColumns();
  const x = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const row = cells => '<Row>' + cells.map(c => '<Cell><Data ss:Type="String">' + x(c) + '</Data></Cell>').join('') + '</Row>';
  const body = [row(cols.map(c => c.h))];
  exportViews().forEach(m => body.push(row(cols.map(c => c.get(m)))));
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${x(t('download.treeCsv'))}">
<Table>${body.join('')}</Table>
</Worksheet>
</Workbook>`;
  return new Blob([xml], { type: 'application/vnd.ms-excel' });
}

function buildExportJSON() {
  const list = exportViews();
  const byId = new Map(list.map(m => [String(m.id), m]));
  const nameOf = id => (byId.get(String(id == null ? '' : id)) && byId.get(String(id == null ? '' : id)).name) || null;
  const payload = {
    exportedAt: new Date().toISOString(),
    family: FAMILY.name || '',
    count: list.length,
    members: list.map(m => {
      const o = { id: m.id, ...memberPutBody(m) };
      o.fatherId = m.parentId || null;
      o.fatherName = nameOf(m.parentId);
      o.motherId = EXPORT_MOTHERS[String(m.id)] || null;
      o.motherName = EXPORT_MOTHERS[String(m.id)] ? nameOf(EXPORT_MOTHERS[String(m.id)]) : null;
      o.spouseId = m.spouseId || null;
      o.spouseName = nameOf(m.spouseId);
      o.childIds = memberPutBody(m).childIds;
      o.childrenNames = list.filter(c => String(c.parentId) === String(m.id)).map(c => c.name);
      o.ageYears = yearsToNow(m.birthDate);
      const z = zodiacOf(m);
      o.zodiac = z ? z.name : null;
      o.genderLocalized = _expGender(m);
      o.relationLocalized = relTxt(m.relation || '');
      const zl = zodiacName(m);
      o.zodiacLocalized = zl;
      if (typeof decodeRegion === 'function') {
        const dec = decodeRegion(m.birthRegion || '');
        o.birthRegion = dec.region;
        if (dec.lang) o.birthRegionLang = dec.lang;
      }
      if (typeof countryTxt === 'function' && m.birthCountry) o.birthCountryLocalized = countryTxt(m.birthCountry);
      if (typeof regionTxt === 'function' && m.birthRegion) o.birthRegionLocalized = regionTxt((typeof decodeRegion === 'function' ? decodeRegion(m.birthRegion || '').region : m.birthRegion) || '', m.birthCountry);
      return o;
    })
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function buildExportVCF() {
  const escLine = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/[\r\n]+/g, ' ');
  const list = exportViews();
  const byId = new Map(list.map(m => [String(m.id), m]));
  const nameOf = id => (byId.get(String(id == null ? '' : id)) && byId.get(String(id == null ? '' : id)).name) || '';
  let out = '';
  list.forEach(m => {
    const kids = list.filter(c => String(c.parentId) === String(m.id)).map(c => c.name);
    out += 'BEGIN:VCARD\r\nVERSION:3.0\r\n';
    out += 'FN:' + escLine(m.name) + '\r\n';
    out += 'N:' + escLine(m.name).split(/\s+/).reverse().join(';') + ';;;;\r\n';
    if (m.gender) out += 'X-GENDER:' + escLine(_expGender(m)) + '\r\n';
    if (m.relation) out += 'ROLE:' + escLine(relTxt(m.relation)) + '\r\n';
    if (m.birthDate) out += 'BDAY;VALUE=date:' + m.birthDate.replace(/-/g, '') + '\r\n';
    if (zodiacName(m)) out += 'X-ZODIAC:' + escLine(zodiacName(m)) + '\r\n';
    if (m.birthCountry || m.birthRegion || m.birthDetail) {
      const region = (typeof regionTxt === 'function' ? regionTxt((typeof decodeRegion === 'function' ? decodeRegion(m.birthRegion || '').region : m.birthRegion) || '', m.birthCountry) : m.birthRegion) || '';
      const ctry = (typeof countryTxt === 'function' ? countryTxt(m.birthCountry || '') : m.birthCountry) || '';
      out += 'X-BIRTHPLACE;VALUE=text:' + escLine([m.birthDetail, region, ctry].filter(Boolean).join(', ')) + '\r\n';
    }
    if (m.deathDate) out += 'X-DEATHDATE;VALUE=date-and-or-time:' + escLine(m.deathDate) + '\r\n';
    if (m.anniversaryDate) out += 'X-ANNIVERSARY;VALUE=date:' + m.anniversaryDate.replace(/-/g, '') + '\r\n';
    if (m.phone) out += 'TEL;TYPE=CELL:' + escLine(m.phone) + '\r\n';
    if (m.email) out += 'EMAIL;TYPE=INTERNET:' + escLine(m.email) + '\r\n';
    if (m.nationalId) out += 'X-NATIONAL-ID:' + escLine(m.nationalId) + '\r\n';
    if (m.occupation) out += 'TITLE:' + escLine(m.occupation) + '\r\n';
    if (m.education) out += 'X-EDUCATION:' + escLine(m.education) + '\r\n';
    if (m.bloodType) out += 'X-BLOOD-TYPE:' + escLine(m.bloodType) + '\r\n';
    if (m.location) out += 'ADR;TYPE=DOM,HOME:;;' + escLine(m.location) + ';;;;\r\n';
    if (m.parentId) out += 'X-FATHER:' + escLine(nameOf(m.parentId)) + '\r\n';
    const mi = EXPORT_MOTHERS[String(m.id)];
    if (mi) out += 'X-MOTHER:' + escLine(nameOf(mi)) + '\r\n';
    if (m.spouseId) out += 'X-SPOUSE:' + escLine(nameOf(m.spouseId)) + '\r\n';
    if (kids.length) out += 'X-CHILDREN:' + escLine(kids.join(', ')) + '\r\n';
    if (m.notes) out += 'NOTE:' + escLine(m.notes) + '\r\n';
    out += 'END:VCARD\r\n';
  });
  return new Blob(['\ufeff' + out], { type: 'text/vcard' });
}

function buildExportHTML() {
  const cols = exportColumns();
  const x = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = exportViews().map(m => '<tr>' + cols.map(c => '<td>' + x(c.get(m)) + '</td>').join('') + '</tr>').join('');
  const html = `<!DOCTYPE html><html lang="${apiLang()}"><head><meta charset="utf-8"><title>${x(t('exportWizard.title'))}</title>
<style>body{font-family:Tajawal,Arial,sans-serif;margin:24px;color:#222}h1{color:#a5770e}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:start}th{background:#f3e3b8}</style>
</head><body><h1>${x(FAMILY.name || '')} — ${x(t('exportWizard.title'))}</h1>
<p>${exportViews().length} ${x(t('exportWizard.memberCount'))}</p>
<table><thead><tr>${cols.map(c => '<th>' + x(c.h) + '</th>').join('')}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  return new Blob(['\ufeff' + html], { type: 'text/html' });
}

function buildExportPDF() {
  const jspMod = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  const cols = exportColumns();
  const pdf = new jspMod({ orientation: 'l', unit: 'pt', format: 'a4' });
  const pageW = 842, pageH = 595, margin = 30;
  const startY = 50;
  let y = startY;
  pdf.setFontSize(14);
  pdf.setTextColor(165, 119, 14);
  pdf.text((FAMILY.name || '') + ' — ' + t('exportWizard.title'), margin, 34);
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(8);
  const colX = [];
  let acc = margin;
  const widthsRaw = cols.map(() => 0), minW = 46;
  const getW = (txt) => (String(txt == null ? '' : txt).length + 2) * 4.4;
  cols.forEach((c, i) => {
    let w = Math.max(getW(c.h), minW);
    exportViews().forEach(m => w = Math.max(w, Math.min(getW(c.get(m)), 160)));
    widthsRaw[i] = w;
  });
  const total = widthsRaw.reduce((a, b) => a + b, 0);
  const scale = (pageW - margin * 2) / total;
  cols.forEach((c, i) => { colX.push(acc); acc += widthsRaw[i] * scale; });
  const drawHead = () => {
    pdf.setFillColor(243, 227, 184);
    pdf.rect(margin, y - 12, pageW - margin * 2, 16, 'F');
    pdf.setTextColor(60, 60, 60);
    cols.forEach((c, i) => pdf.text(String(c.h), colX[i] + 4, y, { maxWidth: widthsRaw[i] * scale - 8 }));
    y += 14;
  };
  drawHead();
  pdf.setTextColor(20, 20, 20);
  exportViews().forEach(m => {
    if (y > pageH - 40) { pdf.addPage(); y = 20; drawHead(); }
    cols.forEach((c, i) => pdf.text(String(c.get(m)), colX[i] + 4, y, { maxWidth: widthsRaw[i] * scale - 8 }));
    y += 13;
  });
  return pdf.output('blob');
}

/*The export set: all unfiltered members (returns an array)
while building the mother map (biological_parent -> child->mother)*/
let EXPORT_POOL = null;
async function exportPool() {
  try {
    const data = await api('/api/members?groupBy=none&lang=' + apiLang());
    if (data && Array.isArray(data.members) && data.members.length) {
      EXPORT_POOL = data.members;
      EXPORT_MOTHERS = {};
      try {
        const rd = await api('/api/relationships');
        const rows = (rd && rd.relationships) || [];
        rows.forEach(r => {
          if (String(r.relType) === 'biological_parent' && r.personAId && r.personBId) {
            EXPORT_MOTHERS[String(r.personAId)] = String(r.personBId);
          }
        });
      } catch (e) {}
      return EXPORT_POOL;
    }
  } catch (e) {}
  EXPORT_POOL = (members || []).slice();
  EXPORT_MOTHERS = {};
  return EXPORT_POOL;
}
function exportViews() { return EXPORT_POOL || members; }

async function runExportWizard() {
  const sel = EXPORT_FORMATS.filter(f => $('export-fmt-list')?.querySelector('input[value="' + f.id + '"]')?.checked);
  if (!sel.length) { showToast(t('toast.exportError')); return; }
  closeExportWizard();
  const stamp = new Date().toISOString().slice(0, 10);
  EXPORT_POOL = await exportPool();
  try {
    const builders = { csv: buildExportCSV, xls: buildExportXLS, json: buildExportJSON, vcf: buildExportVCF, html: buildExportHTML, pdf: buildExportPDF };
    for (const f of sel) {
      if (f.id === 'pdf' && !((window.jspdf && window.jspdf.jsPDF) || window.jsPDF)) continue;
      const blob = builders[f.id]();
      const fname = `${t('download.treeCsv')}_${stamp}.${f.ext}`;
      await saveUserFile(blob, fname, f.mime);
    }
    showToast(t('toast.exportedCsv'));
  } catch (e) { showToast(t('toast.exportError')); }
}

/* ═══════════════════════════════════════════════════════════════
   SHARE
   ═══════════════════════════════════════════════════════════════ */
function openShareModal() {
  $('share-overlay').classList.add('show');
  $('share-url-box').style.display = 'none';
  $('share-copy-btn').style.display = 'none';
  $('share-revoke-btn').style.display = 'none';
  $('share-gen-btn').style.display = 'inline-flex';
}

async function generateShareLink() {
  const res = await api('/api/share/generate', { method: 'POST' });
  $('share-url-box').textContent = res.shareUrl;
  $('share-url-box').style.display = 'block';
  $('share-copy-btn').style.display = 'inline-flex';
  $('share-revoke-btn').style.display = 'inline-flex';
  $('share-gen-btn').style.display = 'none';
}

async function copyShareLink() {
  const url = $('share-url-box').textContent;
  try { await navigator.clipboard.writeText(url); showToast(t('toast.linkCopied')); } catch (e) { showToast(t('toast.copyFailed')); }
}

async function revokeShareLink() {
  await api('/api/share/revoke', { method: 'POST' });
  showToast(t('toast.shareRevoked'));
  $('share-overlay').classList.remove('show');
}

/* ═══════════════════════════════════════════════════════════════
   QUICK SEARCH
   ═══════════════════════════════════════════════════════════════ */
function openQuickSearch() {
  $('quick-search-overlay').classList.add('show');
  $('quick-search-input').value = '';
  $('quick-search-results').innerHTML = '';
  setTimeout(() => $('quick-search-input').focus(), 200);
}

function closeQuickSearch() {
  $('quick-search-overlay').classList.remove('show');
}

let qsIndex = -1;

function runQuickSearch() {
  const q = $('quick-search-input').value.trim().toLowerCase();
  const res = $('quick-search-results');
  const addItem = `<div class="qs-item qs-add" data-qs-add style="padding:8px 12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:10px;border-top:1px dashed var(--border);margin-top:6px">
      <span style="font-size:18px">➕</span>
      <div style="font-weight:700;font-size:13px;color:var(--gold)">${q ? esc(t('quicksearch.addWithName').replace('{q}', q)) : t('common.addMemberShort')}</div>
    </div>`;
  if (!q) { res.innerHTML = addItem; return; }
  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(q) || ((m.relation || '').toLowerCase()).includes(q) || dispRel(m).toLowerCase().includes(q) || (m.occupation || '').toLowerCase().includes(q) || (m.zodiac ? m.zodiac.name.toLowerCase().includes(q) : false)
  );
  qsIndex = -1;
  if (!filtered.length) { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">' + t('table.noResults') + '</div>' + addItem; return; }
  res.innerHTML = filtered.map((m, i) =>
    `<div class="qs-item" data-qs-id="${m.id}" style="padding:8px 12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .15s">
      <span style="font-size:20px">${m.gender === 'female' ? '👩' : '👨'}</span>
      <div><div style="font-weight:700;font-size:14px">${esc(dispName(m))}</div><div style="font-size:11px;color:var(--muted)">${dispRel(m) ? esc(dispRel(m)) : ''}${m.isDeceased ? ' ⚰️' : ''}</div></div>
      <div style="margin-right:auto;font-size:12px;color:var(--gold)">${ageYears(m) != null ? ageYears(m) + ' ' + t('tree.years') : ''}</div>
    </div>`
  ).join('') + addItem;
}

function quickSearchKeydown(e) {
  const items = document.querySelectorAll('.qs-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); qsIndex = Math.min(qsIndex + 1, items.length - 1); highlightQs(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); qsIndex = Math.max(qsIndex - 1, 0); highlightQs(items); }
  else if (e.key === 'Enter' && qsIndex >= 0 && items[qsIndex]) { items[qsIndex].click(); }
}

function highlightQs(items) {
  items.forEach((el, i) => { el.style.background = i === qsIndex ? 'var(--s3)' : 'transparent'; });
  if (qsIndex >= 0 && items[qsIndex]) items[qsIndex].scrollIntoView({ block: 'nearest' });
}

/* ═══════════════════════════════════════════════════════════════
   RENDER ALL
   ═══════════════════════════════════════════════════════════════ */
async function renderAll() {
  DASH_CACHE = null;
  FAMILY_SCOPE_ALL = null;
  FAMILY_SCOPE_FULL = null;
  if (currentTab === 'tree' && document.getElementById('tree-canvas')) treeKeepView = true;
  await loadMembers();
  await healParentCycles();
  await renderGlobalFilter();
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + currentTab));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === currentTab));
  $$('.bn-item').forEach(el => el.classList.toggle('active', el.dataset.tab === currentTab));
  renderCurrentView();
}

/* ═══════════════════════════════════════════════════════════════
   BIRTHDAY NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */
function requestNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

async function checkBirthdayNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const res = await fetch('/api/notifications/check?lang=' + apiLang());
    const data = await res.json();
    (data.upcomingBirthdays || []).forEach(b => {
      if (b.daysUntil === 0) new Notification('🎂 ' + t('notify.happyBirthday'), { body: b.name + ' 🎉' });
      else if (b.daysUntil <= 3) new Notification('🎂 ' + t('notify.upcomingBirthday'), { body: b.name + ' ' + t('dashboard.eventIn') + ' ' + b.daysUntil + ' ' + t('table.daysUntil') });
    });
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════
   GLOBAL SEARCH DROP STATE — shared between the delegated click
   handler below and the DOMContentLoaded typeahead wiring, so it
   must live in top-level scope (a closure-local declaration made
   result clicks throw a ReferenceError and silently do nothing).
   ═══════════════════════════════════════════════════════════════ */
let _searchAll = null, _sdIdx = -1, _sdItems = [];
function closeSearchDrop() {
  const b = $('search-drop');
  if (b) b.classList.remove('show');
  _sdItems = [];
  _sdIdx = -1;
}

/* ═══════════════════════════════════════════════════════════════
   EVENT DELEGATION — All click handlers
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('click', e => {
  const t = e.target;

  // Sidebar navigation
  const navItem = t.closest('.nav-item');
  if (navItem && navItem.dataset.tab) {
    switchTab(navItem.dataset.tab);
    return;
  }
  // Bottom navigation
  const bnItem = t.closest('.bn-item');
  if (bnItem && bnItem.dataset.tab) {
    switchTab(bnItem.dataset.tab);
    return;
  }

  // Hamburger
  if (t.closest('#hamburger')) { toggleSidebar(); return; }

  // Bottom-nav "More" button
  if (t.closest('#btn-bn-more')) { toggleSidebar(); return; }

  // Search dropdown kinship chip → open that relative's profile
  if (t.closest('#search-drop [data-profile]')) {
    const kc = t.closest('#search-drop [data-profile]');
    closeSearchDrop(); openProfile(kc.dataset.profile); return;
  }

  // Search dropdown result
  if (t.closest('#search-drop .sd-item')) {
    const sdi = t.closest('#search-drop .sd-item');
    const gs = $('global-search');
    if (gs) gs.value = '';
    searchQ = ''; closeSearchDrop();
    if (currentTab === 'members') loadMembers().then(renderTableBody);
    openProfile(sdi.dataset.id);
    return;
  }

  // Sidebar close
  if (t.closest('#sidebar-close')) { closeSidebar(); return; }

  // Sidebar overlay
  if (t.closest('#sidebar-overlay')) { closeSidebar(); return; }

  // Add member button
  if (t.closest('#btn-add-member')) { openAddModal(); return; }

  // Export CSV button
  if (t.closest('#btn-export-csv')) { openExportWizard(); return; }

  // Import CSV button
  if (t.closest('#btn-import-csv')) { $('csv-inp').click(); return; }

  // Logout
  if (t.closest('#btn-logout')) { window.location.href = '/logout'; return; }

  // Header actions
  if (t.closest('#btn-export-cal')) { exportCalendar(); return; }
  if (t.closest('#btn-print')) { window.print(); return; }

  // Table row edit/delete (delegated from tbody)
  if (t.dataset.edit) { startEdit(t.dataset.edit); return; }
  if (t.dataset.delete) { deleteMember(t.dataset.delete); return; }

  // Table row click to edit (but not on the profile name)
  const tr = t.closest('tbody tr[data-id]');
  if (tr && !t.closest('.action-cell') && !t.closest('[data-profile]')) { startEdit(tr.dataset.id); return; }

  // Bulk-add children button on tree card
  const bulkBtn = t.closest('[data-bulk-children]');
  if (bulkBtn) { openBulkChildren(bulkBtn.dataset.bulkChildren); return; }

  // Reorder-children button on tree card
  const sibBtn = t.closest('[data-sib-order]');
  if (sibBtn) { sibOpen(sibBtn.dataset.sibOrder); return; }

  // Quick gender menu on tree card
  const qgBtn = t.closest('[data-quick-gender]');
  if (qgBtn) { quickGender(qgBtn.dataset.quickGender, qgBtn); return; }

  // Sibling reorder modal actions
  if (t.closest('#btn-sib-cancel')) { sibClose(); return; }
  if (t.closest('#btn-sib-save')) { sibSave(); return; }
  const sibMoveBtn = t.closest('[data-sib-move]');
  if (sibMoveBtn) {
    const row = sibMoveBtn.closest('.sib-row');
    if (row && row.dataset.sibId) sibMove(row.dataset.sibId, sibMoveBtn.dataset.sibMove);
    return;
  }

  // Tree person click
  const person = t.closest('.ft-person');
  if (person && person.dataset.member) { openProfile(person.dataset.member); return; }

  // Horoscope card click
  const horoCard = t.closest('[data-horo]');
  if (horoCard) { openHoroscopeDetail(horoCard.dataset.horo); return; }

  // Member name / row opens profile
  const profName = t.closest('[data-profile]');
  if (profName && profName.dataset.profile) { openProfile(profName.dataset.profile); return; }

  // Relatives index card: open the full relations modal for that member
  const relOpen = t.closest('[data-rel-open]');
  if (relOpen && relOpen.dataset.relOpen) { openRelations(relOpen.dataset.relOpen); return; }

  // Relatives index toolbar
  if (t.closest('[data-riview]')) {
    const btn = t.closest('[data-riview]');
    localStorage.setItem('kielora_relidx_view', btn.dataset.riview);
    renderRelativesIndex();
    return;
  }
  if (t.closest('#btn-kindex-csv')) { exportKinIndexCSV(); return; }
  if (t.closest('#btn-kindex-print')) { window.print(); return; }
  if (t.closest('#btn-gap-fix')) {
    const g = dataGaps();
    if (g && g.first) openProfile(g.first.id);
    return;
  }
  const gapBirth = t.closest('[data-gap-birth]');
  if (gapBirth) { startEdit(gapBirth.dataset.gapBirth); return; }
  if (t.closest('#btn-gap-birth')) {
    const firstU = members.find(isBirthUnknown);
    if (firstU) startEdit(firstU.id);
    return;
  }

  // Node popup buttons
  if (t.dataset.editMember) { startEdit(t.dataset.editMember); removeNodePopup(); return; }
  if (t.dataset.deleteMember) { deleteMember(t.dataset.deleteMember); return; }
  if (t.dataset.focusTree) {
    removeNodePopup();
    treeFocusId = t.dataset.focusTree;
    switchTab('tree');
    return;
  }
  if (t.closest('[data-close-popup]')) { removeNodePopup(); return; }
  if (t.dataset.addRel) {
    const bits = t.dataset.addRel.split(':');
    quickAddRel(bits[0], bits[1]);
    return;
  }

  // Tree collapse/expand
  if (t.dataset.collapse) { treeCollapsed.add(t.dataset.collapse); buildTreeContent(); applyTransform(); return; }
  if (t.dataset.expand) { treeCollapsed.delete(t.dataset.expand); buildTreeContent(); applyTransform(); return; }

  // Tree toolbar buttons
  if (t.dataset.action === 'fit') { fitTreeToView(); return; }
  if (t.dataset.action === 'expand-all') { treeCollapsed.clear(); buildTreeContent(); applyTransform(); return; }
  if (t.dataset.action === 'collapse-all') { members.forEach(m => treeCollapsed.add(m.id)); buildTreeContent(); applyTransform(); return; }
  if (t.dataset.action === 'zoom-in') { scale = Math.min(5, scale * 1.2); applyTransform(); return; }
  if (t.dataset.action === 'zoom-out') { scale = Math.max(0.15, scale / 1.2); applyTransform(); return; }
  if (t.dataset.action === 'reset') { fitTreeToView(); return; }
  if (t.dataset.action === 'export-png') { exportTreeImage('png'); return; }
  if (t.dataset.action === 'export-pdf') { exportTreeImage('pdf'); return; }

  // Dashboard calendar navigation
  if (t.dataset.calNav) {
    dashMonthYear.m += parseInt(t.dataset.calNav, 10);
    if (dashMonthYear.m < 0) { dashMonthYear.m = 11; dashMonthYear.y--; }
    if (dashMonthYear.m > 11) { dashMonthYear.m = 0; dashMonthYear.y++; }
    api('/api/events/upcoming?days=120').then(data => {
      buildDashCalendar((data && data.events) || []);
    }).catch(() => {});
    return;
  }

  // Modal cancel
  if (t.closest('#btn-modal-cancel')) { closeModal(); return; }

  // Modal save (button click)
  if (t.closest('#btn-modal-save')) { saveMember(); return; }
  if (t.id === 'f-date-unknown') { toggleAgeMode(); return; }

  // Modal overlay click
  if (t.id === 'modal-overlay') { closeModal(); return; }

  // Children picker
  if (t.closest('#fc-trigger') && !$('children-overlay').classList.contains('show')) { openChildrenPopup(); return; }
  if (t.id === 'fc-add-member') { openAddModal(); return; }
  if (t.closest('#btn-children-cancel')) { closeChildrenPopup(); return; }

  // Members view mode toggle
  const vmBtn = t.closest('.view-mode-btn');
  if (vmBtn) {
    membersViewMode = vmBtn.dataset.viewMode;
    localStorage.setItem('kielora_members_view', membersViewMode);
    const tblWrap = $('tbl-wrap');
    const cards = $('members-cards');
    if (membersViewMode === 'cards') {
      if (tblWrap) tblWrap.style.display = 'none';
      if (cards) cards.style.display = 'grid';
    } else {
      if (tblWrap) tblWrap.style.display = '';
      if (cards) cards.style.display = 'none';
    }
    $('vm-list').classList.toggle('vm-active', membersViewMode === 'list');
    $('vm-cards').classList.toggle('vm-active', membersViewMode === 'cards');
    return;
  }

  // Avatar mode (photos / emoji)
  if (t.closest('#btn-avatar-mode')) {
    const cur = localStorage.getItem('kielora_member_photos') === 'emoji' ? 'emoji' : 'photo';
    const next = cur === 'photo' ? 'emoji' : 'photo';
    localStorage.setItem('kielora_member_photos', next);
    renderTableBody();
    const btn = $('btn-avatar-mode');
    if (btn) {
      btn.innerHTML = (next === 'emoji' ? '🖼️ ' : '👤 ') + (next === 'emoji' ? window.t('table.showPhotos') : window.t('table.showEmoji'));
      btn.title = next === 'emoji' ? window.t('table.showPhotos') : window.t('table.showEmoji');
    }
    return;
  }

  // Clear filters
  if (t.closest('#btn-clear-filters')) {
    ['filter-name', 'filter-family', 'filter-zodiac', 'filter-month', 'filter-relation', 'filter-deceased', 'filter-gender', 'filter-group'].forEach(id => {
      const el = $(id);
      if (el) el.value = '';
    });
    searchQ = '';
    loadMembers().then(() => renderTableBody());
    return;
  }

  // Member card click (view profile)
  const mcCard = t.closest('.member-card[data-id]');
  if (mcCard) { openProfile(mcCard.dataset.id); return; }
  if (t.closest('#btn-children-confirm')) { confirmChildrenPopup(); return; }
  if (t.id === 'children-overlay') { closeChildrenPopup(); return; }

  // Quick search
  if (t.id === 'quick-search-overlay') { closeQuickSearch(); return; }
  const qsAdd = t.closest('[data-qs-add]');
  if (qsAdd) {
    const prefill = $('quick-search-input').value.trim();
    closeQuickSearch();
    openAddModal({ name: prefill });
    return;
  }
  const qsItem = t.closest('.qs-item');
  if (qsItem && qsItem.dataset.qsId) {
    closeQuickSearch();
    startEdit(qsItem.dataset.qsId);
    return;
  }

  // Share overlay
  if (t.id === 'share-overlay') { $('share-overlay').classList.remove('show'); return; }
  if (t.closest('#share-gen-btn')) { generateShareLink(); return; }
  if (t.closest('#share-copy-btn')) { copyShareLink(); return; }
  if (t.closest('#share-revoke-btn')) { revokeShareLink(); return; }
  if (t.closest('#share-close-btn')) { $('share-overlay').classList.remove('show'); return; }

  // Export wizard
  if (t.id === 'export-wizard-overlay') { closeExportWizard(); return; }
  if (t.closest('#btn-export-cancel')) { closeExportWizard(); return; }
  if (t.closest('#btn-export-run')) { runExportWizard(); return; }

  // Settings buttons
  if (t.closest('#btn-save-password')) {
    const cur = $('s-current-password').value;
    const pass = $('s-password').value.trim();
    if (!cur) {
      showToast(window.t('toast.enterCurrentPassword'));
      return;
    }
    if (pass && pass.length >= 4) {
      api('/api/set-password', { method: 'POST', body: JSON.stringify({ password: pass, current: cur }) }).then(() => {
        showToast(window.t('toast.passwordChanged'));
        $('s-password').value = '';
        $('s-current-password').value = '';
      });
    } else {
      showToast(window.t('toast.passwordTooShort'));
    }
    return;
  }
  if (t.closest('#btn-share-generate')) {
    api('/api/share/generate', { method: 'POST' }).then(res => {
      $('settings-share-url').textContent = res.shareUrl;
      $('settings-share-url').style.display = 'block';
      $('btn-share-copy').style.display = 'inline-flex';
      $('btn-share-revoke').style.display = 'inline-flex';
      $('btn-share-generate').style.display = 'none';
    });
    return;
  }
  if (t.closest('#btn-share-copy')) {
    const url = $('settings-share-url').textContent;
    navigator.clipboard.writeText(url).then(() => showToast(window.t('toast.linkCopied'))).catch(() => showToast(window.t('toast.copyFailed')));
    return;
  }
  if (t.closest('#btn-net-copy')) {
    const url = ($('settings-net-url') || {}).textContent || '';
    navigator.clipboard.writeText(url).then(() => showToast(window.t('toast.linkCopied'))).catch(() => showToast(window.t('toast.copyFailed')));
    return;
  }
  if (t.closest('#btn-copy-donate')) {
    navigator.clipboard.writeText(DONATE_URL).then(() => showToast(window.t('toast.linkCopied'))).catch(() => showToast(window.t('toast.copyFailed')));
    return;
  }
  if (t.closest('#btn-share-revoke')) {
    api('/api/share/revoke', { method: 'POST' }).then(() => {
      showToast(window.t('toast.shareRevoked'));
      $('settings-share-url').style.display = 'none';
      $('btn-share-copy').style.display = 'none';
      $('btn-share-revoke').style.display = 'none';
      $('btn-share-generate').style.display = 'inline-flex';
    });
    return;
  }
  if (t.closest('#btn-s-export-csv')) { openExportWizard(); return; }
  if (t.closest('#btn-s-import-csv')) { $('csv-inp-s').click(); return; }
  if (t.closest('#btn-s-export-cal')) { exportCalendar(); return; }

  // Rename family
  if (t.closest('#btn-save-family-name')) {
    const name = $('s-family-name').value.trim();
    if (!name) { showToast(window.t('toast.enterFamilyName')); return; }
    api('/api/family/rename', { method: 'POST', body: JSON.stringify({ name }) }).then(res => {
      showToast(res.message || window.t('toast.familyRenamed'));
    });
    return;
  }

  // Family default birth place
  if (t.closest('#btn-save-defaults')) {
    const birthCountry = $('s-default-birth-country').value || '';
    const birthRegion = getSDefaultRegion();
    const curLang = window.i18n && window.i18n.current ? window.i18n.current() : 'en';
    const encoded = encodeRegion(birthRegion, curLang);
    api('/api/family/defaults', { method: 'POST', body: JSON.stringify({ birthCountry, birthRegion: encoded }) }).then(res => {
      if (res && (res.message || !res.error)) {
        FAMILY.birthCountry = birthCountry;
        FAMILY.birthRegion = birthRegion;
        showToast(res.message || window.t('settings.saveDefaults'));
        if (res.updated) {
          loadMembers().then(() => { renderCurrentView(); });
        }
      } else if (res && res.error) {
        showToast('❌ ' + res.error);
      }
    });
    return;
  }

  // Backup (full CSV snapshot -> goes through the multi-format export handler)
  if (t.closest('#btn-s-backup-table')) { openExportWizard(); return; }

  // Trash actions
  if (t.dataset.restore) {
    api('/api/members/' + t.dataset.restore + '/restore', { method: 'POST' }).then(() => {
      showToast(window.t('toast.restored'));
      renderAll();
    });
    return;
  }
  if (t.dataset.hardDelete) {
    askConfirm(window.t('confirm.hardDeleteFull')).then(ok => {
      if (!ok) return;
      api('/api/members/' + t.dataset.hardDelete + '?hard=1', { method: 'DELETE' }).then(() => {
        showToast(window.t('toast.hardDeleted'));
        renderAll();
      });
    });
    return;
  }
  if (t.closest('#btn-empty-trash')) {
    askConfirm(window.t('confirm.emptyTrash')).then(ok => {
      if (!ok) return;
      api('/api/trash/empty', { method: 'POST' }).then(() => {
        showToast(window.t('toast.trashEmptied'));
        renderAll();
      });
    });
    return;
  }

  // Photo buttons
  if (t.closest('#btn-pick-photo')) { openPhotoCrop(editingId || '', 'edit'); return; }
  if (t.closest('#btn-clear-photo')) { clearPhoto(); return; }
  if (t.id === 'photo-crop-pick') { pickCropFile(); return; }

  // Profile modal
  if (t.closest('#btn-profile-close')) { closeProfile(); return; }
  if (t.closest('#btn-profile-edit')) {
    const profId = $('profile-body').dataset.profileId;
    if (profId) { closeProfile(); removeNodePopup(); startEdit(profId); }
    return;
  }
  if (t.id === 'profile-overlay') { closeProfile(); return; }
  if (t.id === 'btn-profile-photo') { openPhotoCrop($('profile-body').dataset.profileId, 'profile'); return; }
  if (t.id === 'photo-crop-overlay') { closePhotoCrop(); return; }
  if (t.id === 'photo-crop-cancel') { closePhotoCrop(); return; }
  if (t.id === 'photo-crop-apply') { applyCrop(); return; }
  if (t.closest('[data-edit-profile]')) {
    const eid = t.closest('[data-edit-profile]').dataset.editProfile;
    if (eid) { closeProfile(); startEdit(eid); }
    return;
  }
  if (t.closest('[data-close-profile]')) { closeProfile(); return; }

  // Age feature modals (open)
  if (t.closest('#btn-agecalc')) { openAgeCalcModal(); return; }
  if (t.closest('#btn-agediff')) { openAgeDiffModal(); return; }
  if (t.closest('#btn-milestones')) { openMilestonesModal(); return; }
  if (t.closest('#btn-expectancy')) { openExpectancyModal(); return; }

  // Age calculator actions
  if (t.closest('#age-calc-close')) { closeAgeCalcModal(); return; }
  if (t.closest('#btn-age-calc-calc')) { calculateAge(); return; }
  if (t.closest('#age-diff-close')) { closeAgeDiffModal(); return; }
  if (t.closest('#btn-age-diff-calc')) { calculateAgeDiff(); return; }
  if (t.closest('#ms-close')) { closeMilestonesModal(); return; }
  if (t.closest('#btn-ms-load')) { loadMilestones(); return; }
  if (t.closest('#le-close')) { closeExpectancyModal(); return; }
  if (t.closest('#btn-le-calc')) { calculateExpectancy(); return; }

  // Age calc overlay click to close
  if (t.id === 'age-calc-overlay') { closeAgeCalcModal(); return; }
  if (t.id === 'age-diff-overlay') { closeAgeDiffModal(); return; }
  if (t.id === 'milestones-overlay') { closeMilestonesModal(); return; }
  if (t.id === 'expectancy-overlay') { closeExpectancyModal(); return; }
});

// Manual date typing in the age calculator clears a selected member override
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'age-calc-birthdate') {
    const mid = $('age-calc-member').value;
    if (mid) {
      const member = members.find(x => x.id === mid);
      if (member && e.target.value !== (member.birthDate || '')) {
        $('age-calc-member').value = '';
        const trig = $('ac-member-trigger');
        if (trig) {
          trig.innerHTML = '<span data-i18n="ageCalc.memberPlaceholder">— select a member —</span>';
          trig.dataset.value = '';
        }
      }
    }
  }
});

/* ═══════════════════════════════════════════════════════════════
   EVENT LISTENERS — Input events (not delegated via click)
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle
  const THEME_KEY = 'ft-theme';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('btn-theme').textContent = t === 'light' ? '🌙' : '☀️';
    try { localStorage.setItem(THEME_KEY, t); } catch(e){}
  }
  $('btn-theme')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
    if (currentTab === 'dashboard') { renderDashboard(); }
  });
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch(e){}
  applyTheme(savedTheme);

  // Load countries / regions / stage profiles for birth-place + life stages
  loadLifecycle();

  // Persist language changes to the server (survives app restarts).
  window.__famReadyLang = false;
  document.addEventListener('i18n:langchange', (ev) => {
    const code = ev && ev.detail && ev.detail.lang;
    if (!code || !window.__famReadyLang) return;
    persistLangToServer(code);
  });
  loadFamilyDefaults();

  // Global search (smart typeahead with live results on every tab)
  // NOTE: _sdIdx/_sdItems/closeSearchDrop are declared at top level.
  const sdBox = () => $('search-drop');
  function ensureSearchPool() {
    if (_searchAll) return Promise.resolve();
    return api('/api/members?groupBy=none').then(d => {
      _searchAll = (d && d.members && d.members.length) ? d.members : members.slice();
    }).catch(() => { _searchAll = members.slice(); });
  }
  const _KIN_HINTS = ['أبناء', 'ابناء', 'أولاد', 'اولاد', 'بنات', 'زوجة', 'زوجه', 'زوج', 'إخوة', 'اخوة', 'إخوان', 'اخوان', 'أخوات', 'اخوات', 'أشقاء', 'اشقاء', 'أب', 'اب ', 'والد', 'والدة', 'أم ', 'ام ', 'أحفاد', 'احفاد', 'أعمام', 'اعمام', 'أخوال', 'اخوال', 'أقارب', 'اقارب',
      'children of', 'sons of', 'daughters of', 'kids of', 'son of', 'daughter of',
      'wife of', 'husband of', 'spouse of', 'father of', 'mother of', 'parents of',
      'brother of', 'sister of', 'brothers of', 'sisters of', 'siblings of',
      'grandchildren of', 'relatives of', 'family of'];
  const _KIN_GRP = { children: 'child', spouse: 'spouse', parents: 'parent', siblings: 'sibling', grandchildren: 'grandchild', uncles: 'uncleaunt', relatives: 'x' };
  let _kinReadyQ = null, _kinRes = null, _kinBusy = false;
  function isKinPhrase(q) {
    return _KIN_HINTS.some(w => q.includes(w));
  }
  function kinFetch(q) {
    if (_kinBusy) return;
    _kinBusy = true;
    api('/api/relationship/query?q=' + encodeURIComponent(q)).then(res => {
      _kinBusy = false;
      _kinReadyQ = q; _kinRes = (res && res.kind !== 'plain') ? res : null;
      if ($('global-search') && isKinPhrase(($('global-search').value || '').trim())) renderSearchDrop();
    }).catch(() => { _kinBusy = false; _kinReadyQ = q; _kinRes = null; });
  }
  function kinKindLabel(kind) {
    if (kind === 'relatives') return t('kin.relatives');
    return t('rel.grp.' + (_KIN_GRP[kind] || 'unknown'));
  }
  function renderKinBlock(q) {
    if (!isKinPhrase(q)) return '';
    if (_kinReadyQ === q) {
      if (!_kinRes) return '';
      const res = _kinRes;
      if (!res.total) return '<div class="sd-kin sk-note">🧭 ' + esc(t('rel.idx.noMatch')) + '</div>';
      return '<div class="sd-kin">' +
        '<div class="sk-title">⚡ ' + esc(kinKindLabel(res.kind)) + ' <b>' + esc(res.query) + '</b></div>' +
        res.targets.map(tg => {
          const me = members.find(x => String(x.id) === String(tg.member.id));
          const chips = tg.relatives.map(r => {
            const rm = members.find(x => String(x.id) === String(r.id));
            return '<span class="ri-tag sk-chip" data-profile="' + esc(r.id) + '">' + (r.gender === 'female' ? '👩' : '👨') + ' <b>' + esc(r.name) + '</b></span>';
          }).join('');
          return '<div class="sk-who">' + (me ? memberAvatar(me) : (tg.member.gender === 'female' ? '👩' : '👨')) + ' <b>' + esc(tg.member.name) + '</b><span class="sk-tot">' + tg.count + '</span></div>' +
            (chips || '<span class="sk-zero">—</span>') +
            '<div style="margin-bottom:2px"></div>';
        }).join('') + '</div>';
    }
    if (isKinQueryLoadingAllowed(q)) return '<div class="sd-kin sk-load">🧭 ' + esc(t('kin.loading')) + '</div>';
    return '';
  }
  function isKinQueryLoadingAllowed(q) {
    if (_kinBusy) return false;
    kinFetch(q);
    return true;
  }
  function renderSearchDrop() {
    const box = sdBox(); if (!box) return;
    const input = $('global-search');
    const raw = input ? input.value : '';
    const q = raw.trim();
    if (!q) { box.innerHTML = '<div class="sd-empty">🔍 <b>' + t('search.typeHint') + '</b></div>'; box.classList.add('show'); _sdItems = []; _sdIdx = -1; return; }
    const nq = normAr(q);
    const kin = renderKinBlock(q);
    const pool = (_searchAll && _searchAll.length) ? _searchAll : members;
    const MONS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const MONS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MONS_UI = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map(km => t('months.' + km));
    const all = pool.map(m => {
      const bm = m.birthMonth >= 1 && m.birthMonth <= 12 ? m.birthMonth : 0;
      const fields = [
        { v: m.name, w: 3 }, { v: m.relation, w: 2 }, { v: m.occupation, w: 1 },
        { v: m.education, w: 1 }, { v: m.bloodType, w: 1 }, { v: m.location, w: 1 },
        { v: m.nationalId, w: 1 }, { v: m.phone, w: 1 }, { v: m.email, w: 1 },
        { v: m.birthRegion, w: 1 }, { v: m.birthDetail, w: 1 }, { v: m.notes, w: 1 }, { v: m.birthDate, w: 1 },
        { v: m.zodiac && m.zodiac.name, w: 1 }, { v: m.zodiac && m.zodiac.sym, w: 1 },
        { v: bm ? MONS_AR[bm - 1] : '', w: 1 }, { v: bm ? MONS_EN[bm - 1] : '', w: 1 }, { v: bm ? MONS_UI[bm - 1] : '', w: 1 }
      ];
      let best = -1;
      for (let f = 0; f < fields.length; f++) {
        const fs = fuzzyScore(nq.length < 3 ? q : nq, fields[f].v);
        if (fs < 0) continue;
        const s = fs + (fields[f].v === m.name ? (normAr(m.name).startsWith(nq) ? 1500 : 0) : 0);
        if (s > best) best = s + fields[f].w * 10;
      }
      return best >= 0 ? { m, best } : null;
    }).filter(Boolean).sort((a, b) => b.best - a.best).map(x => x.m);
    _sdItems = all.slice(0, 8); _sdIdx = Math.max(-1, Math.min(_sdIdx, _sdItems.length - 1));
    if (!all.length) {
      if (kin) { box.innerHTML = kin + '<div class="sd-empty">🔍 ' + esc(t('search.noResults')) + '</div>'; box.classList.add('show'); return; }
      box.innerHTML = '<div class="sd-empty">🔍 ' + esc(t('search.noResults')) + '</div>'; box.classList.add('show'); return;
    }
    const head = '<div class="sd-head">' + esc(t('search.resultsCount', { count: all.length })) + '</div>';
    box.innerHTML = (kin ? kin : '') + head + _sdItems.map((m, i) => {
      const meta = [];
      if (m.zodiac && m.zodiac.name) meta.push(m.zodiac.sym + ' ' + m.zodiac.name);
      if (m.relation) meta.push(relLabel(m.relation));
      const ay = ageYears(m);
      if (ay != null) meta.push(ay + ' ' + t('search.ageUnit'));
      if (m.location) meta.push(m.location);
      return '<div class="sd-item' + (i === _sdIdx ? ' sd-active' : '') + '" data-id="' + m.id + '">' +
        '<div class="sd-av">' + memberAvatar(m) + '</div>' +
        '<div style="flex:1;min-width:0"><div class="sd-name">' + hl(dispName(m), q) + '</div>' +
        '<div class="sd-meta">' + meta.map(esc).join(' · ') + '</div></div>' +
        '<span class="sd-go">👁️</span></div>';
    }).join('');
    box.classList.add('show');
  }
  function applySearchWherever(q) {
    searchQ = q;
    closeSearchDrop();
    if (currentTab === 'members') { loadMembers().then(renderTableBody); }
    else if (q) { switchTab('members').then(() => loadMembers().then(renderTableBody)); }
  }
  const $gs = $('global-search');
  if ($gs) {
    $gs.addEventListener('input', () => {
      searchQ = $gs.value;
      if (currentTab === 'members') {
        loadMembers().then(renderTableBody);
      }
      ensureSearchPool().then(renderSearchDrop);
    });
    $gs.addEventListener('focus', () => {
      ensureSearchPool().then(renderSearchDrop);
    });
    $gs.addEventListener('blur', () => { setTimeout(closeSearchDrop, 160); });
    $gs.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!_sdItems.length) return;
        e.preventDefault();
        _sdIdx += (e.key === 'ArrowDown' ? 1 : -1);
        if (_sdIdx >= _sdItems.length) _sdIdx = 0;
        if (_sdIdx < 0) _sdIdx = _sdItems.length - 1;
        renderSearchDrop();
      } else if (e.key === 'Enter') {
        if (_sdItems.length && _sdIdx >= 0) {
          e.preventDefault();
          const m = _sdItems[_sdIdx];
          $gs.value = ''; searchQ = ''; closeSearchDrop();
          if (currentTab === 'members') loadMembers().then(renderTableBody);
          openProfile(m.id);
        } else if (_sdItems.length) {
          e.preventDefault(); _sdIdx = 0; renderSearchDrop();
        } else {
          if (isKinPhrase(searchQ.trim())) { e.preventDefault(); renderSearchDrop(); return; }
          closeSearchDrop();
          applySearchWherever(searchQ.trim());
        }
      } else if (e.key === 'Escape') {
        closeSearchDrop();
      }
    });
  }

  // Relatives index live filter + sort (delegated: panel renders lazily)
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'rel-idx-q') applyRelIdxFilter();
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'rel-idx-sort') {
      localStorage.setItem('kielora_relidx_sort', e.target.value);
      applyRelIdxFilter();
    }
  });

  // Photo preview
  $('f-photo')?.addEventListener('change', previewPhotoHandler);

  // Age mode toggle
  $('f-age-mode')?.addEventListener('change', toggleAgeMode);

  // Live age/zodiac preview
  $('f-date')?.addEventListener('change', updateLivePreview);
  ['f-age-years', 'f-age-months', 'f-age-days'].forEach(id => {
    $(id)?.addEventListener('input', updateLivePreview);
  });
  // Clear preview when opening/closing modal
  $('f-age-mode')?.addEventListener('change', updateLivePreview);

  // Modal save on Enter
  $('modal-overlay')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveMember();
    }
  });

  // Children search
  $('fc-search')?.addEventListener('input', () => {
    const q = $('fc-search').value.trim().toLowerCase();
    const list = $('fc-list');
    list.querySelectorAll('[data-cp-label]').forEach(lbl => {
      const txt = lbl.textContent.toLowerCase();
      lbl.style.display = txt.includes(q) ? 'flex' : 'none';
    });
  });

  // Children check update
  $('fc-list')?.addEventListener('change', () => {
    updateChildrenCount();
  });

  // Quick search input
  $('quick-search-input')?.addEventListener('input', runQuickSearch);
  $('quick-search-input')?.addEventListener('keydown', quickSearchKeydown);

  // Quick search overlay close
  $('quick-search-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'quick-search-overlay') closeQuickSearch();
  });

  // Share overlay
  $('share-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'share-overlay') $('share-overlay').classList.remove('show');
  });

  // Children overlay
  $('children-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'children-overlay') closeChildrenPopup();
  });

  bindBulkChildren();

  // Modal overlay
  $('modal-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // CSV import from settings
  $('csv-inp-s')?.addEventListener('change', importCSV);

  // Table header sort (delegated)
  document.addEventListener('click', e => {
    const th = e.target.closest('thead th[data-sort]');
    if (th) {
      const col = th.dataset.sort;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = 1; }
      loadMembers().then(() => renderTableBody());
      $$('.sort-arrow').forEach(el => el.textContent = '');
      const arrowEl = $('sa-' + col);
      if (arrowEl) arrowEl.textContent = sortDir === 1 ? ' ▲' : ' ▼';
    }
  });

  // Table filters (delegated)
  document.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'filter-family' || id === 'filter-zodiac' || id === 'filter-gender' || id === 'filter-group' || id === 'filter-month' || id === 'filter-relation' || id === 'filter-deceased' || id === 'filter-name') {
      loadMembers().then(() => renderTableBody());
    }
  });

  // CSV import from sidebar
  $('csv-inp')?.addEventListener('change', importCSV);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeChildrenPopup();
      closeQuickSearch();
      closeProfile();
      $('share-overlay')?.classList.remove('show');
      closeExportWizard();
      removeNodePopup();
      closeSidebar();
      closeBulkChildren();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openQuickSearch(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); openAddModal(); }
  });

  // Sidebar close on window resize
  window.addEventListener('resize', () => {
    if (currentTab === 'tree') fitTreeToView();
    if (window.innerWidth > 768) closeSidebar();
  });

  // Tree zoom slider
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'tree-zoom') {
      scale = parseFloat(e.target.value) / 100;
      applyTransform();
    }
  });

  // Drag (pan) for tree
  window.addEventListener('mousemove', e => {
    if (!dragging || currentTab !== 'tree') return;
    pan.x = panStart.x + (e.clientX - dragStart.x);
    pan.y = panStart.y + (e.clientY - dragStart.y);
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Re-render language-dependent views when the language changes
  let i18nReadyBoot = true;
  document.addEventListener('i18n:ready', async () => {
    // First dispatch happens during page bootstrap; the initial render is
    // handled by renderAll() below, so skip it here.
    if (i18nReadyBoot) { i18nReadyBoot = false; return; }
    try { await loadLifecycle(); } catch (e) {}
    if (members.length) {
      try { await loadMembers(); } catch (e) {}
    }
    renderCurrentView();
  });
});

/* ═══════════════════════════════════════════════════════════════
   AGE CALCULATOR
   ═══════════════════════════════════════════════════════════════ */

function openAgeCalcModal() {
  $('age-calc-overlay').classList.add('show');
  $('age-calc-birthdate').max = new Date().toISOString().split('T')[0];
  $('age-calc-refdate').max = new Date().toISOString().split('T')[0];
  $('age-calc-refdate').value = '';
  $('age-calc-results').style.display = 'none';
  $('age-calc-member').value = '';

  const opts = members.filter(m => !m.isDeceased && hasRealBirth(m)).map(m => ({
    value: m.id,
    label: `👤 ${esc(dispName(m))} — ${m.birthDate}`
  }));
  makeSearchableSelect('ac-member-trigger', 'ac-member-drop', opts, val => {
    $('age-calc-member').value = val || '';
    const member = members.find(x => x.id === val);
    if (member && member.birthDate) {
      $('age-calc-birthdate').value = member.birthDate;
      const trigger = $('ac-member-trigger');
      trigger.innerHTML = '👤 ' + esc(dispName(member));
    }
  });
  const trig = $('ac-member-trigger');
  if (trig) {
    trig.innerHTML = '<span data-i18n="ageCalc.memberPlaceholder">— select a member —</span>';
    trig.dataset.value = '';
  }
  const birthInput = $('age-calc-birthdate');
  if (birthInput) birthInput.value = '';
  $('age-calc-country').value = 'دولي';
  $('age-calc-gender').value = 'male';
}

function closeAgeCalcModal() {
  $('age-calc-overlay').classList.remove('show');
}

async function calculateAge() {
  const birthDate = $('age-calc-birthdate').value;
  const refDate = $('age-calc-refdate').value;
  const country = $('age-calc-country').value;
  const gender = $('age-calc-gender').value;
  
  if (!birthDate) {
    showToast(t('toast.enterBirthDate'));
    return;
  }
  
  const params = new URLSearchParams({ birthDate, country, gender });
  if (refDate) params.set('refDate', refDate);
  
  const res = await api('/api/age/validate', { method: 'POST', body: JSON.stringify({ birthDate, refDate, country, gender }) });
  if (!res) return;
  
  if (res.valid) {
    showAgeCalcResults(res);
  } else {
    showToast('❌ ' + res.error);
  }
}

function showAgeCalcResults(res) {
  const r = $('age-calc-results');
  r.style.display = 'block';

  const age = res.age;
  $('age-exact').textContent = `${age.years} ${t('profile.year')}${listSep()}${age.months} ${t('profile.month')}${listSep()}${age.days} ${t('profile.day')}`;
  $('age-words').textContent = age.inWords;

  // Totals
  $('stat-total-days').textContent = (age.totalDays ?? 0).toLocaleString();
  $('stat-total-weeks').textContent = (age.totalWeeks ?? 0).toLocaleString();
  $('stat-total-months').textContent = (age.totalMonths ?? 0).toLocaleString();

  // Next birthday
  $('next-bday-date').textContent = age.nextBirthdayDate ? formatDateArabic(age.nextBirthdayDate) : '—';
  $('next-bday-days').textContent = age.nextBirthdayDays != null ? `${t('dashboard.eventIn')} ${age.nextBirthdayDays} ${t('table.daysUntil')}` : '—';
  $('next-age').textContent = age.nextAge ? `${t('ageCalc.willTurn')} ${age.nextAge} ${t('profile.year')}` : '';

  // Zodiac
  const z = res.zodiac || {};
  $('zodiac-sym').textContent = z.sym || '';
  $('zodiac-name').textContent = z.name || '';
  $('zodiac-element').textContent = t('ageCalc.element') + ' ' + (z.element || '—');
  $('zodiac-dates').textContent = z.dates || '';
  $('zodiac-traits').textContent = t('ageCalc.traits') + ' ' + (z.traits || []).join(listSep());

  // Hijri
  $('hijri-birth').textContent = res.hijriBirthDate || '—';
  $('hijri-age').textContent = res.hijriAgeYears != null ? res.hijriAgeYears + ' ' + t('profile.year') : '—';

  // Life percentage
  const lp = age.lifePercentage ?? 0;
  const pct = Math.min(100, Math.round(lp));
  $('life-percent-bar').style.width = pct + '%';
  $('life-percent-text').textContent = pct + '%';
  const remaining = age.nextAge ? Math.max(0, age.nextAge - age.years) : null;
  $('life-years-remaining').textContent = remaining != null ? '≈ ' + remaining + ' ' + t('ageCalc.remainingToNext') : '—';
}

async function openAgeDiffModal() {
  $('age-diff-overlay').classList.add('show');
  $('age-diff-results').style.display = 'none';
  
  const opts = members.filter(m => !m.isDeceased).map(m => ({
    value: m.id,
    label: `${esc(dispName(m))} (${ageYears(m) ?? '?'} ${t('profile.year')})`
  }));
  
  makeSearchableSelect('ad1-trigger', 'ad1-drop', opts);
  makeSearchableSelect('ad2-trigger', 'ad2-drop', opts);
}

function closeAgeDiffModal() {
  $('age-diff-overlay').classList.remove('show');
}

async function calculateAgeDiff() {
  const id1 = $('ad1-id').value;
  const id2 = $('ad2-id').value;
  
  if (!id1 || !id2) {
    showToast(t('toast.selectTwoMembers'));
    return;
  }
  
  if (id1 === id2) {
    showToast(t('toast.cannotCompare'));
    return;
  }
  
  const res = await api('/api/age/difference', {
    method: 'POST',
    body: JSON.stringify({ memberId1: id1, memberId2: id2 })
  });
  
  if (!res) return;

  const d = res.difference;
  $('age-diff-results').style.display = 'block';
  $('diff-main').textContent = `${d.years} ${t('profile.year')}${listSep()}${d.months} ${t('profile.month')}${listSep()}${d.days} ${t('profile.day')}`;
  $('diff-detail').textContent = `${t('ageDiff.total')} ${(d.totalDays || 0).toLocaleString()} ${t('table.daysUntil')}`;
  const olderName = d.whoIsOlderId === res.member1.id ? res.member1.name : res.member2.name;
  $('diff-older').textContent = `👴 ${t('ageDiff.older')} ${esc(olderName)}`;
  if (d.ageRatio === null || d.ageRatio === undefined) {
    $('diff-ratio').textContent = t('ageDiff.ratioUnknown');
  } else {
    $('diff-ratio').textContent = `${t('ageDiff.ratio')} ${d.ageRatio}:1`;
  }
}

async function openMilestonesModal() {
  $('milestones-overlay').classList.add('show');
  $('ms-results').style.display = 'none';
  
  const opts = members.map(m => ({
    value: m.id,
    label: `${esc(dispName(m))} (${ageYears(m) ?? '?'} ${t('profile.year')})${m.isDeceased ? ' ⚰️' : ''}`
  }));
  
  makeSearchableSelect('ms-trigger', 'ms-drop', opts);
}

function closeMilestonesModal() {
  $('milestones-overlay').classList.remove('show');
}

async function loadMilestones() {
  const id = $('ms-id').value;
  if (!id) {
    showToast(t('toast.selectOneMember'));
    return;
  }
  
  const res = await api('/api/age/milestones/' + id);
  if (!res) return;
  
  $('ms-results').style.display = 'block';
  const list = $('ms-list');
  list.innerHTML = res.milestones.map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:${m.isPassed ? 'rgba(52,211,153,.08)' : 'var(--s2)'};border:1px solid ${m.isPassed ? 'rgba(52,211,153,.2)' : 'var(--border)'};border-radius:10px;margin-bottom:8px;${m.isPassed ? 'opacity:0.7' : ''}">
      <div style="font-size:24px">${m.isPassed ? '✅' : '🎯'}</div>
      <div style="flex:1">
        <div style="font-weight:700">${esc(dispName(m))} - ${t('milestones.sessionName')} ${m.age}</div>
        <div style="font-size:12px;color:var(--muted)">${m.description}</div>
      </div>
      <div style="text-align:left;font-size:12px;color:${m.isPassed ? 'var(--green)' : 'var(--gold)'}">
        ${m.isPassed ? '✅ ' + t('milestones.passedOn') + ' ' + formatDateArabic(m.dateReached) : '⏳ ' + t('milestones.upcoming') + ' ' + m.daysUntil + ' ' + t('table.daysUntil')}
      </div>
    </div>
  `).join('');
}

function formatDateArabic(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const months = [t('months.jan'),t('months.feb'),t('months.mar'),t('months.apr'),t('months.may'),t('months.jun'),t('months.jul'),t('months.aug'),t('months.sep'),t('months.oct'),t('months.nov'),t('months.dec')];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function openExpectancyModal() {
  $('expectancy-overlay').classList.add('show');
  $('le-results').style.display = 'none';
  
  const opts = members.filter(m => !m.isDeceased).map(m => ({
    value: m.id,
    label: `${esc(dispName(m))} (${ageYears(m) ?? '?'} ${t('profile.year')})`
  }));
  
  makeSearchableSelect('le-trigger', 'le-drop', opts);
}

function closeExpectancyModal() {
  $('expectancy-overlay').classList.remove('show');
}

async function calculateExpectancy() {
  const id = $('le-id').value;
  const country = $('le-country').value;
  
  if (!id) {
    showToast(t('toast.selectOneMember'));
    return;
  }
  
  const res = await api('/api/age/expectancy/' + id + '?country=' + encodeURIComponent(country));
  if (!res) return;
  
  $('le-results').style.display = 'block';
  $('le-expectancy').textContent = res.lifeExpectancy.toFixed(1);
  $('le-remaining').textContent = res.yearsRemaining ? res.yearsRemaining.toFixed(1) : '—';
  $('le-percent-bar').style.width = res.percentageLived + '%';
  $('le-percent-text').textContent = res.percentageLived.toFixed(1) + '%';
  $('le-est-death').textContent = res.estimatedDeathDate ? '📅 ' + formatDateArabic(res.estimatedDeathDate) : '—';
}

async function openStatisticsModal() {
  const res = await api('/api/age/statistics');
  if (!res) return;
  
  showToast('📊 ' + t('toast.stats') + ' ' + t('toast.statsDetail', { total: res.total, week: res.this_week, next30: res.next_30_days }));
}

/* ═══════════════════════════════════════════════════════════════
   RELATIVES INDEX (whole-family direct-relative directory)
   ═══════════════════════════════════════════════════════════════ */
let _relIdxData = null;

async function renderRelativesIndex() {
  const con = $('view-relatives');
  if (!con) return;
  if (members.length === 0) {
    con.innerHTML = '<div class="empty-state"><div class="big">👪</div>' + t('table.emptyNoMembers') + '</div>';
    return;
  }
  ensureCatalogs();
  con.innerHTML = '<div class="rel-idx-top">' +
    '<div><div class="rel-idx-title">👪 ' + t('rel.familyTree') + '</div>' +
    '<div class="rel-idx-sub" id="rel-idx-count"></div></div>' +
    '<div id="rel-idx-q-wrap" style="flex:1;min-width:200px;display:flex;gap:8px;align-items:center">' +
    '<input id="rel-idx-q" class="rel-idx-q" placeholder="🔍 ' + t('rel.idx.search') + '" autocomplete="off">' +
    '</div>' +
    '<div id="pt-nav-wrap" class="pt-nav-wrap">' +
    '<button class="pt-nav" id="pt-prev" title="' + t('rel.prev') + '" onclick="ptNav(-1)">◀</button>' +
    '<select id="pt-pick" class="tbl-select pt-pick" title="' + t('rel.choosePerson') + '">' +
    members.map(m => '<option value="' + esc(m.id) + '">' + esc(dispName(m)) + '</option>').join('') +
    '</select>' +
    '<button class="pt-nav" id="pt-next" title="' + t('rel.next') + '" onclick="ptNav(1)">▶</button>' +
    '</div>' +
    '<span class="ri-tool">' +
    '<select id="rel-idx-sort" class="tbl-select" title="' + t('rel.idx.sortBy') + '">' +
    '<option value="name">↑ ' + t('rel.idx.sort.name') + '</option>' +
    '<option value="age">👴 ' + t('rel.idx.sort.age') + '</option>' +
    '<option value="added">🆕 ' + t('rel.idx.sort.added') + '</option></select>' +
    '<span class="ri-seg">' +
    '<button class="ri-seg-btn" data-riview="tree" title="' + t('rel.treeTab') + '">🌳</button>' +
    '<button class="ri-seg-btn" data-riview="persons" title="' + t('rel.directoryTab') + '">👤</button>' +
    '<button class="ri-seg-btn" data-riview="family" title="' + t('rel.directoryTab') + '">👨‍👩‍👧</button></span>' +
    '<button class="lm-btn" id="btn-kindex-csv" title="' + t('rel.idx.toolbar.csv') + '" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px">⬇️</button>' +
    '<button class="lm-btn" id="btn-kindex-print" title="' + t('rel.idx.toolbar.print') + '" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px">🖨️</button>' +
    '</span></div>' +
    '<div id="rel-tree"></div>' +
    '<div id="rel-idx-list" class="rel-idx-list"></div>';
  const saved = localStorage.getItem('kielora_relidx_view');
  const riView = (saved === 'family' || saved === 'persons' || saved === 'tree') ? saved : 'tree';
  const riSort = localStorage.getItem('kielora_relidx_sort') || 'name';
  const sortSel = $('rel-idx-sort');
  if (sortSel) sortSel.value = riSort;
  document.querySelectorAll('[data-riview]').forEach(b => b.classList.toggle('ri-seg-on', b.dataset.riview === riView));
  const isTree = riView === 'tree';
  const qWrap = $('rel-idx-q-wrap');
  if (qWrap) qWrap.style.display = isTree ? 'none' : 'flex';
  const navWrap = $('pt-nav-wrap');
  if (navWrap) navWrap.style.display = isTree ? 'flex' : 'none';
  let ptSel = localStorage.getItem('kielora_pt_person');
  if (!ptSel || !members.some(x => String(x.id) === String(ptSel))) {
    ptSel = members.length ? String(members[0].id) : '';
  }
  window._ptSel = ptSel;
  const pick = $('pt-pick');
  if (pick) pick.value = String(ptSel);
  const cnt = $('rel-idx-count');
  const treeHost = $('rel-tree');
  const listHost = $('rel-idx-list');
  if (treeHost) treeHost.style.display = isTree ? '' : 'none';
  if (listHost) listHost.style.display = isTree ? 'none' : '';
  if (isTree) {
    if (cnt) cnt.textContent = t('rel.relativeOfName', { name: (riById(ptSel) || {}).name || '' });
    await renderPersonalTree(ptSel);
  } else {
    await ensureRelIdx();
    await ensureCatalogs();
    applyRelIdxFilter();
  }
  if (pick) {
    pick.onchange = () => {
      const v = pick.value;
      window._ptSel = v;
      localStorage.setItem('kielora_pt_person', String(v));
      renderPersonalTree(v);
    };
  }
}

/* Enrich a parents list so both parents appear even when the backend only
   resolved one (e.g. father/mother known as the couple of the other parent). */
function enrichParentsList(subjId, parentsList) {
  if (!parentsList) return parentsList;
  const out = (parentsList || []).slice();
  const me = members.find(x => String(x.id) === String(subjId));
  const ids = out.map(p => String(p.id));
  const addParent = (id) => {
    if (!id) return;
    const m = members.find(x => String(x.id) === String(id));
    if (!m || ids.indexOf(String(id)) >= 0) return;
    if (me && (String(id) === String(me.id) || (me.spouseId && String(id) === String(me.spouseId)))) return;
    ids.push(String(id));
    out.push({ id: m.id, name: m.name, gender: m.gender });
  };
  out.slice().forEach(p => {
    const pm = members.find(x => String(x.id) === String(p.id));
    if (pm && pm.spouseId) addParent(pm.spouseId);
  });
  out.sort((a, b) => ((a.gender === 'male' ? 0 : 1) - (b.gender === 'male' ? 0 : 1)));
  return out;
}

async function ensureRelIdx() {
  if (_relIdxData || !members.length) return _relIdxData;
  try {
    _relIdxData = await api('/api/relatives-index');
    const recs = _relIdxData && _relIdxData.members;
    if (Array.isArray(recs)) recs.forEach(r => { r.parents = enrichParentsList(r.id, r.parents); });
  } catch (e) {
    _relIdxData = null;
  }
  return _relIdxData;
}

/* ── Personal family tree (tree view) ───────────────
   builds a compact 3-level tree of the selected member:
   L1 parents + siblings, L2 children, L3 grandchildren.
   ptExplore opens the profile too; ptNav scrolls people. */
function ptMember(id) { return members.find(x => String(x.id) === String(id)) || null; }

function ptSort(arr) {
  return sibSortMembers(arr);
}

function ptChildrenOf(m) {
  const out = [];
  const seen = new Set();
  const add = p => {
    if (!p) return;
    members.forEach(x => {
      if (String(x.parentId) === String(p.id) && !seen.has(String(x.id))) {
        seen.add(String(x.id));
        out.push(x);
      }
    });
  };
  add(m);
  add(ptMember(m.spouseId));
  return out;
}

function ptCardHtml(m, rel, gen, opts) {
  if (!m) return '';
  const isSelf = opts && opts.self;
  return '<div class="pt-card gen-' + (gen || 0) + (isSelf ? ' pt-self' : '') + '" data-pt="' + esc(m.id) + '" onclick="ptExplore(\'' + esc(m.id) + '\')" title="' + esc(t('rel.exploreHint')) + '" style="cursor:pointer">' +
    '<div class="photo">' + memberAvatar(m) + '</div>' +
    '<div class="pt-name">' + esc(dispName(m)) + (m.isDeceased ? ' ⚰️' : '') + '</div>' +
    '<span class="pt-rel">' + esc(rel || '') + '</span>' +
    '</div>';
}

function ptExplore(id) {
  localStorage.setItem('kielora_pt_person', String(id));
  const pp = $('pt-pick');
  if (pp) pp.value = String(id);
  renderPersonalTree(id);
  openProfile(id);
}

function ptNav(d) {
  let idx = members.findIndex(x => String(x.id) === String(window._ptSel));
  if (idx < 0) idx = 0;
  idx = (idx + d + members.length) % members.length;
  const nm = members[idx];
  if (nm) {
    window._ptSel = nm.id;
    localStorage.setItem('kielora_pt_person', String(nm.id));
    const pp = $('pt-pick');
    if (pp) pp.value = String(nm.id);
    renderPersonalTree(nm.id);
  }
}

async function renderPersonalTree(id) {
  const host = $('rel-tree');
  if (!host) return;
  const me = ptMember(id);
  if (!me) {
    host.innerHTML = '<div class="empty-state"><div class="big">👪</div>' + t('table.emptyNoMembers') + '</div>';
    return;
  }
  window._ptSel = me.id;
  localStorage.setItem('kielora_pt_person', String(me.id));
  const pick = $('pt-pick');
  if (pick && String(pick.value) !== String(me.id)) pick.value = String(me.id);
  const cnt = $('rel-idx-count');
  if (cnt) cnt.textContent = t('rel.relativeOfName', { name: me.name });

  /* Level 1 — parents & siblings */
  const parent = ptMember(me.parentId);
  let otherParent = parent ? ptMember(parent.spouseId) : null;
  if (otherParent && String(otherParent.id) === String(parent.id)) otherParent = null;
  const parents = [];
  [parent, otherParent].forEach(p => { if (p) parents.push(p); });
  const sibs = [];
  const sibSeen = new Set();
  parents.forEach(p => {
    ptSort(members).forEach(m => {
      if (String(m.parentId) === String(p.id) && !sibSeen.has(String(m.id))) {
        sibSeen.add(String(m.id));
        if (String(m.id) !== String(me.id)) sibs.push(m);
      }
    });
  });
  let lv1 = '<div class="pt-level pt-lv1">' +
    '<div class="pt-level-title">👪 ' + t('rel.ptParentsSiblings') + '</div>';
  if (parents.length === 0) {
    lv1 += '<div class="pt-empty">' + t('rel.noParents') + '</div>';
  } else {
    lv1 += '<div class="pt-couple">' + parents.map((p, i) =>
      (i > 0 ? '<span class="pt-heart">💞</span>' : '') +
      ptCardHtml(p, p.gender === 'female' ? t('rel.mother') : t('rel.father'), 0)
    ).join('') + '</div>' +
      '<div class="pt-vline"></div>';
  }
  const brothers = sibs.filter(x => x.gender !== 'female');
  const sisters = sibs.filter(x => x.gender === 'female');
  const buckets = [];
  if (brothers.length) buckets.push('<span class="pt-bucket"><span class="pt-tier-label">👬 ' + t('rel.brothers') + ' (' + brothers.length + ')</span>' +
    brothers.map(b => ptCardHtml(b, t('rel.brother'), 0)).join('') + '</span>');
  buckets.push('<span class="pt-bucket">' + ptCardHtml(me, t('rel.you'), 0, { self: true }) + '</span>');
  if (sisters.length) buckets.push('<span class="pt-bucket"><span class="pt-tier-label">👭 ' + t('rel.sisters') + ' (' + sisters.length + ')</span>' +
    sisters.map(s => ptCardHtml(s, t('rel.sister'), 0)).join('') + '</span>');
  lv1 += '<div class="pt-sibs">' + buckets.join('') +
    (brothers.length || sisters.length ? '' : '<div class="pt-empty">' + t('rel.noSiblings') + '</div>') +
    '</div></div>';

  /* Level 2 — children */
  const meSpouse = ptMember(me.spouseId);
  const kids = ptChildrenOf(me);
  let lv2 = '<div class="pt-level pt-lv2">' +
    '<div class="pt-level-title">👶 ' + t('rel.ptChildren') + ' <span class="pt-badge">' + kids.length + '</span></div>' +
    '<div class="pt-couple">' + ptCardHtml(me, t('rel.you'), 1, { self: true }) +
    (meSpouse ? '<span class="pt-heart">💞</span>' + ptCardHtml(meSpouse, meSpouse.gender === 'female' ? t('rel.wife') : t('rel.husband'), 1) : '') +
    '</div>';
  if (kids.length) {
    lv2 += '<div class="pt-vline"></div><div class="pt-kids">' +
      ptSort(kids).map(k => ptCardHtml(k, k.gender === 'female' ? t('rel.daughter') : t('rel.son'), 1)).join('') +
      '</div>';
  } else {
    lv2 += '<div class="pt-empty">' + t('rel.noChildren') + '</div>';
  }
  lv2 += '</div>';

  /* Level 3 — grandchildren, grouped per child branch */
  const gRows = ptSort(kids).map(k => ({ k, gs: ptChildrenOf(k) })).filter(r => r.gs.length);
  const totalG = gRows.reduce((s, r) => s + r.gs.length, 0);
  let lv3 = '<div class="pt-level pt-lv3">' +
    '<div class="pt-level-title">👧 ' + t('rel.ptGrandchildren') + ' <span class="pt-badge">' + totalG + '</span></div>';
  if (gRows.length) {
    lv3 += '<div class="pt-gkids-row">' + gRows.map(r =>
      '<div class="pt-gkid-col"><div class="pt-gkid-head">' +
      ptCardHtml(r.k, r.k.gender === 'female' ? t('rel.daughter') : t('rel.son'), 2) +
      '</div><div class="pt-gkid-row2">' +
      ptSort(r.gs).map(g => ptCardHtml(g, g.gender === 'female' ? t('rel.granddaughter') : t('rel.grandson'), 2)).join('') +
      '</div></div>').join('') + '</div>';
  } else {
    lv3 += '<div class="pt-empty">' + t('rel.noGrandchildren') + '</div>';
  }
  lv3 += '</div>';

  host.innerHTML = '<div class="pt-wrap">' + lv1 + lv2 + lv3 +
    '<div class="pt-hint" onclick="switchTab(\'tree\')" title="' + esc(t('rel.openFullTree')) + '" style="cursor:pointer">🧭 ' + esc(t('rel.openFullTree')) + '</div></div>';
}

function relIdxSort(rows) {
  const riSort = localStorage.getItem('kielora_relidx_sort') || 'name';
  if (riSort === 'age') {
    return rows.slice().sort((a, b) => {
      const am = riById(a.id), bm = riById(b.id);
      return (birthTxt(am) || '9999').localeCompare(birthTxt(bm) || '9999');
    });
  }
  if (riSort === 'added') {
    return rows.slice().sort((a, b) => {
      const am = riById(a.id), bm = riById(b.id);
      return String((bm && bm.createdAt) || '').localeCompare(String((am && am.createdAt) || ''));
    });
  }
  return rows.slice().sort((a, b) => {
    const am = riById(a.id), bm = riById(b.id);
    return String(am ? am.name : '').localeCompare(String(bm ? bm.name : ''), 'ar');
  });
}

function applyRelIdxFilter() {
  const list = $('rel-idx-list');
  if (!list) return;
  const qInput = $('rel-idx-q');
  const q = normAr(qInput ? qInput.value.trim() : '');
  const data = _relIdxData;
  const all = ((data && data.members) || []);
  const scopedIds = new Set(filterMembersByScope(FAMILY_SCOPE_FULL && FAMILY_SCOPE_FULL.length ? FAMILY_SCOPE_FULL : members).map(m => String(m.id)));
  const rows = all.filter(r => {
    const m = riById(r.id);
    return m && scopedIds.has(String(m.id)) && (!q || normAr(m.name).includes(q));
  });
  const cnt = $('rel-idx-count');
  if (cnt) cnt.textContent = t('rel.idx.searchHint', { all: (data && data.count) || 0, n: rows.length });
  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><div class="big">🔍</div>' + (q ? t('rel.idx.noMatch') : t('rel.emptyRelatives')) + '</div>';
    return;
  }
  const riView = localStorage.getItem('kielora_relidx_view') === 'family' ? 'family' : 'persons';
  const ordered = relIdxSort(rows);
  list.innerHTML = (riView === 'family' ? ordered.map(r => riFamilyCard(r)) : ordered.map(r => riCard(r))).join('');
}

function riFamilyCard(r) {
  const me = riById(r.id);
  if (!me) return '';
  const parts = [];
  const sp = (r.spouses && r.spouses[0]) ? riById(r.spouses[0].member.id) : null;
  // children across the couple
  const kids = (r.children || []).slice();
  const spKids = sp ? (_relIdxData.members.find(x => String(x.id) === String(sp.id)) || { children: [] }).children || [] : [];
  const allKids = [];
  const seenK = new Set();
  kids.concat(spKids).forEach(c => { if (!seenK.has(c.id)) { seenK.add(c.id); allKids.push(c); } });
  const sibKids = sibSortMembers(allKids.map(c => riById(c.id) || { id: c.id, gender: c.gender }));
  const kidChips = sibKids.map(c => riChip(c.id, (c.gender || riById(c.id).gender) === 'female' ? '👩' : '👨')).join('');
  if (allKids.length) parts.push(riGroup(t('rel.children') + ' (' + allKids.length + ')', '👶', kidChips));
  const fam = r.parents && r.parents.length ? r.parents.map(p => riChip(p.id, p.gender === 'female' ? '👵' : '👴')).join('') : '';
  if (r.siblings && r.siblings.length) parts.push(riGroup(t('rel.siblings') + ' (' + r.siblings.length + ')', '👬', sibSortMembers(r.siblings.map(s => riById(s.member.id))).map(s => riChip(s.id, '')).join('')));
  else if (fam) parts.push(riGroup(t('rel.parents'), '👪', fam));
  const heads = '<div class="ri-head">' +
    '<span class="ri-av" data-profile="' + esc(r.id) + '" style="cursor:pointer">' + memberAvatar(me) + '</span>' +
    '<div class="ri-name" data-profile="' + esc(r.id) + '" style="cursor:pointer">' + hl(me.name, ($('rel-idx-q') || {}).value || '') + (me.isDeceased ? ' ⚰️' : '') + '</div>' +
    (sp ? '<span class="ri-link">💞</span><span class="ri-av" data-profile="' + esc(sp.id) + '" style="cursor:pointer">' + memberAvatar(sp) + '</span>' +
      '<div class="ri-name" data-profile="' + esc(sp.id) + '" style="cursor:pointer">' + hl(sp.name, ($('rel-idx-q') || {}).value || '') + (sp.isDeceased ? ' ⚰️' : '') + '</div>' : '') +
    '<button class="ri-rel-link" data-rel-open="' + esc(r.id) + '" title="' + t('rel.openRel') + '">🔗</button>' +
    '</div>';
  return '<div class="ri-card ri-fam">' + heads + (parts.join('') || '<div class="ri-none">—</div>') + '</div>';
}

function riById(id) { return members.find(x => String(x.id) === String(id)); }

function riChip(id, icon) {
  const p = riById(id);
  if (!p) return '';
  return '<span class="ri-tag" data-profile="' + esc(p.id) + '">' + icon + ' <b>' + hl(p.name, ($('rel-idx-q') || {}).value || '') + '</b>' + (p.isDeceased ? ' ⚰️' : '') + '</span>';
}

function riGroup(label, icon, chips) {
  if (!chips) return '';
  return '<div class="ri-g"><span class="ri-k">' + icon + ' ' + label + '</span><span class="ri-v">' + chips + '</span></div>';
}

function riCard(r) {
  const me = riById(r.id);
  if (!me) return '';
  const parts = [];
  if (r.parents && r.parents.length) {
    const chips = r.parents.map(p => riChip(p.id, p.gender === 'female' ? '👵' : '👴')).join('');
    parts.push(riGroup(t('rel.parents'), '👪', chips));
  }
  if (r.spouses && r.spouses.length) {
    const chips = r.spouses.map(s => {
      const p = riById(s.member.id);
      if (!p) return '';
      const lbl = s.member.gender === 'female' ? t('rel.wife') : t('rel.husband');
      return '<span class="ri-tag" data-profile="' + esc(p.id) + '">💍 ' + esc(lbl) + ': <b>' + hl(p.name, ($('rel-idx-q') || {}).value || '') + '</b>' +
        (s.kind && s.kind !== 'spouse' ? ' <span class="ri-kind">' + esc(relLabel(s.kind)) + '</span>' : '') + '</span>';
    }).join('');
    parts.push(riGroup(t('rel.spouses'), '💍', chips));
  }
  if (r.children && r.children.length) {
    const chips = sibSortMembers(r.children.map(c => riById(c.id))).map(c => riChip(c.id, c.gender === 'female' ? '👩' : '👨')).join('');
    parts.push(riGroup(t('rel.children') + ' (' + r.children.length + ')', '👶', chips));
  }
  if (r.siblings && r.siblings.length) {
    const chips = sibSortMembers(r.siblings.map(s => riById(s.member.id))).map(s => {
      const sr = r.siblings.find(x => String(x.member.id) === String(s.id));
      return '<span class="ri-tag" data-profile="' + esc(s.id) + '">👬 <b>' + hl(s.name, ($('rel-idx-q') || {}).value || '') + '</b>' +
        (sr && sr.kind && sr.kind !== 'full' ? ' <span class="ri-kind">' + esc(relLabel(sr.kind)) + '</span>' : '') + '</span>';
    }).join('');
    parts.push(riGroup(t('rel.siblings') + ' (' + r.siblings.length + ')', '👬', chips));
  }
  return '<div class="ri-card">' +
    '<div class="ri-head">' +
    '<span class="ri-av" data-profile="' + esc(r.id) + '" style="cursor:pointer">' + memberAvatar(me) + '</span>' +
    '<div class="ri-name" data-profile="' + esc(r.id) + '" style="cursor:pointer">' + hl(me.name, ($('rel-idx-q') || {}).value || '') +
      (me.isDeceased ? ' ⚰️' : '') + '</div>' +
    (me.relation ? '<span class="ri-reltag">' + esc(relLabel(me.relation)) + '</span>' : '') +
    '<button class="ri-rel-link" data-rel-open="' + esc(r.id) + '" title="' + t('rel.openRel') + '">🔗</button>' +
    '</div>' +
    (parts.join('') || '<div class="ri-none">—</div>') +
    '</div>';
}

function exportKinIndexCSV() {
  if (!_relIdxData) return;
  const escCsv = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const safeCell = v => {
    const s = String(v == null ? '' : v);
    if (s && (s[0] === '=' || s[0] === '+' || s[0] === '@' || s[0] === '\t' || s[0] === '\r')) return "'" + s;
    return s;
  };
  const lines = [[t('table.colName'), t('rel.parents'), t('rel.spouses'), t('rel.children'), t('rel.siblings')].map(escCsv).join(',')];
  (_relIdxData.members || []).forEach(r => {
    const me = riById(r.id);
    lines.push([escCsv(safeCell(me ? me.name : r.id)),
      escCsv(safeCell((r.parents || []).map(p => p.name).join(' | '))),
      escCsv(safeCell((r.spouses || []).map(s => s.member.name).join(' | '))),
      escCsv(safeCell((r.children || []).map(c => c.name).join(' | '))),
      escCsv(safeCell((r.siblings || []).map(s => s.member.name).join(' | ')))
    ].join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = t('download.relativesCsv') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  showToast(t('toast.exportedCsv'));
}

function dataGaps() {
  const FIELDS = [
    ['photoPath', 'gap.photo', '📷'], ['phone', 'gap.phone', '📱'], ['email', 'gap.email', '✉️'],
    ['birthDate', 'gap.birthDate', '🎂'], ['occupation', 'gap.occupation', '💼'], ['education', 'gap.education', '🎓'],
    ['nationalId', 'gap.nationalId', '🪪'], ['location', 'gap.location', '📍']
  ];
  const count = {};
  let n = 0; let first = null;
  members.forEach(m => {
    let miss = false;
    FIELDS.forEach(([f]) => {
      const empty = !m[f] || !String(m[f]).trim();
      if (empty) {
        miss = true;
        count[f] = (count[f] || 0) + 1;
        if (!first) first = m;
      }
    });
    if (miss) n++;
  });
  const chips = FIELDS.filter(([f]) => count[f]).map(([f, k, ic]) =>
    '<span class="gap-chip">' + ic + ' ' + t(k) + ' <b>' + count[f] + '</b></span>').join('');
  return { n, chips, first };
}

/* ═══════════════════════════════════════════════════════════════
   PHASE E - RELATIONSHIPS & KINSHIP
   ═══════════════════════════════════════════════════════════════ */
let relSubjectId = null;
let relDeclaredCache = [];

const REL_TYPES = ["mother", "father", "spouse", "former_spouse", "partner", "sibling", "half_sibling", "twin", "biological_parent", "adoptive_parent", "legal_parent", "biological_child", "adopted_child", "step_parent", "step_child", "foster_parent", "guardian", "custom", "unknown"];

function relName(id) { const m = members.find(x => String(x.id) === String(id)); return m ? dispName(m) : '…'; }

function relSel(selId, selected) {
  return '<select id="' + selId + '" style="flex:1;min-width:140px;padding:7px 9px;border:1px solid var(--border2);border-radius:8px;background:var(--s3);color:var(--text);font-family:inherit;font-size:12px">' +
    '<option value="">' + t('rel.choosePerson') + '</option>' +
    members.map(m => '<option value="' + esc(m.id) + '"' + (String(m.id) === String(selected) ? ' selected' : '') + '>' + esc(dispName(m)) + '</option>').join('') +
    '</select>';
}

function openRelations(id) {
  if (!id) return;
  relSubjectId = id;
  $('rel-overlay').classList.add('show');
  setRelTab('relatives');
}
function closeRelations() { $('rel-overlay').classList.remove('show'); }

function setRelTab(tab) {
  document.querySelectorAll('#rel-tabs .rel-tab').forEach(b => b.classList.toggle('active', b.dataset.reltab === tab));
  renderRelTab(tab);
}

async function renderRelTab(tab) {
  const body = $('rel-body');
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    ensureCatalogs();
    if (tab === 'relatives') body.innerHTML = await relRelatives();
    else if (tab === 'path') body.innerHTML = relPathForm();
    else if (tab === 'branches') body.innerHTML = await relBranches();
    else if (tab === 'declared') body.innerHTML = await relDeclared();
    if (i18n && i18n.translateAll) i18n.translateAll(body);
  } catch (e) {
    body.innerHTML = '<div class="rel-empty">⚠️ ' + esc(e.message) + '</div>';
  }
}

function relMember(id) { return members.find(x => String(x.id) === String(id)) || null; }
function relSpouseOf(id) { const m = relMember(id); return m && m.spouseId ? relMember(m.spouseId) : null; }
function relIsSib(a, b) {
  const A = relMember(a), B = relMember(b);
  if (!A || !B || String(A.id) === String(B.id)) return false;
  return !!(A.parentId && B.parentId && String(A.parentId) === String(B.parentId));
}
function inlawKey(egoId, targetId) {
  /*Precise client-side kinship classifier for in-law pairs.
     The compiled backend only ever emits rel.sisterInLaw/brotherInLaw/
inLawGeneral (or the spouse's brother/sister) for every in-law edge; here we compute
     the exact Arabic term from the real family graph:
- sibling of EGO's SPOUSE  → the spouse's brother/sister (wifeSister …)
- spouse of EGO's SIBLING → the brother's wife / the sister's husband (wifeOfBrother …)
- spouse of EGO's SPOUSE's SIBLING → the brothers' wives (wives of brothers) /
the sisters' husbands (husbands of sisters) when both ends share one gender.
     Returns a 'rel.*' key, or null when not a precise in-law pair. */
  const ego = relMember(egoId), tgt = relMember(targetId);
  if (!ego || !tgt) return null;
  const spouse = relSpouseOf(egoId);
  if (spouse && relIsSib(spouse.id, targetId)) {
    const male = tgt.gender === 'male';
    return male ? (spouse.gender === 'male' ? 'rel.husbandBrother' : 'rel.wifeBrother')
                : (spouse.gender === 'male' ? 'rel.husbandSister' : 'rel.wifeSister');
  }
  for (const s of members) {
    if (relIsSib(egoId, s.id) && s.spouseId && String(s.spouseId) === String(targetId))
      return s.gender === 'male' ? 'rel.wifeOfBrother' : 'rel.husbandOfSister';
  }
  if (spouse) {
    for (const s of members) {
      if (relIsSib(spouse.id, s.id) && s.spouseId && String(s.spouseId) === String(targetId)) {
        if (ego.gender === 'female' && tgt.gender === 'female') return 'rel.salifa';
        if (ego.gender === 'male' && tgt.gender === 'male') return 'rel.salf';
        return null;
      }
    }
  }
  return null;
}
function relInlawFix(path, idx) {
  /* Backend graph mislabels every in-law reached via the LAST spouse-edge as
     "the SUBJECT's spouse-sibling" (rel.sisterInLaw / rel.brotherInLaw -> "the
     spouse's sister/brother"). When the in-law path node is really the
     subject's own sibling's spouse (Subject --sibling--> Sibling --spouse-->
     In-law => "the brother's wife") or one of the other precise cases above,
     inlawKey() supplies the exact localized term. Returns the corrected
     localized label, or null when not applicable. */
  if (!path || idx <= 0) return null;
  const cur = path[idx];
  if (!cur || cur.relationGroup !== 'inlaw') return null;
  const k = inlawKey(path[0].id, cur.id);
  return k ? t(k) : null;
}
function relNephewFix(p) {
  /*The server often sends "nephew/niece" without specifying which side of the sibling pair,
so "the brother's son" can even appear for a sister's children. We take the side from the
previous step of the path, then choose the correct detailed key from the catalogue (rel.nephewSister = the sister's son …).*/
  if (!p || !p.path || p.path.length < 2) return null;
  const last = p.path[p.path.length - 1];
  const lk = last && last.relation;
  if (lk !== 'nephew' && lk !== 'niece') return null;
  const side = relSibSide(p.path[p.path.length - 2]);
  const code = (lk === 'nephew' ? 'nephew' : 'niece') + (side === 'sister' ? 'Sister' : 'Brother');
  const k = 'rel.' + code, v = t(k);
  return (v && v !== k) ? v : null;
}
function relSibSide(m) {
  if (!m || !m.relation) return 'brother';
  const r = String(m.relation);
  return (r === 'sister' || r === 'أخت' || r === 'Sister' || r.includes('sister')) ? 'sister' : 'brother';
}
function relTopFix(p) {
  const path = p && p.path;
  if (!path || path.length < 2) return null;
  const lf = relInlawFix(path, path.length - 1);
  if (lf) return lf;
  return relNephewFix(p);
}
function relChain(path) {
  if (!path || !path.length) return '';
  return '<div class="rel-path">' + path.map((n, i) => {
    const fixRel = relInlawFix(path, i);
    const rel = fixRel != null ? fixRel : (n.relation || '');
    return (i > 0 ? '<span class="rel-arrow">←</span>' : '') +
      '<div class="rel-node" onclick="openProfile(\'' + esc(n.id) + '\')">' +
      (n.gender === 'female' ? '👩' : '👨') +
      '<div class="rn-name">' + esc(n.name) + '</div>' +
      '<div class="rn-rel">' + esc(relLabel(rel)) + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

async function relRelatives() {
  const d = await api('/api/relationship/branches/' + relSubjectId);
  if (!d || !d.found) return '<div class="rel-empty">' + t('rel.emptyRelatives') + '</div>';
  if (d.parents) d.parents = enrichParentsList(relSubjectId, d.parents);
  const cards = (arr, tag) => (arr && arr.length)
    ? '<div style="margin-bottom:8px">' + arr.filter(x => x.member && String(x.member.id) !== String(relSubjectId)).map(x =>
        '<div class="rel-card">' +
        (x.member.gender === 'female' ? '👩' : '👨') +
        '<div class="rc-name">' + esc(x.member.name) + '</div>' +
        '<span class="rc-tag">' + tag + (x.kind ? ' · ' + esc(relLabel(x.kind)) : '') + '</span>' +
        '<div class="rel-actions">' +
        '<button class="mini-btn" onclick="relExpandPath(\'' + esc(x.member.id) + '\')">🧭 ' + t('rel.expand') + '</button>' +
        '<button class="mini-btn" onclick="openProfile(\'' + esc(x.member.id) + '\')">👤</button>' +
        '</div><div class="rel-path-box" data-relpath="' + esc(x.member.id) + '" style="width:100%;display:none"></div>' +
        '</div>').join('') + '</div>'
    : '';
  const genChips = (arr) => (arr && arr.length)
    ? '<div style="margin-bottom:8px">' + arr.filter(x => x.member && String(x.member.id) !== String(relSubjectId)).map(x =>
        '<div class="rel-card"><div class="rc-name">' + esc(x.member.name) + '</div><span class="rc-tag">' + t('rel.generation', { n: x.gen || 1 }) + '</span>' +
        '<div class="rel-actions"><button class="mini-btn" onclick="relExpandPath(\'' + esc(x.member.id) + '\')">🧭 ' + t('rel.expand') + '</button></div>' +
        '<div class="rel-path-box" data-relpath="' + esc(x.member.id) + '" style="width:100%;display:none"></div></div>').join('') + '</div>'
    : '';
  return '<div class="rel-answer"><div style="font-size:12px;color:var(--muted)">' + t('rel.relativeOf') + '</div><div class="ra-label" style="font-size:17px">' + esc(relName(relSubjectId)) + '</div></div>' +
    (d.parents && d.parents.length ? '<div class="rel-sec-title">👪 ' + t('rel.parents') + '</div>' + cards(d.parents.map(p => ({ member: p, gen: 1 })), '') : '') +
    (d.children && d.children.length ? '<div class="rel-sec-title">👶 ' + t('rel.children') + '</div>' + cards(d.children.map(p => ({ member: p, gen: 1 })), '') : '') +
    (d.siblings && d.siblings.length ? '<div class="rel-sec-title">👬 ' + t('rel.siblings') + '</div>' + cards(d.siblings, t('rel.grp.sibling')) : '') +
    (d.spouses && d.spouses.length ? '<div class="rel-sec-title">💍 ' + t('rel.spouses') + '</div>' + cards(d.spouses, t('rel.grp.spouse')) : '') +
    (d.ancestors && d.ancestors.length ? '<div class="rel-sec-title">🌳 ' + t('rel.ancestors') + '</div>' + genChips(d.ancestors) : '') +
    (d.descendants && d.descendants.length ? '<div class="rel-sec-title">🌱 ' + t('rel.descendants') + '</div>' + genChips(d.descendants) : '');
}

async function relExpandPath(id) {
  const box = document.querySelector('[data-relpath="' + id + '"]');
  if (!box) return;
  if (!box.dataset.loaded) {
    box.dataset.loaded = '1';
    const r = await api('/api/relationship/path?a=' + relSubjectId + '&b=' + id);
    await ensureCatalogs();
    box.innerHTML = r && r.found ? relChain(r.path) : '<div style="font-size:11px;color:var(--muted)">' + t('rel.noPath') + '</div>';
  }
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function relPathForm() {
  return '<div class="rel-form">' +
    '<div class="frow"><label>' + t('rel.personA') + '</label>' + relSel('path-a', relSubjectId) + '</div>' +
    '<div class="frow"><label>' + t('rel.personB') + '</label>' + relSel('path-b', '') + '</div>' +
    '<div class="frow"><button class="m-save" style="flex:none;padding:9px 24px" onclick="relCalc()">🧭 ' + t('rel.calculate') + '</button></div>' +
    '</div><div id="rel-path-result"></div>';
}

async function relCalc() {
  const a = $('path-a').value, b = $('path-b').value;
  const out = $('rel-path-result');
  if (!out) return;
  if (!a || !b) { out.innerHTML = '<div class="rel-empty">' + t('rel.resultEmpty') + '</div>'; return; }
  if (a === b) { out.innerHTML = '<div class="rel-empty">' + t('rel.samePerson') + '</div>'; return; }
  out.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const p = await api('/api/relationship/path?a=' + a + '&b=' + b);
  const c = await api('/api/relationship/consanguinity?a=' + a + '&b=' + b);
  if (!p && !c) { out.innerHTML = '<div class="rel-empty">⚠️</div>'; return; }
  await ensureCatalogs();
  out.innerHTML = relPathResult(p, c, relName(a), relName(b));
  if (i18n && i18n.translateAll) i18n.translateAll(out);
}

function relPathResult(p, c, na, nb) {
  const topFix = relTopFix(p);
  const label = p && p.found ? esc(relLabel(topFix != null ? topFix : p.label)) : esc(t('rel.noPathSr'));
  return '<div class="rel-answer">' +
    '<div style="font-size:12px;color:var(--muted)">' + esc(na) + ' ↔ ' + esc(nb) + '</div>' +
    '<div class="ra-label">' + label + '</div>' +
    (p && p.found ? relChain(p.path) : '') +
    '</div>' +
    (c && c.found ? relConsang(c) : (p && p.found ? '' : '<div class="rel-empty">' + t('rel.noPath') + '</div>'));
}

function relConsang(c) {
  const collapse = c.pedigreeCollapse || {};
  const common = c.commonAncestors || [];
  return '<div class="rel-sec-title">🔬 ' + t('rel.consanguinityTab') + '</div>' +
    '<div class="rel-grid">' +
    '<div class="rel-stat"><div class="rs-num">' + c.coefficientOfRelationship + '</div><div class="rs-lab">' + t('rel.coefficientRelation') + '</div></div>' +
    '<div class="rel-stat"><div class="rs-num">' + c.coefficientOfInbreeding + '</div><div class="rs-lab">' + t('rel.coefficientInbreeding') + '</div></div>' +
    '<div class="rel-stat"><div class="rs-num">' + (collapse.uniqueCount || 0) + ' / ' + (collapse.theoreticalMax || '…') + '</div><div class="rs-lab">' + t('rel.pedigreeCollapse') + '</div></div>' +
    '</div>' +
    '<div class="rel-sec-title">👴 ' + t('rel.commonAncestors') + '</div>' +
    (common.length
      ? common.map(ca => '<div class="rel-card"><div class="rc-name">' + esc(ca.member.name) + '</div><div class="rc-tag">' + t('rel.generation', { n: (ca.genA || 0) + (ca.genB || 0) }) + '</div></div>').join('')
      : '<div class="rel-empty" style="padding:12px;text-align:start">' + t('rel.commonAncestorNone') + '</div>') +
    '<div class="rel-sec-title">⚠️ ' + t('rel.limitationsTitle') + '</div>' +
    '<div style="font-size:11px;color:var(--muted);line-height:1.9">' +
    '• ' + t('rel.notMedical') + '<br>' +
    '• ' + t('rel.hypotheticalOffspring') + '<br>' +
    '• ' + t('rel.ancestorsOnly', { n: c.maxGenerations }) +
    '</div>';
}

async function relBranches() {
  const d = await api('/api/relationship/branches/' + relSubjectId);
  if (!d || !d.found) return '<div class="rel-empty">' + t('rel.branchEmpty') + '</div>';
  const chips = (arr, skipSelf) => {
    const list = (arr || []).filter(x => x.member && String(x.member.id) !== String(relSubjectId));
    if (!list.length) return '<div class="rel-empty" style="padding:8px">' + t('rel.branchEmpty') + '</div>';
    return '<div class="rel-branch-group">' + list.map(x =>
      '<div class="rel-branch-chip" onclick="openProfile(\'' + esc(x.member.id) + '\')"><b>' + esc(x.member.name) + '</b><span>' + t('rel.generation', { n: (x.gen || 0) }) + '</span></div>').join('') + '</div>';
  };
  return '<div class="rel-answer"><div style="font-size:12px;color:var(--muted)">' + esc(relName(relSubjectId)) + '</div><div class="ra-label" style="font-size:16px">🌿 ' + t('rel.tabBranches') + '</div></div>' +
    '<div class="rel-sec-title">🌳 ' + t('rel.paternalBranch') + '</div>' + chips(d.paternalBranch) +
    '<div class="rel-sec-title">🌳 ' + t('rel.maternalBranch') + '</div>' + chips(d.maternalBranch) +
    (d.spouseBranches && d.spouseBranches.length
      ? d.spouseBranches.map(sb => '<div class="rel-sec-title">💍 ' + t('rel.spouseBranch') + ' — ' + esc(sb.member.name) + '</div>' + chips(sb.ancestors)).join('')
      : '') +
    '<div class="rel-sec-title">📶 ' + t('rel.generations') + ' — ' + (d.maxDescGen || 0) + '</div>';
}

async function relDeclared() {
  const d = await api('/api/relationships?member=' + relSubjectId);
  const rows = (d && d.relationships) || [];
  relDeclaredCache = rows;
  const addBtn = '<button class="mini-btn" onclick="relAddForm()">➕ ' + t('rel.addDeclared') + '</button>';
  const one = r =>
    '<div class="rel-decl-row">' +
    '<div class="rc-name">' + esc(relName(r.personAId)) + '</div>' +
    '<span class="rel-arrow">⇄</span>' +
    '<div class="rc-name">' + esc(relName(r.personBId)) + '</div>' +
    '<span class="rd-type">' + esc(t('relType.' + r.relType)) + '</span>' +
    (r.startDate ? '<span class="rd-meta">📅 ' + esc(r.startDate) + '</span>' : '') +
    (r.endDate ? '<span class="rd-meta">→ ' + esc(r.endDate) + '</span>' : '') +
    '<span class="rd-meta">🔒 ' + esc(t('conf.' + r.confidence)) + '</span>' +
    '<div class="rel-actions">' +
    '<button class="mini-btn" onclick="relEditForm(\'' + esc(r.id) + '\')">✏️ ' + t('rel.edit') + '</button>' +
    '<button class="mini-btn danger" onclick="relDelete(\'' + esc(r.id) + '\')">🗑️ ' + t('rel.delete') + '</button>' +
    '</div></div>';
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<div style="font-size:12px;color:var(--muted)">' + t('rel.declaredTitle') + ' (' + rows.length + ')</div>' + addBtn + '</div>' +
    '<div id="rel-decl-form"></div>' +
    (rows.length ? rows.map(one).join('') : '<div class="rel-empty">' + t('rel.noDeclared') + '</div>');
}

function relTypeForm(id, r) {
  const C = $('rel-decl-form');
  C.innerHTML = '<div class="rel-form">' +
    '<div class="frow"><label>' + t('rel.personA') + '</label>' + relSel('rd-a', r ? r.personAId : relSubjectId) + '</div>' +
    '<div class="frow"><label>' + t('rel.personB') + '</label>' + relSel('rd-b', r ? r.personBId : '') + '</div>' +
    '<div class="frow"><label>' + t('rel.relationType') + '</label><select id="rd-type">' + REL_TYPES.map(k => '<option value="' + k + '"' + (r && r.relType === k ? ' selected' : '') + '>' + esc(t('relType.' + k)) + '</option>').join('') + '</select></div>' +
    '<div class="frow"><label>' + t('rel.periodStart') + '</label><input type="date" id="rd-start" value="' + (r ? (r.startDate || '') : '') + '"><label>' + t('rel.periodEnd') + '</label><input type="date" id="rd-end" value="' + (r ? (r.endDate || '') : '') + '"></div>' +
    '<div class="frow"><label>' + t('rel.confidence') + '</label><select id="rd-conf">' + ['unverified', 'low', 'medium', 'high'].map(cv => '<option value="' + cv + '"' + (r && r.confidence === cv ? ' selected' : '') + '>' + esc(t('conf.' + cv)) + '</option>').join('') + '</select></div>' +
    '<div class="frow"><label>' + t('rel.notes') + '</label><input type="text" id="rd-notes" value="' + (r ? esc(r.notes || '') : '') + '" placeholder="' + t('rel.notes') + '"></div>' +
    '<div class="frow">' +
    '<button class="m-save" style="flex:none;padding:8px 22px" onclick="relSave(' + (id ? "'" + esc(id) + "'" : 'null') + ')">💾 ' + t('rel.save') + '</button>' +
    '<button class="m-cancel" style="flex:none;padding:8px 22px" onclick="$(\'rel-decl-form\').innerHTML=\'\'">' + t('rel.cancel') + '</button>' +
    '</div></div>';
  if (i18n && i18n.translateAll) i18n.translateAll(C);
}
function relAddForm() { relTypeForm(null, null); }
function relEditForm(id) { const r = relDeclaredCache.find(x => String(x.id) === String(id)); relTypeForm(id, r || null); }

async function relSave(id) {
  const A = $('rd-a').value, B = $('rd-b').value;
  const payload = {
    person_a_id: A,
    person_b_id: B,
    rel_type: $('rd-type').value,
    start_date: $('rd-start').value || null,
    end_date: $('rd-end').value || null,
    confidence: $('rd-conf').value,
    notes: $('rd-notes').value.trim()
  };
  if (!A || !B || A === B) { showToast(t('rel.resultEmpty')); return; }
  try {
    if (id) await api('/api/relationships/' + id, { method: 'PUT', body: payload });
    else await api('/api/relationships', { method: 'POST', body: payload });
    showToast(t('rel.relationshipSaved'));
    renderRelTab('declared');
  } catch (e) { showToast('❌ ' + e.message); }
}
async function relDelete(id) {
  if (!(await askConfirm(t('rel.delete') + '?'))) return;
  api('/api/relationships/' + id, { method: 'DELETE' }).then(() => { showToast(t('rel.relationshipDeleted')); renderRelTab('declared'); });
}

document.addEventListener('click', function (e) {
  const tabBtn = e.target.closest ? e.target.closest('[data-reltab]') : null;
  if (tabBtn) setRelTab(tabBtn.dataset.reltab);
  if (e.target.id === 'btn-profile-relations' || (e.target.closest && e.target.closest('#btn-profile-relations'))) { openRelations($('profile-body').dataset.profileId); return; }
  if (e.target.id === 'btn-rel-close' || (e.target.closest && e.target.closest('#btn-rel-close'))) { closeRelations(); return; }
  if (e.target.id === 'rel-overlay') { closeRelations(); return; }
});

/* ═══════════════════════════════════════════════════════════════
   GLOBAL ERROR HANDLER - prevents WebView2 blank page
   ═══════════════════════════════════════════════════════════════ */
window.onerror = function(msg, src, line, col, err) {
  console.error('Global error:', msg, src, line, col);
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  console.error('Unhandled rejection:', e.reason);
  e.preventDefault();
});

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */
function loadFamilyName() {
  api('/api/family/info').then(info => {
    const el = $('header-family');
    if (el && info) el.textContent = '🏠 ' + info.name;
  }).catch(() => {});
}

requestNotifyPermission();
checkBirthdayNotifications();
setInterval(checkBirthdayNotifications, 3600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBirthdayNotifications(); });
loadFamilyName();

renderAll().catch(e => {
  console.error('Init error:', e);
  var con = document.getElementById('view-dashboard');
  if (con) con.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)"><div style="font-size:48px;margin-bottom:12px">⚠️</div><div style="font-size:18px">' + t('dashboard.loadError') + '</div><div style="font-size:13px;margin-top:10px">' + t('dashboard.connectionError') + '</div><button onclick="renderAll()" style="margin-top:16px;padding:8px 20px;background:var(--gold);color:var(--gold2);border:none;border-radius:8px;font-family:Tajawal;font-weight:700;cursor:pointer">' + t('dashboard.retry') + '</button></div>';
});
