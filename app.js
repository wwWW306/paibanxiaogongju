// === Config ===
const SB_URL = "https://nxuniihlcmraawjezqom.supabase.co";
const SB_KEY = "sb_publishable_8wR9_VTz090zgdrVYVHoRA_KZvSjiBf"; 
const RESEND_KEY = "re_CQVGQ6VG_8TbGXSknerauM4TjCmU1apyY";
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;

// === App State ===
let _USER = null;
let _PROFILE = null;
let _SHOP = null;
let _ROLE = null; 
let _DB = {
  config: {workDays:['周一','周二','周三','周四','周五'], shifts:[], maxShiftsPerDay:1},
  emps: [],
  tt: {},
  sched: {assignments:{}, overrides:{}, at:''},
  notifs: []
};

// === Router ===
const Router = {
  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  },
  async handleRoute() {
    const hash = window.location.hash || '#/login';
    const { data: { session } } = await sb.auth.getSession();
    
    if (!session && hash !== '#/login') {
      window.location.hash = '#/login';
      return;
    }
    
    if (session) {
      _USER = session.user;
      await this.syncProfile();
      
      if (hash === '#/login') {
        if (!_PROFILE.shop_id) window.location.hash = '#/onboarding';
        else window.location.hash = `#/shop/${_PROFILE.shop_id}`;
        return;
      }

      if (!_PROFILE.shop_id && !hash.includes('onboarding') && !hash.includes('settings')) {
        window.location.hash = '#/onboarding';
        return;
      }
    }

    const parts = hash.replace('#/', '').split('/');
    const route = parts[0] || 'login';
    const param = parts[1];
    
    this.showView(route, param);
  },
  async syncProfile() {
    const { data } = await sb.from('profiles').select('*').eq('id', _USER.id).single();
    if (data) {
      _PROFILE = data;
      _ROLE = data.role;
    } else {
      const name = _USER.email ? _USER.email.split('@')[0] : '用户';
      const gender = _USER.user_metadata?.gender || '男';
      const { data: newP } = await sb.from('profiles').insert([{ id: _USER.id, email: _USER.email, name: name, gender: gender }]).select().single();
      _PROFILE = newP;
    }
  },
  showView(name, param) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${name}`);
    if (el) {
      el.classList.add('active');
      if (name === 'shop') Shop.init(param);
      if (name === 'settings') Settings.init();
    }
  }
};

// === Auth ===
const Auth = {
  async handleAuth(mode) {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return toast('请填写邮箱和密码', 'error');
    if (password.length < 6) return toast('密码长度至少为 6 位', 'error');

    try {
      let res;
      if (mode === 'signup') {
        const genderEl = document.getElementById('signupGender');
        const gender = genderEl ? genderEl.value : '男';
        res = await sb.auth.signUp({ email, password, options: { data: { gender } } });
        if (res.error) throw res.error;
        toast('注册成功！正在自动登录...', 'success');
      } else {
        res = await sb.auth.signInWithPassword({ email, password });
        if (res.error) throw res.error;
      }

      if (res.data.user) {
        _USER = res.data.user;
        await Router.handleRoute();
      }
    } catch (err) {
      console.error("Auth Error:", err);
      let msg = err.message;
      if (msg.includes('rate limit')) msg = '请求太频繁，请稍后再试';
      if (msg.includes('Invalid login credentials')) msg = '邮箱或密码错误';
      if (msg.includes('User already registered')) msg = '该邮箱已注册，请直接登录';
      toast(msg, 'error');
    }
  },
  async logout() {
    await sb.auth.signOut();
    _USER = null; _PROFILE = null; _SHOP = null;
    window.location.hash = '#/login';
  }
};

// === Onboarding ===
const Onboarding = {
  async createShop() {
    const name = document.getElementById('newShopName').value;
    if (!name) return toast('请输入店名','error');
    const invite_code = Math.random().toString().slice(2, 8); 
    const { data: shop, error: shopErr } = await sb.from('shops').insert([{ name: name, boss_id: _USER.id, invite_code: invite_code }]).select().single();
    if (shopErr) throw shopErr;
    
    await sb.from('profiles').update({ shop_id: shop.id, role: 'boss' }).eq('id', _USER.id);
    window.location.hash = `#/shop/${shop.id}`;
  },
  async joinShop() {
    const code = document.getElementById('inviteCode').value;
    if (!code) return toast('请输入邀请码','error');
    const { data: shop } = await sb.from('shops').select('*').eq('invite_code', code).single();
    if (!shop) return toast('邀请码无效','error');
    
    await sb.from('profiles').update({ shop_id: shop.id, role: 'employee' }).eq('id', _USER.id);
    await sb.from('pb_employees').upsert([{ id: _USER.id, name: _PROFILE.name || '员工', email: _USER.email, shop_id: shop.id, gender: _PROFILE.gender || '男', position: '' }], {onConflict: 'id'});
    
    window.location.hash = `#/shop/${shop.id}`;
  },
  async updateProfile() {
    const name = document.getElementById('profileName').value;
    await sb.from('profiles').update({ name }).eq('id', _USER.id);
    await sb.from('pb_employees').update({ name }).eq('id', _USER.id);
    toast('保存成功','success');
  }
};

