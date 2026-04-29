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
  config: {workDays:['周一','周二','周三','周四','周五'], shifts:[], maxShiftsPerDay:1, minHoursPerShift:2},
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
        if (_PROFILE.shop_id) window.location.hash = `#/shop/${_PROFILE.shop_id}`;
        else window.location.hash = '#/settings';
        return;
      }

      if (!_PROFILE.shop_id && !hash.includes('settings')) {
        window.location.hash = '#/settings';
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
        // 验证邀请码
        const inviteCode = document.getElementById('signupInviteCode').value.trim();
        if (!inviteCode) return toast('请输入邀请码', 'error');

        const { data: codeData, error: codeErr } = await sb.from('pb_invite_codes').select('*').eq('code', inviteCode).single();
        if (codeErr || !codeData) return toast('邀请码无效，请检查后重试', 'error');

        const genderEl = document.getElementById('signupGender');
        const gender = genderEl ? genderEl.value : '男';
        res = await sb.auth.signUp({ email, password, options: { data: { gender } } });
        if (res.error) throw res.error;

        if (res.data.user) {
          _USER = res.data.user;

          if (codeData.shop_id) {
            // 邀请码已有店铺 → 加入为员工
            await sb.from('profiles').upsert({ id: _USER.id, email, role: 'employee', shop_id: codeData.shop_id, name: email.split('@')[0], gender }, { onConflict: 'id' });
            await sb.from('pb_employees').upsert({ id: _USER.id, name: email.split('@')[0], email, shop_id: codeData.shop_id, gender, position: '' }, { onConflict: 'id' });
            toast('注册成功！已加入店铺', 'success');
          } else {
            // 邀请码未使用 → 创建新店铺，用户为老板
            const shopName = document.getElementById('signupShopName').value.trim() || codeData.shop_name || '我的店铺';
            const { data: shop, error: shopErr } = await sb.from('shops').insert([{ name: shopName, boss_id: _USER.id, invite_code: inviteCode }]).select().single();
            if (shopErr) throw shopErr;

            await sb.from('pb_invite_codes').update({ shop_id: shop.id, shop_name: shopName }).eq('code', inviteCode);
            await sb.from('profiles').upsert({ id: _USER.id, email, role: 'boss', shop_id: shop.id, name: email.split('@')[0], gender }, { onConflict: 'id' });
            await sb.from('pb_employees').upsert({ id: _USER.id, name: email.split('@')[0], email, shop_id: shop.id, gender, position: '' }, { onConflict: 'id' });
            toast('注册成功！店铺已创建', 'success');
          }
          await Router.handleRoute();
          return;
        }
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

// === Onboarding (保留 updateProfile 供设置页使用) ===
const Onboarding = {
  async updateProfile() {
    const name = document.getElementById('profileName').value;
    const email = document.getElementById('profileEmail').value.trim();
    await sb.from('profiles').update({ name }).eq('id', _USER.id);
    if (email) {
      await sb.from('pb_employees').update({ email }).eq('id', _USER.id);
    }
    toast('保存成功','success');
  }
};

// === Shop ===
const Shop = {
  async init(id) {
    if (!id || id !== _PROFILE.shop_id) {
      await Router.syncProfile();
      if (!_PROFILE.shop_id) return window.location.hash = '#/settings';
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
          <button class="top-tab" onclick="UI.switchBossTab('b-preview')">📋 下周预览</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-config')">⚙️ 班次定义</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-employees')">👥 员工管理</button>
          <button class="top-tab" onclick="UI.switchBossTab('b-status')">📋 状态</button>
        </div>
        <div class="tab-content active" id="b-schedule">
          <div class="status-bar"><div id="bossStatus">员工已选: <span id="bossPickCount">0</span></div></div>
          <div class="card" id="bossGrid"></div>
        </div>
        <div class="tab-content" id="b-preview">
          <div class="card" id="previewGrid"></div>
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
          <div class="card mt-20"><h3>邀请码: <strong style="color:var(--primary-color)">${_SHOP.invite_code}</strong></h3><p style="font-size:12px;color:#999">员工注册时输入此邀请码即可自动加入本店。如需更换邀请码，请生成新码。</p>
          <button class="btn btn-outline btn-sm mt-20" onclick="Boss.genInviteCode()">🔑 生成新的邀请码</button></div>
        </div>
        <div class="tab-content" id="b-status">
           <div class="card"><h2>提交状态</h2><div id="subStatusList"></div></div>
        </div>
      `;
      Boss.init();
    } else {
      nav.style.display = 'flex';
      container.innerHTML = `
        <div class="tab-content active" id="emp-avail">
          <h2 style="font-size:1rem;margin-bottom:12px">📋 选下周班次</h2>
          <p class="card-hint">点击班次即可选择，每人每天限选一个，选择后职位锁定</p>
          <div id="shiftSelectList"></div>
        </div>
        <div class="tab-content" id="emp-schedule">
          <h2 style="font-size:1rem;margin-bottom:12px">📅 当前班表</h2>
          <div id="myShiftCards"></div>
        </div>
        <div class="tab-content" id="emp-messages">
          <h2 style="font-size:1rem;margin-bottom:12px">📨 消息中心</h2>
          <div class="card" id="notifList"></div>
        </div>
      `;
      await S.fetchAll();
      EmpAvail.render();
      EmpSchedule.render();
      EmpMsg.render();
    }
  }
};

// === Settings ===
const Settings = {
  async init() {
    // 确保基础数据已加载
    if (_PROFILE.shop_id && !_SHOP) {
      const { data: shop } = await sb.from('shops').select('*').eq('id', _PROFILE.shop_id).single();
      _SHOP = shop;
    }
    if (_PROFILE.shop_id && !_DB.emps.length) {
      const { data: emps } = await sb.from('pb_employees').select('*').eq('shop_id', _PROFILE.shop_id);
      _DB.emps = emps || [];
    }
    document.getElementById('profileName').value = _PROFILE.name || '';
    const myEmp = _DB.emps.find(e => e.id === _USER.id);
    document.getElementById('profileEmail').value = (myEmp && myEmp.email) || _USER.email || '';
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
    window.location.hash = '#/settings';
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
    _DB.config = cfg ? cfg.data : {workDays:['周一','周二','周三','周四','周五'], shifts:[], maxShiftsPerDay:1, minHoursPerShift:2};
    const {data: emps} = await sb.from('pb_employees').select('*').eq('shop_id', sid);
    _DB.emps = emps || [];
    const {data: tts} = await sb.from('pb_tt').select('*').eq('shop_id', sid);
    _DB.tt = {};
    if(tts) tts.forEach(t => { _DB.tt[t.emp_id] = {busy: t.busy_data, submitted: t.submitted} });
    const {data: sch} = await sb.from('pb_sched').select('*').eq('shop_id', sid).single();
    _DB.sched = sch ? {assignments: sch.assignments || {}, overrides: sch.overrides || {}, at: sch.updated_at} : {assignments:{}, overrides:{}, at:''};
    // 周次结转：如果存储的周次与当前周不同，自动结转选班
    const storedWeek = _DB.sched.assignments._week_start;
    const currentWeek = getWeekStart();
    if (storedWeek && storedWeek !== currentWeek) {
      _DB.sched.assignments._week_start = currentWeek;
      await S.saveSched(_DB.sched.assignments);
    }
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
  // 未提交视为全可用(full)，但标记为未提交
  if(!tt || !tt.submitted) return 'available';
  const b = tt.busy[day];
  if(!b) return 'available';
  // 新格式: b[sid] = {status, earliest, latest}
  const cell = b[sid];
  if(!cell) return 'available';
  if(cell.status === 'unavailable') return 'busy';
  if(cell.status === 'partial') return 'late';
  return 'available';
}

function getAvailDetail(tt, day, sid) {
  if(!tt || !tt.busy) return null;
  const b = tt.busy[day];
  if(!b) return null;
  return b[sid] || null;
}

// 自动补位：当某天某班次空缺时，从可用员工中挑选最佳人选填补
async function refillShift(day, shiftId) {
  // 不能修改当天及过去的班次
  if (!isFutureDay(day)) return null;

  const c = _DB.config, emps = _DB.emps, asgn = _DB.sched.assignments || {};
  const sh = c.shifts.find(s => s.id === shiftId);
  if (!sh) return null;

  const required = parseInt(sh.required) || 1;
  const current = (asgn[day] && asgn[day][shiftId]) || [];
  const vacant = required - current.length;
  if (vacant <= 0) return null;

  // 该天已被安排其他班次的员工（每人每天限选一个）
  const busyOnDay = new Set();
  if (asgn[day]) {
    Object.values(asgn[day]).forEach(ids => { ids.forEach(id => busyOnDay.add(id)); });
  }

  // 本周已排班次计数（负载均衡）
  const weekTotal = {};
  emps.forEach(e => { weekTotal[e.id] = 0; });
  Object.keys(asgn).forEach(d => {
    if (d.startsWith('_')) return;
    Object.values(asgn[d] || {}).forEach(ids => { ids.forEach(id => { weekTotal[id] = (weekTotal[id] || 0) + 1; }); });
  });

  // 筛选候选人
  const cands = emps.filter(e => {
    if (current.includes(e.id)) return false;         // 已在当前班次
    if (busyOnDay.has(e.id)) return false;            // 当天已有其他班次
    if (getAvailStatus(_DB.tt[e.id], day, shiftId) === 'busy') return false; // 不可用
    if (sh.position && e.position && e.position !== sh.position) return false; // 职位不匹配
    return true;
  });

  // 排序：full优先 > partial，然后负载均衡
  cands.sort((a, b) => {
    const statA = getAvailStatus(_DB.tt[a.id], day, shiftId);
    const statB = getAvailStatus(_DB.tt[b.id], day, shiftId);
    if (statA === 'available' && statB === 'late') return -1;
    if (statA === 'late' && statB === 'available') return 1;
    return (weekTotal[a.id] || 0) - (weekTotal[b.id] || 0);
  });

  const filled = [];
  for (let i = 0; i < vacant && i < cands.length; i++) {
    const pick = cands[i];
    if (!asgn[day]) asgn[day] = {};
    if (!asgn[day][shiftId]) asgn[day][shiftId] = [];
    asgn[day][shiftId].push(pick.id);
    busyOnDay.add(pick.id);
    weekTotal[pick.id] = (weekTotal[pick.id] || 0) + 1;
    filled.push(pick);
  }

  if (filled.length > 0) {
    asgn._week_start = getWeekStart();
    await S.saveSched(asgn);
    return filled;
  }
  return null;
}

async function autoSchedule() {
  console.log('--- Starting Auto-Schedule ---');
  const c = _DB.config, emps = _DB.emps;
  if(!c.shifts.length || !emps.length) return;

  try {
    const asgn = {};
    const weekTotal = {};
    emps.forEach(e => weekTotal[e.id] = 0);

    c.workDays.forEach(day => {
      asgn[day] = {};
      c.shifts.forEach(sh => {
        const required = parseInt(sh.required) || 1;
        // 1. 筛选: 可用 + 职位匹配 (partial 视为晚到，仍可入选)
        const cands = emps.filter(e => {
          if (getAvailStatus(_DB.tt[e.id], day, sh.id) === 'busy') return false;
          if (sh.position && e.position && e.position !== sh.position) return false;
          return true;
        });

        // 2. 排序: full 优先于 partial, 负载均衡
        cands.sort((a, b) => {
          const statA = getAvailStatus(_DB.tt[a.id], day, sh.id);
          const statB = getAvailStatus(_DB.tt[b.id], day, sh.id);
          if (statA === 'available' && statB === 'late') return -1;
          if (statA === 'late' && statB === 'available') return 1;
          return weekTotal[a.id] - weekTotal[b.id];
        });

        // 3. 选取
        const picked = cands.slice(0, required).map(e => e.id);
        asgn[day][sh.id] = picked;
        picked.forEach(id => weekTotal[id]++);
      });
    });

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
    Object.keys(asgn).forEach(day => {
      if (day.startsWith('_')) return;
      Object.values(asgn[day] || {}).forEach(ids => { ids.forEach(id => picked.add(id)); });
    });
    document.getElementById('subStatusList').innerHTML = `已选班员工: <strong>${picked.size} / ${_DB.emps.length}</strong>`;
    const el = document.getElementById('bossPickCount');
    if (el) el.textContent = picked.size;
  },
  renderGrid() {
    const c=_DB.config, emps=_DB.emps, sched=_DB.sched, ov=sched.overrides || {}, el=document.getElementById('bossGrid');
    if(!el) return; // 员工视图无此元素
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
  async renderPreview() {
    await S.fetchAll();
    const c=_DB.config, emps=_DB.emps, el=document.getElementById('previewGrid');
    if(!el) return;
    if(!c.shifts.length||!emps.length) return el.innerHTML = '<div class="empty">请先配置班次并邀请员工</div>';

    // 统计提交状态
    const submitted = emps.filter(e => _DB.tt[e.id] && _DB.tt[e.id].submitted);
    const notSubmitted = emps.filter(e => !_DB.tt[e.id] || !_DB.tt[e.id].submitted);

    // 运行排班算法生成预览
    const preview = {};
    const weekTotal = {};
    emps.forEach(e => weekTotal[e.id] = 0);

    c.workDays.forEach(day => {
      preview[day] = {};
      c.shifts.forEach(sh => {
        const required = parseInt(sh.required) || 1;
        const cands = emps.filter(e => {
          if (getAvailStatus(_DB.tt[e.id], day, sh.id) === 'busy') return false;
          if (sh.position && e.position && e.position !== sh.position) return false;
          return true;
        });
        cands.sort((a, b) => {
          const statA = getAvailStatus(_DB.tt[a.id], day, sh.id);
          const statB = getAvailStatus(_DB.tt[b.id], day, sh.id);
          if (statA === 'available' && statB === 'late') return -1;
          if (statA === 'late' && statB === 'available') return 1;
          return weekTotal[a.id] - weekTotal[b.id];
        });
        const picked = cands.slice(0, required).map(e => e.id);
        preview[day][sh.id] = picked;
        picked.forEach(id => weekTotal[id]++);
      });
    });

    // 缓存预览结果，供"应用"使用
    this._preview = preview;

    const em={}; emps.forEach(e=>{em[e.id]=e});

    // 提交状态栏
    let html = '<div class="status-bar">'
      + '<div class="status-info">✅ 已提交: <strong>' + submitted.length + '</strong> 人</div>'
      + '<div class="status-info">⚠️ 未提交(默认全可用): <strong>' + notSubmitted.length + '</strong> 人';
    if (notSubmitted.length) {
      html += ' <span style="font-size:11px;color:#999">(' + notSubmitted.map(e=>e.name).join('、') + ')</span>';
    }
    html += '</div>'
      + '<button class="btn btn-primary btn-sm" onclick="Boss.applyPreview()">✅ 应用为正式排班</button>'
      + '</div>';

    // 按职位分组渲染预览表
    const groups = {};
    c.shifts.forEach(sh => {
      const pos = sh.position || '通用';
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(sh);
    });

    html += '<table class="schedule-table"><thead><tr><th>班次</th>'+c.workDays.map(d=>`<th>${d}</th>`).join('')+'</tr></thead><tbody>';

    Object.keys(groups).forEach(pos => {
      html += '<tr class="pos-header"><td colspan="' + (c.workDays.length + 1) + '" style="background:#f5f5f5;font-weight:700;padding:6px 10px;font-size:13px;text-align:left;color:#555">' + pos + '</td></tr>';
      groups[pos].forEach(sh => {
        const required = parseInt(sh.required) || 1;
        const posTag = sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px">' + sh.position + '</span>' : '';
        html += '<tr><td class="shift-label">' + sh.name + posTag + '<br><small>' + sh.start + '-' + sh.end + '</small></td>';
        c.workDays.forEach(day => {
          const ids = preview[day] ? (preview[day][sh.id] || []) : [];
          const shortage = ids.length < required;
          let cellHtml = ids.map(id => {
            const emp = em[id];
            const stat = getAvailStatus(_DB.tt[id], day, sh.id);
            const tag = stat === 'late' ? ' <small style="color:orange">(晚)</small>' : '';
            const subTag = (!_DB.tt[id] || !_DB.tt[id].submitted) ? ' <small style="color:#999">⚠</small>' : '';
            return '<span class="emp-tag">' + (emp ? emp.name : '?') + tag + subTag + '</span>';
          }).join('');
          if (shortage) cellHtml += '<div class="shortage-tag">⚠️ 缺 ' + (required - ids.length) + ' 人</div>';
          html += '<td class="' + (shortage ? 'cell-shortage' : '') + '">' + cellHtml + '</td>';
        });
        html += '</tr>';
      });
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  },
  async applyPreview() {
    if (!this._preview) return toast('请先生成预览', 'error');
    if (!confirm('确认将预览排班应用为正式排班？当前排班将被覆盖。')) return;
    this._preview._week_start = getWeekStart();
    await S.saveSched(this._preview);
    await S.fetchAll();
    const preview = this._preview;
    this._preview = null;
    this.renderGrid();
    toast('✅ 预览排班已应用！', 'success');

    // 邮件通知所有被排班的员工
    const affected = new Set();
    Object.keys(preview).forEach(day => {
      if (day.startsWith('_')) return;
      Object.values(preview[day] || {}).forEach(ids => { ids.forEach(id => affected.add(id)); });
    });
    const subject = _SHOP.name + ' - 排班已更新';
    const text = buildScheduleEmail(_SHOP.name, '下周排班已正式应用，请登录查看您的排班安排。如有疑问请联系老板。');
    for (const empId of affected) {
      await notifyEmp(empId, subject, text);
    }
    if (affected.size > 0) toast('已发送邮件通知 ' + affected.size + ' 位员工', 'info');
  },
  async genInviteCode() {
    if (!confirm('确定要生成一个新的邀请码吗？旧邀请码将失效。')) return;
    const newCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    // 更新 shops 表
    await sb.from('shops').update({ invite_code: newCode }).eq('id', _SHOP.id);
    // 更新 pb_invite_codes (旧码标记失效，新码生效)
    await sb.from('pb_invite_codes').delete().eq('shop_id', _SHOP.id);
    await sb.from('pb_invite_codes').insert([{ code: newCode, shop_name: _SHOP.name, shop_id: _SHOP.id, created_by: _USER.id }]);
    _SHOP.invite_code = newCode;
    toast('新邀请码: ' + newCode, 'success');
    Shop.render();
  },
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
    if (!confirm('确认发布新班次？员工已选的班次将保留。')) return;
    await this.saveAllShifts(true);
    const asgn = _DB.sched.assignments || {};
    asgn._week_start = getWeekStart();
    await S.saveSched(asgn);
    await S.fetchAll();
    this.init();
    toast('🚀 新班次已发布！员工选班已保留', 'success');

    // 邮件通知所有有排班的员工
    const affected = new Set();
    Object.keys(asgn).forEach(day => {
      if (day.startsWith('_')) return;
      Object.values(asgn[day] || {}).forEach(ids => { ids.forEach(id => affected.add(id)); });
    });
    const subject = _SHOP.name + ' - 新班次已发布';
    const text = buildScheduleEmail(_SHOP.name, '本周班次已更新发布，请登录查看您的排班安排。');
    for (const empId of affected) {
      await notifyEmp(empId, subject, text);
    }
    toast('已发送邮件通知 ' + affected.size + ' 位员工', 'info');
  }
};

// === Employee Availability (可用时间填报) ===
const EmpAvail = {
  _states: ['full', 'partial', 'unavailable'],
  _labels: { full: '可上班', partial: '部分到岗', unavailable: '无法' },

  init() {
    const myTT = _DB.tt[_USER.id];
    if (myTT && myTT.busy) {
      this._data = JSON.parse(JSON.stringify(myTT.busy));
      // 兼容旧格式：旧值为字符串 "available"/"busy"/"late"，转为对象 {status:...}
      Object.keys(this._data).forEach(day => {
        const entry = this._data[day];
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          Object.keys(entry).forEach(sid => {
            if (typeof entry[sid] === 'string') {
              const map = { available: 'full', busy: 'unavailable', late: 'partial' };
              entry[sid] = { status: map[entry[sid]] || 'full' };
            }
          });
        }
      });
    } else {
      this._data = {};
    }
  },

  _getCell(day, shiftId) {
    if (!this._data[day]) this._data[day] = {};
    if (!this._data[day][shiftId]) this._data[day][shiftId] = { status: 'full' };
    return this._data[day][shiftId];
  },

  cycleCell(day, shiftId) {
    const cell = this._getCell(day, shiftId);
    const idx = this._states.indexOf(cell.status);
    cell.status = this._states[(idx + 1) % 3];
    this.render();
    toast(day + ' → ' + this._labels[cell.status], 'info');
  },

  setDayUnavailable(day) {
    if (!this._data[day]) this._data[day] = {};
    _DB.config.shifts.forEach(sh => {
      this._data[day][sh.id] = { status: 'unavailable' };
    });
    this.render();
    toast(day + ' 已全部标为不可用', 'info');
  },

  copyLastWeek() {
    toast('暂无上周数据，请手动填报。提交后下周可复制本周数据。', 'info');
  },

  async submit() {
    const busy = {};
    _DB.config.workDays.forEach(day => {
      busy[day] = {};
      _DB.config.shifts.forEach(sh => {
        const cell = this._getCell(day, sh.id);
        busy[day][sh.id] = {
          status: cell.status || 'full'
        };
      });
    });

    await S.saveTT(_USER.id, { busy, submitted: true });

    // 触发局部重排：检查已排班次是否受影响
    const asgn = _DB.sched.assignments || {};
    let needReschedule = false;
    _DB.config.workDays.forEach(day => {
      _DB.config.shifts.forEach(sh => {
        const ids = (asgn[day] && asgn[day][sh.id]) || [];
        if (ids.includes(_USER.id)) {
          const cell = busy[day][sh.id];
          if (cell.status === 'unavailable') {
            asgn[day][sh.id] = ids.filter(id => id !== _USER.id);
            needReschedule = true;
          }
        }
      });
    });

    if (needReschedule) {
      asgn._week_start = getWeekStart();
      await S.saveSched(asgn);
      await S.fetchAll();

      // 自动补位每个空缺班次
      let allFilled = true;
      const filledEmps = new Map(); // empId → [{day, shiftName}]
      for (const d of _DB.config.workDays) {
        for (const sh of _DB.config.shifts) {
          const filled = await refillShift(d, sh.id);
          if (filled && filled.length > 0) {
            for (const emp of filled) {
              if (!filledEmps.has(emp.id)) filledEmps.set(emp.id, []);
              filledEmps.get(emp.id).push(d + ' ' + sh.name + '(' + sh.start + '-' + sh.end + ')');
            }
          } else {
            // 检查该班次是否真的有空缺
            const current = (_DB.sched.assignments[d] && _DB.sched.assignments[d][sh.id]) || [];
            if (current.length < (parseInt(sh.required) || 1)) allFilled = false;
          }
        }
      }

      // 通知被补位的员工
      for (const [empId, shifts] of filledEmps) {
        await notifyEmp(empId,
          _SHOP.name + ' - 您有新班次',
          buildScheduleEmail(_SHOP.name,
            '由于有人提交了不可用时段，系统已自动安排您顶班：<br><strong>' + shifts.join('<br>') + '</strong><br>请登录查看排班详情。'));
      }

      if (filledEmps.size > 0) {
        toast('提交成功！已自动补位 ' + filledEmps.size + ' 人', 'success');
      }

      // 有空缺补不上 → 通知老板
      if (!allFilled) {
        await notifyBoss(_SHOP.name + ' - 排班空缺需处理',
          buildScheduleEmail(_SHOP.name,
            '<strong>' + (_PROFILE.name || _USER.email) + '</strong> 提交了不可用时段，部分班次暂无合适人选自动补位，请手动安排。'));
      }
    } else {
      toast('提交成功！', 'success');
    }
    await S.fetchAll();
    this.render();
    EmpSchedule.render();
    Boss.renderGrid();
  },

  render() {
    if (!this._data) this.init(); // 仅首次初始化，避免覆盖内存修改
    const c = _DB.config, el = document.getElementById('shiftSelectList');
    if (!c.shifts.length) return el.innerHTML = '<div class="empty">老板尚未发布班次</div>';

    const myTT = _DB.tt[_USER.id];
    const submitted = myTT && myTT.submitted;

    let html = '';
    // 状态栏
    html += '<div class="avail-bar">'
      + '<div class="avail-legend">'
      + '<span><span class="avail-dot full"></span> 可上班(全程)</span>'
      + '<span><span class="avail-dot partial"></span> 部分到岗</span>'
      + '<span><span class="avail-dot unavailable"></span> 无法上班</span>'
      + '</div>'
      + '<div style="display:flex;gap:6px;margin-left:auto">'
      + '<button class="btn btn-outline btn-sm" onclick="EmpAvail.copyLastWeek()">📋 同上周</button>'
      + '<button class="btn btn-primary btn-sm" onclick="EmpAvail.submit()">' + (submitted ? '🔄 重新提交' : '📤 提交本周') + '</button>'
      + '</div></div>';

    if (submitted) {
      html += '<div style="background:#d5f5e3;padding:6px 12px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#27ae60">✓ 已提交</div>';
    } else {
      html += '<div style="background:#fff9c4;padding:6px 12px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#856404">⚠ 未提交，默认视为全部可上班。点击格子切换状态后提交。</div>';
    }

    // 网格
    html += '<div class="avail-grid-wrapper"><table class="avail-table"><thead><tr><th>班次</th>';
    c.workDays.forEach(d => { html += '<th>' + d + '</th>'; });
    html += '</tr></thead><tbody>';

    c.shifts.forEach(sh => {
      html += '<tr><td style="font-weight:600;font-size:0.78rem">' + sh.name + '<br><small style="color:#888">' + sh.start + '-' + sh.end + '</small></td>';
      c.workDays.forEach(day => {
        const cell = this._getCell(day, sh.id);
        const status = cell.status || 'full';
        html += '<td class="avail-cell ' + status + '" onclick="EmpAvail.cycleCell(\'' + day + '\',\'' + sh.id + '\')">'
          + '<span class="cell-status">' + this._labels[status] + '</span>'
          + '</td>';
      });
      html += '</tr>';
      // 全天不可用按钮行
      html += '<tr><td style="font-size:0.7rem;color:#999;padding:4px"></td>';
      c.workDays.forEach(day => {
        html += '<td style="padding:2px;text-align:center"><button class="btn btn-outline btn-sm" style="font-size:0.65rem;padding:2px 6px" onclick="EmpAvail.setDayUnavailable(\'' + day + '\')">整天不可用</button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<p style="font-size:11px;color:#999;margin-top:8px">点击格子循环切换：可上班 → 部分到岗 → 无法上班 · 未提交默认可上班</p>';
    el.innerHTML = html;
  }
};

// === Shared helper ===
function getMyPosition() {
  const asgn = _DB.sched.assignments || {};
  for (const day of Object.keys(asgn)) {
    if (day.startsWith('_')) continue;
    for (const sid of Object.keys(asgn[day] || {})) {
      if ((asgn[day][sid] || []).includes(_USER.id)) {
        const sh = _DB.config.shifts.find(s => s.id === sid);
        if (sh && sh.position) return sh.position;
      }
    }
  }
  return null;
}

async function cancelClaim(day, shiftId) {
  if (!isFutureDay(day)) return toast('不能取消当天或已过去的班次', 'error');
  if (!_DB.sched.assignments || !_DB.sched.assignments[day]) return;
  const picked = _DB.sched.assignments[day][shiftId] || [];
  if (!picked.includes(_USER.id)) return;
  const sh = _DB.config.shifts.find(s => s.id === shiftId);
  _DB.sched.assignments[day][shiftId] = picked.filter(id => id !== _USER.id);
  _DB.sched.assignments._week_start = getWeekStart();
  await S.saveSched(_DB.sched.assignments);
  await S.fetchAll();

  // 自动补位
  const filled = await refillShift(day, shiftId);
  EmpAvail.render();
  EmpSchedule.render();
  const shiftName = sh ? sh.name + '(' + sh.start + '-' + sh.end + ')' : shiftId;

  if (filled && filled.length > 0) {
    // 补位成功 → 通知被补位的员工
    const names = filled.map(e => e.name).join('、');
    toast('已取消，自动补位: ' + names, 'info');
    for (const emp of filled) {
      await notifyEmp(emp.id,
        _SHOP.name + ' - 您有新班次',
        buildScheduleEmail(_SHOP.name,
          '<strong>' + day + ' ' + shiftName + '</strong> 出现空缺，系统已自动安排您顶班。请登录查看排班详情。'));
    }
  } else {
    // 补位失败 → 通知老板处理
    toast('已取消，暂无合适人选补位', 'info');
    await notifyBoss(_SHOP.name + ' - 排班空缺需处理',
      buildScheduleEmail(_SHOP.name,
        '<strong>' + (_PROFILE.name || _USER.email) + '</strong> 取消了 <strong>' + day + ' ' + shiftName + '</strong>，暂无合适人选自动补位，请手动安排。'));
  }
}

// === Employee Schedule (当前班表 - 含取消和换班) ===
const EmpSchedule = {
  _swapFrom: null,

  startSwap(day, shiftId) {
    this._swapFrom = { day, shiftId };
    this.render();
  },

  cancelSwap() {
    this._swapFrom = null;
    this.render();
  },

  async completeSwap(targetDay, targetShiftId) {
    if (!this._swapFrom) return;
    const srcDay = this._swapFrom.day;
    const srcSid = this._swapFrom.shiftId;

    if (targetDay === srcDay) return toast('不能换到同一天', 'error');
    if (!isFutureDay(targetDay)) return toast('只能换到本周还未开展的班次', 'error');

    const sh = _DB.config.shifts.find(s => s.id === targetShiftId);
    if (!sh) return;

    const myPos = getMyPosition();
    if (myPos && sh.position && sh.position !== myPos) {
      return toast('职位不匹配', 'error');
    }

    const required = parseInt(sh.required) || 1;
    const targetPicked = (_DB.sched.assignments[targetDay] && _DB.sched.assignments[targetDay][targetShiftId]) || [];
    if (targetPicked.length >= required && !targetPicked.includes(_USER.id)) {
      return toast('目标班次已满员', 'error');
    }

    // 当天有其他选中的先取消
    if (_DB.sched.assignments[targetDay]) {
      Object.keys(_DB.sched.assignments[targetDay]).forEach(sid => {
        if (sid !== targetShiftId && _DB.sched.assignments[targetDay][sid]) {
          _DB.sched.assignments[targetDay][sid] = _DB.sched.assignments[targetDay][sid].filter(id => id !== _USER.id);
        }
      });
    }

    // 释放旧班次
    if (_DB.sched.assignments[srcDay] && _DB.sched.assignments[srcDay][srcSid]) {
      _DB.sched.assignments[srcDay][srcSid] = _DB.sched.assignments[srcDay][srcSid].filter(id => id !== _USER.id);
    }

    // 选择新班次
    if (!_DB.sched.assignments[targetDay]) _DB.sched.assignments[targetDay] = {};
    _DB.sched.assignments[targetDay][targetShiftId] = [...targetPicked, _USER.id];
    _DB.sched.assignments._week_start = getWeekStart();
    this._swapFrom = null;
    await S.saveSched(_DB.sched.assignments);
    await S.fetchAll();

    // 自动补位旧班次
    const filled = await refillShift(srcDay, srcSid);
    EmpAvail.render();
    this.render();

    const srcSh = _DB.config.shifts.find(s => s.id === srcSid);
    const tgtSh = _DB.config.shifts.find(s => s.id === targetShiftId);
    const srcShiftName = srcSh ? srcSh.name + '(' + srcSh.start + '-' + srcSh.end + ')' : srcSid;

    if (filled && filled.length > 0) {
      // 补位成功 → 通知被补位的员工
      const names = filled.map(e => e.name).join('、');
      toast('换班成功！自动补位: ' + names, 'success');
      for (const emp of filled) {
        await notifyEmp(emp.id,
          _SHOP.name + ' - 您有新班次',
          buildScheduleEmail(_SHOP.name,
            '<strong>' + srcDay + ' ' + srcShiftName + '</strong> 出现空缺，系统已自动安排您顶班。请登录查看排班详情。'));
      }
    } else {
      // 补位失败 → 通知老板处理
      toast('换班成功！暂无合适人选补位原班次', 'success');
      await notifyBoss(_SHOP.name + ' - 排班空缺需处理',
        buildScheduleEmail(_SHOP.name,
          '<strong>' + (_PROFILE.name || _USER.email) + '</strong> 换班后 <strong>' + srcDay + ' ' + srcShiftName + '</strong> 出现空缺，暂无合适人选自动补位，请手动安排。'));
    }
  },

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

    const sw = this._swapFrom;
    const myPos = getMyPosition();
    const em = {}; _DB.emps.forEach(e => { em[e.id] = e; });
    let html = '';

    // 换班模式：顶部显示可选目标班次面板
    if (sw) {
      html += '<div style="background:#fff3cd;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
        + '<span>🔄 正在换班：从 <strong>' + sw.day + '</strong> 换出，选择以下目标班次</span>'
        + '<button class="btn btn-outline btn-sm" onclick="EmpSchedule.cancelSwap()">取消换班</button>'
        + '</div>';

      // 收集所有可换目标班次
      const targets = [];
      c.workDays.forEach(day => {
        if (day === sw.day) return; // 不能换同一天
        if (!isFutureDay(day)) return; // 只能换未来天
        c.shifts.forEach(sh => {
          const required = parseInt(sh.required) || 1;
          const picked = (sched.assignments && sched.assignments[day] && sched.assignments[day][sh.id]) || [];
          const isFull = picked.length >= required && !picked.includes(_USER.id);
          const posMatch = !myPos || !sh.position || sh.position === myPos;
          if (isFull || !posMatch) return;
          targets.push({ day, sh, picked, required });
        });
      });

      if (targets.length === 0) {
        html += '<div style="color:#999;font-size:12px;padding:8px">暂无可换的目标班次（未来天均已满或职位不匹配）</div>';
      } else {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        targets.forEach(t => {
          const posTag = t.sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 4px;border-radius:3px;font-size:9px">' + t.sh.position + '</span>' : '';
          const names = t.picked.map(id => em[id] ? em[id].name : '?').join(',') || '空缺';
          html += '<div onclick="EmpSchedule.completeSwap(\'' + t.day + '\',\'' + t.sh.id + '\')" style="cursor:pointer;padding:8px 12px;border:1px solid #667eea;border-radius:8px;background:#fff;font-size:12px;transition:all .15s" onmouseover="this.style.background=\'#f0f2ff\'" onmouseout="this.style.background=\'#fff\'">'
            + '<strong>' + t.day + '</strong> ' + t.sh.name + posTag
            + '<br><small style="color:#888">' + t.sh.start + '-' + t.sh.end + ' · ' + names + ' (' + t.picked.length + '/' + t.required + ')</small>'
            + '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }

    // 已选班次卡片
    cards.forEach(c => {
      const posTag = c.sh.position ? ' <span style="background:#667eea;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px">' + c.sh.position + '</span>' : '';
      const isSwapSrc = sw && sw.day === c.day && sw.shiftId === c.sh.id;
      html += '<div class="card" style="margin-bottom:8px;' + (isSwapSrc ? 'border:2px solid #e67e22;background:#fff8e1' : '') + '">'
        + '<div style="display:flex;align-items:center;justify-content:space-between">'
        + '<div>'
        + (isSwapSrc ? '<span style="color:#e67e22;font-weight:600;font-size:11px">🔄 待换出 </span>' : '')
        + '<strong>' + c.day + '</strong> · ' + c.sh.name + posTag + ' <small style="color:#888">' + c.sh.start + '-' + c.sh.end + '</small>'
        + '</div>'
        + '<div class="sc-actions">'
        + '<button class="btn btn-outline btn-sm" onclick="EmpSchedule.startSwap(\'' + c.day + '\',\'' + c.sh.id + '\')">换班</button>'
        + '<button class="btn btn-outline btn-sm" onclick="cancelClaim(\'' + c.day + '\',\'' + c.sh.id + '\')">取消</button>'
        + '</div></div></div>';
    });
    el.innerHTML = html;
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
      desc.textContent = '请输入邀请码注册，一店一码';
      loginActions.style.display = 'none';
      signupActions.style.display = 'block';
    } else {
      title.textContent = '欢迎登录';
      desc.textContent = '请使用邮箱和密码访问您的店铺';
      loginActions.style.display = 'block';
      signupActions.style.display = 'none';
    }
  },
  async checkInviteCode() {
    const code = document.getElementById('signupInviteCode').value.trim();
    const hint = document.getElementById('inviteCodeHint');
    const shopNameGroup = document.getElementById('newShopNameGroup');
    if (!code || code.length < 4) {
      hint.style.display = 'none';
      shopNameGroup.style.display = 'none';
      return;
    }
    const { data, error } = await sb.from('pb_invite_codes').select('*').eq('code', code).single();
    if (error || !data) {
      hint.style.display = 'block';
      hint.style.color = '#e74c3c';
      hint.textContent = '邀请码无效';
      shopNameGroup.style.display = 'none';
    } else if (data.shop_id) {
      hint.style.display = 'block';
      hint.style.color = '#27ae60';
      hint.textContent = '将加入店铺: ' + data.shop_name;
      shopNameGroup.style.display = 'none';
    } else {
      hint.style.display = 'block';
      hint.style.color = '#667eea';
      hint.textContent = '新店铺，注册后自动创建';
      shopNameGroup.style.display = 'block';
    }
  },
  switchBossTab(t) {
    document.querySelectorAll('#view-shop .tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById(t).classList.add('active');
    document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(t === 'b-preview') Boss.renderPreview();
  },
  switchEmpTab(t) {
    document.querySelectorAll('#view-shop .tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById('emp-' + t).classList.add('active');
    document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(t === 'avail') EmpAvail.render();
    if(t === 'schedule') EmpSchedule.render();
    if(t === 'messages') EmpMsg.render();
  }
};

// === 周次 & 日期工具 ===
function getTodayDayIndex() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d; // 周一=1 ... 周日=7
}
function getDayIndex(dayName) {
  const map = {'周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6,'周日':7};
  return map[dayName] || 0;
}
function isFutureDay(dayName) {
  return getDayIndex(dayName) >= getTodayDayIndex();
}
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // 周一为一周开始
  const mon = new Date(now);
  mon.setDate(now.getDate() - diff);
  mon.setHours(0,0,0,0);
  return mon.toISOString().split('T')[0];
}

function toast(msg, type='info') {
  const d = document.createElement('div'); d.className = 'toast ' + type; d.textContent = msg;
  document.getElementById('toasts').appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// === Email Notification ===
async function notifyBoss(subject, text) {
  const boss = _DB.emps.find(e => e.id === _SHOP.boss_id);
  if (boss && boss.email) {
    await S.sendEmail(boss.email, subject, text);
  }
}

async function notifyEmp(empId, subject, text) {
  if (empId === _SHOP.boss_id) return; // boss already notified via notifyBoss
  const emp = _DB.emps.find(e => e.id === empId);
  if (emp && emp.email) {
    await S.sendEmail(emp.email, subject, text);
  }
}

function buildScheduleEmail(shopName, details) {
  return `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
    <h2 style="color:#667eea">${shopName} - 排班通知</h2>
    <p>${details}</p>
    <hr style="border-color:#eee">
    <p style="font-size:12px;color:#999">此邮件由排班系统自动发送，请勿回复。</p>
  </div>`;
}

// === Init ===
window.Auth = Auth; window.Onboarding = Onboarding; window.UI = UI; window.Boss = Boss; window.EmpAvail = EmpAvail; window.EmpSchedule = EmpSchedule; window.EmpMsg = EmpMsg; window.ShopMgmt = ShopMgmt; window.S = S; window.cancelClaim = cancelClaim;
Router.init();