// === Shop ===
const Shop = {
  async init(id) {
    if (!id || id !== _PROFILE.shop_id) {
      await Router.syncProfile();
      if (!_PROFILE.shop_id) return window.location.hash = '#/onboarding';
    }
    
    const { data: shop } = await sb.from('shops').select('*').eq('id', _PROFILE.shop_id).single();
    _SHOP = shop;
    document.getElementById('shopTitle').textContent = shop.name;
    
    // Admin Toggle
    const isAdmin = _USER.email === 'admin@test.com' || _USER.email === 'superadmin@test.com' || _USER.email === '1420251964@qq.com';
    const headerActions = document.querySelector('.header-actions');
    if (isAdmin && !document.getElementById('adminToggle')) {
      const btn = document.createElement('button');
      btn.id = 'adminToggle';
      btn.className = 'header-btn';
      btn.innerHTML = '🔄';
      btn.title = '切换老板/员工视角';
      btn.onclick = () => {
        _ROLE = (_ROLE === 'boss' ? 'employee' : 'boss');
        Shop.render();
      };
      headerActions.prepend(btn);
    }
    
    await this.render();
  },
  async render() {
    const container = document.getElementById('shopContent');
    const nav = document.getElementById('shopNav');

    if (_ROLE === 'boss') {
      nav.style.display = 'none';
      container.innerHTML = `
        <div class="top-tabs">
          <button class="top-tab active" onclick="UI.switchBossTab('b-schedule')">📅 排班表</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-config')">⚙️ 班次定义</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-employees')">👥 员工管理</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-status')">📋 状态</button>
        </div>
        <div class="tab-content active" id="b-schedule">
          <div class="status-bar"><div id="bossStatus">员工已选: <span id="bossPickCount">0</span></div></div>
          <div class="card" id="bossGrid"></div>
        </div>
        <div class="tab-content" id="b-config">
          <div class="card-actions-bar" style="display:flex;gap:10px;margin-bottom:15px;padding:0 4px">
             <button class="btn btn-primary btn-sm" style="flex:2" onclick="Boss.publish()">🚀 发布并应用新排班</button>
             <button class="btn btn-outline btn-sm" style="flex:1" onclick="Boss.saveAllShifts()">💾 仅存模板</button>
          </div>
          <div class="card"><h2>工作日设置</h2><div class="checkbox-group" id="workDayChecks"></div></div>
          <div class="card">
            <h2>已定义的班次 <span style="font-size:12px;color:#888;font-weight:400">(修改后需点击发布)</span></h2>
            <div id="shiftCfgList"></div>
          </div>
          <div class="card">
            <h2>➕ 新增班次</h2>
            <div class="form-group"><label>班次名称</label><input id="cfgName" placeholder="例如：早班、晚班"/></div>
            <div class="form-row mb-10">
              <div style="flex:1"><label>开始时间</label><input type="time" id="cfgStart"/></div>
              <div style="flex:1"><label>结束时间</label><input type="time" id="cfgEnd"/></div>
              <div style="flex:1"><label>每班所需人数</label><input type="number" id="cfgNeed" value="1" min="1" placeholder="每个班几个人"/></div>
            </div>
            <div class="form-group"><label>所需职位 <span style="font-size:11px;color:#999;font-weight:400">(留空则不限制)</span></label><input id="cfgPosition" placeholder="例如：前台、后厨、服务员"/></div>
            <button class="btn btn-primary btn-block" onclick="Boss.addShift()">➕ 加入班次列表</button>
          </div>

        </div>
        <div class="tab-content" id="b-employees">
          <div class="card"><h2>团队成员</h2><ul class="emp-list" id="empMgmtList"></ul></div>
          <div class="card mt-20"><h3>邀请码: <strong style="color:var(--primary-color)">${_SHOP.invite_code}</strong></h3><p style="font-size:12px;color:#999">员工注册后输入此代码即可加入。</p></div>
        </div>
        <div class="tab-content" id="b-status">
           <div class="card"><h2>提交状态</h2><div id="subStatusList"></div></div>
        </div>
      `;
      Boss.init();
    } else {
      nav.style.display = 'flex';
      container.innerHTML = `
        <div class="tab-content active" id="emp-select">
          <h2 style="font-size:1rem;margin-bottom:12px">📋 可选班次</h2>
          <p class="card-hint">点击班次即可选择，每人每天限选一个班次</p>
          <div id="shiftSelectList"></div>
        </div>
        <div class="tab-content" id="emp-schedule">
          <h2 style="font-size:1rem;margin-bottom:12px">📅 我的班表</h2>
          <div id="myShiftCards"></div>
        </div>
        <div class="tab-content" id="emp-messages">
          <h2 style="font-size:1rem;margin-bottom:12px">📨 消息中心</h2>
          <div class="card" id="notifList"></div>
        </div>
      `;
      await S.fetchAll();
      EmpShift.render();
      EmpSchedule.render();
      EmpMsg.render();
    }
  }
};

// === Settings ===
const Settings = {
  init() {
    document.getElementById('profileName').value = _PROFILE.name || '';
    document.getElementById('currentShopIdDisplay').textContent = _PROFILE.shop_id || '--';
    document.getElementById('currentInviteCodeDisplay').textContent = _SHOP ? _SHOP.invite_code : '--';
    const leaveCard = document.getElementById('leaveShopCard');
    if (leaveCard) leaveCard.style.display = (_PROFILE.shop_id && _ROLE === 'employee') ? 'block' : 'none';
  }
};

// === Shop Management (leave / remove) ===
const ShopMgmt = {
  async leaveShop() {
    if (!confirm('确定要退出当前店铺吗？退出后需要重新输入邀请码才能加入。')) return;
    await sb.from('pb_employees').delete().eq('id', _USER.id).eq('shop_id', _PROFILE.shop_id);
    await sb.from('pb_tt').delete().eq('emp_id', _USER.id).eq('shop_id', _PROFILE.shop_id);
    await sb.from('profiles').update({ shop_id: null, role: null }).eq('id', _USER.id);
    _PROFILE.shop_id = null; _ROLE = null; _SHOP = null;
    toast('已退出店铺', 'success');
    window.location.hash = '#/onboarding';
  },
  async removeMember(empId, empName) {
    if (!confirm('确定要将 "' + empName + '" 移出店铺吗？')) return;
    await sb.from('pb_employees').delete().eq('id', empId).eq('shop_id', _PROFILE.shop_id);
    await sb.from('pb_tt').delete().eq('emp_id', empId).eq('shop_id', _PROFILE.shop_id);
    await sb.from('profiles').update({ shop_id: null, role: null }).eq('id', empId);
    await S.fetchAll();
    Boss.renderEmpList();
    Boss.renderGrid();
    toast(empName + ' 已被移出店铺', 'success');
  }
};

// === Data Store ===
const S = {
  async fetchAll() {
    if(!_PROFILE.shop_id) return;
    const sid = _PROFILE.shop_id;
    const {data: cfg} = await sb.from('pb_config').select('data').eq('shop_id', sid).single();
    _DB.config = cfg ? cfg.data : {workDays:['周一','周二','周三','周四','周五'], shifts:[], maxShiftsPerDay:1};
    const {data: emps} = await sb.from('pb_employees').select('*').eq('shop_id', sid);
    _DB.emps = emps || [];
    const {data: tts} = await sb.from('pb_tt').select('*').eq('shop_id', sid);
    _DB.tt = {};
    if(tts) tts.forEach(t => { _DB.tt[t.emp_id] = {busy: t.busy_data, submitted: t.submitted} });
    const {data: sch} = await sb.from('pb_sched').select('*').eq('shop_id', sid).single();
    _DB.sched = sch ? {assignments: sch.assignments || {}, overrides: sch.overrides || {}, at: sch.updated_at} : {assignments:{}, overrides:{}, at:''};
    const {data: ns} = await sb.from('pb_notifs').select('*').eq('shop_id', sid).order('created_at', {ascending: false});
    _DB.notifs = ns || [];
  },
  async saveCfg(c) {
    const { error } = await sb.from('pb_config').upsert({shop_id: _PROFILE.shop_id, data: c}, {onConflict: 'shop_id'});
    if (error) { console.error('saveCfg Error:', error); throw error; }
  },
  async saveTT(id, t) {
    const { error } = await sb.from('pb_tt').upsert({emp_id: id, shop_id: _PROFILE.shop_id, busy_data: t.busy, submitted: t.submitted, updated_at: new Date()}, {onConflict: 'emp_id,shop_id'});
    if (error) { console.error('saveTT Error:', error); throw error; }
  },
  async saveSched(assignments) {
    const { error } = await sb.from('pb_sched').upsert(
      { shop_id: _PROFILE.shop_id, assignments, updated_at: new Date() },
      { onConflict: 'shop_id' }
    );
    if (error) { console.error('saveSched Error:', error); throw error; }
  },
  async saveOv(overrides) {
    const { error } = await sb.from('pb_sched').upsert({shop_id: _PROFILE.shop_id, overrides, updated_at: new Date()}, {onConflict: 'shop_id'});
    if (error) { console.error('saveOv Error:', error); throw error; }
  },
  async addNotif(to, text, type, data) {
    const { data: res } = await sb.from('pb_notifs').insert([{to_id: to, shop_id: _PROFILE.shop_id, text, type, data}]).select().single();
    if (res) {
      const emp = _DB.emps.find(e => e.id === to);
      if (emp && emp.email) this.sendEmail(emp.email, "新通知", text);
    }
  },
  async sendEmail(to, subject, text) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'onboarding@resend.dev', to: [to], subject, html: `<p>${text}</p>` })
      });
    } catch(e) {}
  }
};

// === Scheduling Algorithm ===
function getAvailStatus(tt, day, sid) {
  // 只有提交了课表的员工才参与排班。未提交的默认为 busy (不能来)
  if(!tt || !tt.submitted) return 'busy';
  const b = tt.busy[day];
  if(!b) return 'available';
  if(!Array.isArray(b)) return b[sid] || 'available';
  return b.includes(sid) ? 'busy' : 'available';
}

async function autoSchedule() {
  console.log('--- Starting Auto-Schedule ---');
  const c = _DB.config, emps = _DB.emps;
  if(!c.shifts.length || !emps.length) {
    console.warn('AutoSchedule: No shifts or employees found.');
    return;
  }
  
  try {
    const asgn = {};
    const weekTotal = {};
    emps.forEach(e => weekTotal[e.id] = 0);

    c.workDays.forEach(day => {
      asgn[day] = {};
      c.shifts.forEach(sh => {
        const required = parseInt(sh.required) || 1;
        // 1. 筛选 (Layer 1): 可用 + 职位匹配 (员工未设职位则不限制)
        const cands = emps.filter(e => {
          if (getAvailStatus(_DB.tt[e.id], day, sh.id) === 'busy') return false;
          if (sh.position && e.position && e.position !== sh.position) return false;
          return true;
        });

        // 2. 排序 (Layer 2)
        cands.sort((a, b) => {
          const statA = getAvailStatus(_DB.tt[a.id], day, sh.id);
          const statB = getAvailStatus(_DB.tt[b.id], day, sh.id);
          if (statA === 'available' && statB === 'late') return -1;
          if (statA === 'late' && statB === 'available') return 1;
          return weekTotal[a.id] - weekTotal[b.id];
        });

        // 3. 选取 (Layer 3)
        const picked = cands.slice(0, required).map(e => e.id);
        asgn[day][sh.id] = picked;
        picked.forEach(id => weekTotal[id]++);
      });
    });

    console.log('Generated assignments:', asgn);
    await S.saveSched(asgn);
    toast('自动排班已完成', 'success');
  } catch (err) {
    console.error('AutoSchedule critical error:', err);
    toast('自动排班失败: ' + err.message, 'error');
  }
}

// === Boss Logic ===
const Boss = {
  async init() { await S.fetchAll(); this.renderWorkDays(); this.renderShiftList(); this.renderEmpList(); this.renderGrid(); this.renderStatus(); },
  renderWorkDays() {
    const all=['周一','周二','周三','周四','周五','周六','周日'], c=_DB.config;
    document.getElementById('workDayChecks').innerHTML = all.map(d => `<label><input type="checkbox" value="${d}" ${c.workDays.includes(d)?'checked':''} onchange="Boss.save()"/> ${d}</label>`).join('');
  },
  async save() {
    _DB.config.workDays = [...document.querySelectorAll('#workDayChecks input:checked')].map(i => i.value);
    await S.saveCfg(_DB.config);
    this.renderGrid();
  },
  async addShift() {
    const n = document.getElementById('cfgName').value;
    const s = document.getElementById('cfgStart').value;
    const e = document.getElementById('cfgEnd').value;
    const r = parseInt(document.getElementById('cfgNeed').value) || 1;
    const p = document.getElementById('cfgPosition').value.trim();

    if(!n||!s||!e) return toast('请完整填写信息','error');

    _DB.config.shifts.push({id: 's'+Date.now(), name:n, start:s, end:e, required: r, position: p});
    await S.saveCfg(_DB.config);
    this.renderShiftList();
    this.renderGrid();
    toast('已加入待发布列表','info');
  },
  async removeShift(id) {
    if (!confirm('确定要删除这个班次吗？')) return;
    _DB.config.shifts = _DB.config.shifts.filter(s => s.id !== id);
    await S.saveCfg(_DB.config);
    this.renderShiftList();
    this.renderGrid();
  },
  renderShiftList() {
    const el = document.getElementById('shiftCfgList');
    if (!_DB.config.shifts.length) { el.innerHTML = '<p class="empty">尚未定义班次</p>'; return; }
    el.innerHTML = _DB.config.shifts.map(s => {
      return '<div class="card" style="margin-bottom:8px;padding:12px">'
        + '<div class="form-row" style="margin-bottom:8px">'
        + '<div style="flex:2"><label>名称</label><input data-sid="'+s.id+'" data-field="name" value="'+s.name+'"/></div>'
        + '<div style="flex:1"><label>开始</label><input type="time" data-sid="'+s.id+'" data-field="start" value="'+s.start+'"/></div>'
        + '<div style="flex:1"><label>结束</label><input type="time" data-sid="'+s.id+'" data-field="end" value="'+s.end+'"/></div>'
        + '<div style="flex:1"><label>每班人数</label><input type="number" min="1" data-sid="'+s.id+'" data-field="required" value="'+(s.required||1)+'"/></div>'
        + '<div style="flex:1"><label>所需职位</label><input data-sid="'+s.id+'" data-field="position" value="'+(s.position||'')+'" placeholder="不限"/></div>'
        + '<div style="flex:0;align-self:flex-end"><button class="btn btn-danger btn-sm" onclick="Boss.removeShift(\''+s.id+'\')">删除</button></div>'
        + '</div></div>';
    }).join('');
  },
  renderEmpList() {
    document.getElementById('empMgmtList').innerHTML = _DB.emps.map(e => {
      const g = e.gender || '?';
      const p = e.position || '未设置';
      return '<li>'
        + '<span>' + e.name + ' <small>' + g + '</small> <small style="color:#888">' + e.email + '</small></span>'
        + '<span style="display:flex;align-items:center;gap:6px">'
        + '<input value="' + p + '" data-emp-id="' + e.id + '" placeholder="职位" style="width:80px;padding:4px 8px;font-size:12px" onchange="Boss.setPosition(\'' + e.id + '\', this.value)"/>'
        + '<button class="btn btn-danger btn-sm" onclick="ShopMgmt.removeMember(\'' + e.id + '\',\'' + e.name + '\')">移除</button>'
        + '</span></li>';
    }).join('') || '<li>暂无员工</li>';
  },
  async setPosition(empId, position) {
    await sb.from('pb_employees').update({ position }).eq('id', empId);
    toast('职位已更新', 'success');
  },
  renderStatus() {
    const asgn = _DB.sched.assignments || {};
    const picked = new Set();
    Object.values(asgn).forEach(day => {
      Object.values(day).forEach(ids => { ids.forEach(id => picked.add(id)); });
    });
    document.getElementById('subStatusList').innerHTML = `已选班员工: <strong>${picked.size} / ${_DB.emps.length}</strong>`;
    const el = document.getElementById('bossPickCount');
    if (el) el.textContent = picked.size;
  },
  renderGrid() {
    const c=_DB.config, emps=_DB.emps, sched=_DB.sched, ov=sched.overrides || {}, el=document.getElementById('bossGrid');
    if(!c.shifts.length||!emps.length) return el.innerHTML = '<div class="empty">请先配置班次并邀请员工</div>';

    const em={}; emps.forEach(e=>{em[e.id]=e});

    // 按职位分组
    const groups = {};
    c.shifts.forEach(sh => {
      const pos = sh.position || '通用';
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(sh);
    });

    let h='<table class="schedule-table"><thead><tr><th>班次</th>'+c.workDays.map(d=>`<th>${d}</th>`).join('')+'</tr></thead><tbody>';

    Object.keys(groups).forEach(pos => {
      h += '<tr class="pos-header"><td colspan="' + (c.workDays.length + 1) + '" style="background:#f5f5f5;font-weight:700;padding:6px 10px;font-size:13px;text-align:left;color:#555">' + pos + '</td></tr>';

      groups[pos].forEach(sh => {
        const required = parseInt(sh.required) || 1;
        const posTag = sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px">' + sh.position + '</span>' : '';
        h += '<tr><td class="shift-label">' + sh.name + posTag + '<br><small>' + sh.start + '-' + sh.end + '</small></td>';
        c.workDays.forEach(day => {
          const ids = ov[day + '_' + sh.id] || (sched.assignments[day] ? sched.assignments[day][sh.id] : []) || [];
          const shortage = ids.length < required;
          let cellHtml = ids.map(id => {
            const emp = em[id];
            const stat = getAvailStatus(_DB.tt[id], day, sh.id);
            const lateTag = stat === 'late' ? ' <small style="color:orange">(晚)</small>' : '';
            return '<span class="emp-tag">' + (emp ? emp.name : '?') + lateTag + '</span>';
          }).join('');

          if (shortage) {
            cellHtml += '<div class="shortage-tag">⚠️ 缺 ' + (required - ids.length) + ' 人</div>';
          }

          h += '<td class="' + (shortage ? 'cell-shortage' : '') + '">' + cellHtml + '</td>';
        });
        h += '</tr>';
      });
    });
    el.innerHTML = h+'</tbody></table>';
  },
  async resetAuto() { await autoSchedule(); await S.fetchAll(); this.renderGrid(); },
  async saveAllShifts(isPublish = false) {
    document.querySelectorAll('[data-sid]').forEach(input => {
      const s = _DB.config.shifts.find(x => x.id === input.dataset.sid);
      if (!s) return;
      const f = input.dataset.field, v = input.value;
      if (f === 'required') s[f] = parseInt(v) || 1;
      else if (f === 'position') s[f] = v.trim();
      else s[f] = v;
    });
    _DB.config.workDays = [...document.querySelectorAll('#workDayChecks input:checked')].map(i => i.value);
    await S.saveCfg(_DB.config);
    if (!isPublish) {
        this.init();
        toast('班次模板已保存', 'success');
    }
  },
  async publish() {
    if (!confirm('发布新班次将清空当前排班，员工需要重新选班，确认吗？')) return;
    await this.saveAllShifts(true);
    // 清空旧排班
    await S.saveSched({});
    await S.fetchAll();
    this.init();
    toast('🚀 新班次已发布！员工可以开始选班', 'success');
  }
};

// === Employee Shift Selection ===
const EmpShift = {
  _myPosition() {
    const asgn = _DB.sched.assignments || {};
    for (const day of Object.keys(asgn)) {
      for (const sid of Object.keys(asgn[day] || {})) {
        if ((asgn[day][sid] || []).includes(_USER.id)) {
          const sh = _DB.config.shifts.find(s => s.id === sid);
          if (sh && sh.position) return sh.position;
        }
      }
    }
    return null;
  },

  async claim(day, shiftId) {
    const sh = _DB.config.shifts.find(s => s.id === shiftId);
    if (!sh) return;
    const myPos = this._myPosition();

    // 同一时间段职位不同？每个员工只能选一个职位
    if (myPos && sh.position && sh.position !== myPos) {
      return toast('你已选择「' + myPos + '」，不能混选其他职位。先取消已有班次再换', 'error');
    }

    if (!_DB.sched.assignments) _DB.sched.assignments = {};
    if (!_DB.sched.assignments[day]) _DB.sched.assignments[day] = {};

    const required = parseInt(sh.required) || 1;
    const picked = _DB.sched.assignments[day][shiftId] || [];

    // 当天已选其他班次？先取消
    Object.keys(_DB.sched.assignments[day] || {}).forEach(sid => {
      if (sid !== shiftId && _DB.sched.assignments[day][sid]) {
        _DB.sched.assignments[day][sid] = _DB.sched.assignments[day][sid].filter(id => id !== _USER.id);
      }
    });

    if (picked.includes(_USER.id)) {
      _DB.sched.assignments[day][shiftId] = picked.filter(id => id !== _USER.id);
      await S.saveSched(_DB.sched.assignments);
      this.render();
      EmpSchedule.render();
      toast('已取消', 'info');
    } else if (picked.length < required) {
      _DB.sched.assignments[day][shiftId] = [...picked, _USER.id];
      await S.saveSched(_DB.sched.assignments);
      this.render();
      EmpSchedule.render();
      toast('选择成功！', 'success');
    } else {
      toast('该班次已满员', 'error');
    }
  },

  render() {
    const c = _DB.config, emps = _DB.emps, sched = _DB.sched, el = document.getElementById('shiftSelectList');
    if (!c.shifts.length) return el.innerHTML = '<div class="empty">老板尚未发布班次</div>';

    const em = {}; emps.forEach(e => { em[e.id] = e; });
    const myPos = this._myPosition();

    let html = myPos
      ? '<div style="background:#f0f2ff;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px">你的职位：<strong style="color:#667eea">' + myPos + '</strong> <span style="color:#999;font-size:11px">（取消全部班次后可换职位）</span></div>'
      : '<div style="background:#fff9c4;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px">请选择一个班次，选择后职位将锁定</div>';

    c.workDays.forEach(day => {
      html += '<div class="card" style="margin-bottom:10px"><h3>' + day + '</h3>';
      c.shifts.forEach(sh => {
        const required = parseInt(sh.required) || 1;
        const picked = (sched.assignments && sched.assignments[day] && sched.assignments[day][sh.id]) || [];
        const isMine = picked.includes(_USER.id);
        const full = picked.length >= required && !isMine;
        const posMismatch = myPos && sh.position && sh.position !== myPos;
        const disabled = full || posMismatch;
        const posTag = sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px">' + sh.position + '</span>' : '';
        const names = picked.map(id => em[id] ? em[id].name : '?').join(', ') || '—';

        html += '<div onclick="' + (disabled ? '' : 'EmpShift.claim(\'' + day + '\',\'' + sh.id + '\')') + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid ' + (isMine ? '#667eea' : '#eee') + ';border-radius:8px;margin-bottom:6px;cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';background:' + (isMine ? '#f0f2ff' : (disabled ? '#f5f5f5' : '#fff')) + ';opacity:' + (disabled ? '0.5' : '1') + '">'
          + '<div><strong>' + sh.name + '</strong>' + posTag + ' <small style="color:#888">' + sh.start + '-' + sh.end + '</small></div>'
          + '<div style="font-size:12px;color:#888">' + names + ' <span style="color:#aaa">(' + picked.length + '/' + required + ')</span>'
          + (isMine ? ' <span style="color:#667eea;font-weight:600">✓ 已选</span>' : (posMismatch ? ' <span style="color:#e67e22">其他职位</span>' : (full ? ' <span style="color:#e74c3c">已满</span>' : '')))
          + '</div></div>';
      });
      html += '</div>';
    });
    el.innerHTML = html;
  }
};

const EmpSchedule = {
  render() {
    const c=_DB.config, sched=_DB.sched;
    const cards = [];

    c.workDays.forEach(day=>{
      c.shifts.forEach(sh=>{
        const ids = (sched.assignments && sched.assignments[day] && sched.assignments[day][sh.id]) || [];
        if(ids.includes(_USER.id)) cards.push({day, sh});
      });
    });
    const el = document.getElementById('myShiftCards');
    if(!cards.length) return el.innerHTML = '<div class="empty">暂未选择班次</div>';
    el.innerHTML = cards.map(c => {
      const posTag = c.sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px">' + c.sh.position + '</span>' : '';
      return '<div class="shift-card" style="justify-content:flex-start;gap:12px">'
        + '<div class="sc-info"><div class="sc-date">' + c.day + '</div><div class="sc-time">' + c.sh.name + posTag + ' · ' + c.sh.start + '-' + c.sh.end + '</div></div>'
        + '<button class="btn btn-outline btn-sm" onclick="EmpShift.claim(\'' + c.day + '\',\'' + c.sh.id + '\')">取消</button>'
        + '</div>';
    }).join('');
  }
};

const EmpMsg = {
  render() {
    const ns = _DB.notifs.filter(n => n.to_id === _USER.id);
    const unread = ns.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    if (badge) {
        badge.style.display = unread ? 'flex' : 'none';
        badge.textContent = unread;
    }
    const el = document.getElementById('notifList');
    if(!ns.length) return el.innerHTML = '<div class="empty">暂无消息</div>';
    el.innerHTML = ns.map(n => `
      <div class="notif-item ${n.read?'':'unread'}">
        <div class="notif-body">
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      </div>
    `).join('');
  }
};

// === UI Helpers ===
const UI = {
  toggleAuthMode(mode) {
    const title = document.getElementById('authTitle');
    const desc = document.getElementById('authDesc');
    const loginActions = document.getElementById('loginActions');
    const signupActions = document.getElementById('signupActions');
    
    if (mode === 'signup') {
      title.textContent = '创建新账号';
      desc.textContent = '注册后即可创建或加入店铺';
      loginActions.style.display = 'none';
      signupActions.style.display = 'block';
    } else {
      title.textContent = '欢迎登录';
      desc.textContent = '请使用邮箱和密码访问您的店铺';
      loginActions.style.display = 'block';
      signupActions.style.display = 'none';
    }
  },
  switchBossTab(t) {
    document.querySelectorAll('#view-shop .tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById(t).classList.add('active');
    document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
  },
  switchEmpTab(t) {
    document.querySelectorAll('#view-shop .tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById('emp-' + t).classList.add('active');
    document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(t === 'messages') EmpMsg.render();
  }
};

function toast(msg, type='info') {
  const d = document.createElement('div'); d.className = 'toast ' + type; d.textContent = msg;
  document.getElementById('toasts').appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// === Init ===
window.Auth = Auth; window.Onboarding = Onboarding; window.UI = UI; window.Boss = Boss; window.EmpShift = EmpShift; window.EmpSchedule = EmpSchedule; window.EmpMsg = EmpMsg; window.ShopMgmt = ShopMgmt; window.S = S;
Router.init();
