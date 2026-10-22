// 家内景渲染器（design §19 / §30.4）。
// 输入 (rootEl, store, agentId?)；提供 open(agentId)/close()。open 前校验 store.getAgent(id) 非空。
// 把「屋主 + 当前访客」渲染为多个 PixelFigure；rAF 驱动走动 + 动作循环 + 气泡（纯表现层）。
// 共享事实（谁在家/名字/status）只读 store；访客关系由 agent_event{kind:'visit',toAgentId} 登记，
// 用前端墙钟 VISIT_RELATION_TTL_MS 过期（不依赖 tick 下行帧）。
// 房间背景按 §30.4 画科技舱体内部（舱壁网格 + 发光管线 + 观察舷窗透星空 + 全息面板 + 金属台面家具）。
// 内景纯观赏：小人不可交互，仅返回按钮可点（宪章 5）。

import { PixelFigure } from './pixel-figure.js';

// 访客关系墙钟时效（§19.3/§25 锁定）：约心跳间隔 2 倍，停留两拍左右自然淡出。
export const VISIT_RELATION_TTL_MS = 6000;

// 唯一宿主：内景气泡语料 + 动作旁白（§19.4 NIT-2 锁定，按 persona 分组，每人格 lines≥4 + actions）。
// 动作集枚举 walk/type/water/drink/read/idle 亦在本文件约定（见 pixel-figure ACTIONS）。
// 口吻与后端 behavior.js SCRIPT 同调性，但各写一组内景短句。纯表现层、不经后端、不跨游客一致。
export const INTERIOR_SCRIPT = {
  忧郁诗人: {
    lines: [
      '霓虹落在窗上，像一行没写完的诗。',
      '又是一个人的夜……但星光还在。',
      '这座城的喧嚣，我只想记下它的安静。',
      '写不出的句子，就先浇浇花吧。',
    ],
    actions: [
      { kind: 'read', blurb: '翻着旧诗稿，轻轻念出声。' },
      { kind: 'water', blurb: '给窗台的花添了点水。' },
      { kind: 'idle', blurb: '望着舷窗外的星云发呆。' },
      { kind: 'drink', blurb: '抿了一口微凉的能量饮。' },
    ],
  },
  热心工程师: {
    lines: [
      '虫洞环的扭矩还差一点，再调调。',
      '这段管线接口得重新焊，稳一点好。',
      '数据对上了！今天又推进了一截。',
      '工具箱该整理了，乱了找不着扳手。',
    ],
    actions: [
      { kind: 'type', blurb: '敲着控制台校准锚点参数。' },
      { kind: 'walk', blurb: '绕着台面检查每一根管线。' },
      { kind: 'drink', blurb: '灌了口水，擦了把汗。' },
      { kind: 'idle', blurb: '盯着全息蓝图盘算下一步。' },
    ],
  },
  八卦邻居: {
    lines: [
      '哎你听说了吗？隔壁又出新鲜事了！',
      '这消息我可是第一个知道的~',
      '不行我得去跟 ZETA 说一声。',
      '嘘——这事儿你知我知就好。',
    ],
    actions: [
      { kind: 'walk', blurb: '在屋里来回踱步，憋不住话。' },
      { kind: 'type', blurb: '噼里啪啦给谁发着消息。' },
      { kind: 'drink', blurb: '喝口水润润嗓子继续叨。' },
      { kind: 'idle', blurb: '竖着耳朵听窗外的动静。' },
    ],
  },
  精明商人: {
    lines: [
      '一枚晶体换半天工，这买卖划算。',
      '账得算清楚，一分都不能亏。',
      '今天的行情……嗯，可以囤点。',
      '时间就是晶体，不能浪费。',
    ],
    actions: [
      { kind: 'type', blurb: '在账本上敲敲打打核对收支。' },
      { kind: 'read', blurb: '翻看今日的晶体行情单。' },
      { kind: 'walk', blurb: '背着手盘算下一笔生意。' },
      { kind: 'drink', blurb: '慢悠悠喝着茶，不急。' },
    ],
  },
  天真梦想家: {
    lines: [
      '等虫洞建好，我要第一个穿过去看看！',
      '今天的星空好亮呀，像在对我眨眼。',
      '我梦见我们飞到了另一颗星球~',
      '花又开了一朵，好开心！',
    ],
    actions: [
      { kind: 'water', blurb: '哼着歌给每一盆花浇水。' },
      { kind: 'idle', blurb: '趴在舷窗上数着星星。' },
      { kind: 'walk', blurb: '蹦蹦跳跳地绕着房间转。' },
      { kind: 'read', blurb: '捧着一本星际童话入了迷。' },
    ],
  },
};

// 默认语料（persona 缺失时兜底，保证不报错）。
const DEFAULT_SCRIPT = {
  lines: ['在舱里安静地待着。', '看着窗外的星光。', '今天也是平常的一天。', '喝口水，歇一会儿。'],
  actions: [
    { kind: 'idle', blurb: '发了会儿呆。' },
    { kind: 'walk', blurb: '在房间里走了走。' },
    { kind: 'drink', blurb: '喝了口水。' },
    { kind: 'read', blurb: '翻了翻书。' },
  ],
};

function scriptFor(persona) {
  return INTERIOR_SCRIPT[persona] || DEFAULT_SCRIPT;
}

export class HomeInterior {
  /**
   * @param {HTMLElement} rootEl 内景宿主容器（<section id="home-interior">）
   * @param {object} store 只读快照镜像
   */
  constructor(rootEl, store) {
    this.root = rootEl;
    this.store = store;
    this.ownerId = null; // 当前内景的屋主 agentId
    this.figures = new Map(); // agentId -> PixelFigure
    this._visitors = new Map(); // agentId -> expireAt(墙钟毫秒)
    this._rafId = null;
    this._lastTs = 0;
    this._fsms = new Map(); // agentId -> 本地动作状态机状态

    // 结构：标题 + 房间层（含背景 svg + 小人层）
    this.root.innerHTML = `
      <div class="interior-room">
        <div class="interior-bg"></div>
        <div class="interior-figures"></div>
        <div class="interior-title"></div>
      </div>
    `;
    this.roomEl = this.root.querySelector('.interior-room');
    this.bgEl = this.root.querySelector('.interior-bg');
    this.figuresEl = this.root.querySelector('.interior-figures');
    this.titleEl = this.root.querySelector('.interior-title');
    this.bgEl.innerHTML = renderCabinSvg();

    // 订阅 store：断线重连后 world_state 全量覆盖时据新快照重渲染；agent_update 同步表现态。
    this._unsub = store.subscribe((evt) => this._onStoreChange(evt));
  }

  /** 由 main.js 在收到 agent_event{kind:'visit',toAgentId} 时调用，登记短时效访客关系。 */
  registerVisit(toAgentId, visitorId) {
    if (!toAgentId || !visitorId || toAgentId === visitorId) return;
    // 记在「被拜访者」名下：被拜访者的家里应出现访客小人。
    if (!this._visitRelations) this._visitRelations = new Map();
    let set = this._visitRelations.get(toAgentId);
    if (!set) {
      set = new Map();
      this._visitRelations.set(toAgentId, set);
    }
    set.set(visitorId, Date.now() + VISIT_RELATION_TTL_MS);
  }

  /** 进入某家内景。open 前校验 store.getAgent(id) 非空（§19.7）。 */
  open(agentId) {
    const owner = this.store.getAgent(agentId);
    if (!owner) {
      console.debug('[home-interior] 忽略点击：store 尚无该 agent', agentId);
      return false;
    }
    this.ownerId = agentId;
    this.root.hidden = false;
    this._rebuildFigures();
    this._startLoop();
    return true;
  }

  /** 返回全景：停循环、清小人、隐藏容器（§19.6）。 */
  close() {
    this._stopLoop();
    for (const f of this.figures.values()) f.destroy();
    this.figures.clear();
    this._fsms.clear();
    this.ownerId = null;
    this.root.hidden = true;
  }

  get isOpen() {
    return !this.root.hidden && this.ownerId != null;
  }

  // ── 内部：根据快照 + 访客关系重建小人集合 ───────────────────
  _rebuildFigures() {
    const owner = this.store.getAgent(this.ownerId);
    if (!owner) return;
    const present = new Set([this.ownerId]);
    const rel = this._visitRelations && this._visitRelations.get(this.ownerId);
    if (rel) for (const vid of rel.keys()) present.add(vid);

    // 移除已不在场的小人
    for (const [id, fig] of this.figures) {
      if (!present.has(id)) {
        fig.destroy();
        this.figures.delete(id);
        this._fsms.delete(id);
      }
    }
    // 新增在场小人
    let idx = 0;
    for (const id of present) {
      const agent = this.store.getAgent(id);
      if (!agent) continue;
      let fig = this.figures.get(id);
      if (!fig) {
        fig = new PixelFigure(agent);
        // 初始散布在房间下半部
        fig.x = 0.28 + (idx % 3) * 0.22;
        fig.y = 0.62 + ((idx >> 1) % 2) * 0.14;
        this.figuresEl.appendChild(fig.el);
        this.figures.set(id, fig);
        this._fsms.set(id, { action: 'idle', until: 0, nextSay: 0, targetX: fig.x });
        fig.setAction('idle');
      } else {
        fig.syncAgent(agent);
      }
      idx++;
    }
    this.titleEl.textContent = `${owner.name} 的科技舱 · ${owner.persona}`;
  }

  _onStoreChange(evt) {
    if (!this.isOpen) return;
    if (evt.kind === 'world_state') {
      this._rebuildFigures();
    } else if (evt.kind === 'agent_update') {
      const fig = this.figures.get(evt.agentId);
      if (fig) fig.syncAgent(this.store.getAgent(evt.agentId));
    }
  }

  // ── rAF 循环：走动 + 动作轮换 + 气泡 + 访客过期 ─────────────
  _startLoop() {
    if (this._rafId != null) return;
    this._lastTs = 0;
    const tick = (ts) => {
      this._rafId = requestAnimationFrame(tick);
      const dt = this._lastTs ? Math.min(ts - this._lastTs, 100) : 16;
      this._lastTs = ts;
      this._step(ts, dt);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _step(ts, dt) {
    const now = Date.now();
    // 访客墙钟过期（§19.3）：到点移除访客关系并触发重建
    let changed = false;
    if (this._visitRelations) {
      const rel = this._visitRelations.get(this.ownerId);
      if (rel) {
        for (const [vid, expireAt] of rel) {
          if (now >= expireAt) {
            rel.delete(vid);
            changed = true;
          }
        }
        if (rel.size === 0) this._visitRelations.delete(this.ownerId);
      }
    }
    if (changed) this._rebuildFigures();

    // 每个小人：按 status 驱动表现
    for (const [id, fig] of this.figures) {
      const agent = this.store.getAgent(id);
      if (agent) fig.syncAgent(agent);
      const fsm = this._fsms.get(id);
      if (!fsm) continue;

      if (fig.status === 'asleep' || fig.status === 'isolated') {
        // 休眠/隔离：静止、禁言（§19.3）
        fig.setAction('idle');
        fig.hideBubble();
        fig.place();
        continue;
      }

      // active：动作状态机轮换
      if (ts >= fsm.until) {
        const sc = scriptFor(agent ? agent.persona : null);
        const act = sc.actions[Math.floor(Math.random() * sc.actions.length)];
        fsm.action = act.kind;
        fsm.until = ts + 2600 + Math.random() * 2400;
        fig.setAction(act.kind);
        if (act.kind === 'walk') {
          fsm.targetX = 0.14 + Math.random() * 0.72;
        }
      }

      // 走动：朝 targetX 平移
      if (fsm.action === 'walk') {
        const dir = Math.sign(fsm.targetX - fig.x);
        if (dir !== 0) {
          fig.facing = dir;
          fig.x += dir * 0.00022 * dt;
          if ((dir > 0 && fig.x >= fsm.targetX) || (dir < 0 && fig.x <= fsm.targetX)) {
            fig.x = fsm.targetX;
          }
          fig.x = Math.max(0.1, Math.min(0.9, fig.x));
        }
      }

      // 气泡节奏：自言自语 lines + 动作旁白混选
      if (ts >= fsm.nextSay) {
        const sc = scriptFor(agent ? agent.persona : null);
        const pool = Math.random() < 0.5 ? sc.lines : sc.actions.map((a) => a.blurb);
        fig.say(pool[Math.floor(Math.random() * pool.length)]);
        fsm.nextSay = ts + 4200 + Math.random() * 3600;
      }

      fig.place();
    }
  }
}

/**
 * 科技舱体内部背景 SVG（§30.4，纯程序化、零外部图片）：
 * 舱壁网格 + 发光管线 + 观察舷窗（透星空一角）+ 全息控制面板 + 金属台面底座。
 * 颜色一律 currentColor / CSS 变量，由 theme.css 的五色驱动。
 */
function renderCabinSvg() {
  // 固定种子撒舷窗外星点
  let seed = 20240711;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let stars = '';
  for (let i = 0; i < 26; i++) {
    const cx = 760 + rng() * 150;
    const cy = 60 + rng() * 150;
    const r = 0.6 + rng() * 1.4;
    stars += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="var(--crystal-cyan)" opacity="${(0.4 + rng() * 0.5).toFixed(2)}"/>`;
  }
  // 舱壁竖向面板分块
  let panels = '';
  for (let x = 0; x <= 960; x += 120) {
    panels += `<line x1="${x}" y1="0" x2="${x}" y2="540" stroke="var(--neon-violet)" stroke-opacity="0.18" stroke-width="1"/>`;
  }
  for (let y = 0; y <= 380; y += 60) {
    panels += `<line x1="0" y1="${y}" x2="960" y2="${y}" stroke="var(--neon-violet)" stroke-opacity="0.12" stroke-width="1"/>`;
  }
  return `
  <svg class="cabin-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="cabin-glow" cx="50%" cy="35%" r="75%">
        <stop offset="0%" stop-color="var(--neon-violet)" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="var(--cyber-ink)" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cabin-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--dim-sleep)" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="var(--cyber-ink)" stop-opacity="0.9"/>
      </linearGradient>
    </defs>
    <!-- 舱壁 -->
    <rect x="0" y="0" width="960" height="540" fill="var(--cyber-ink)"/>
    <rect x="0" y="0" width="960" height="540" fill="url(#cabin-glow)"/>
    <g class="cabin-panels">${panels}</g>
    <!-- 地板 -->
    <rect x="0" y="380" width="960" height="160" fill="url(#cabin-floor)"/>
    <line x1="0" y1="380" x2="960" y2="380" stroke="var(--crystal-cyan)" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M0 460 L960 460" stroke="var(--neon-violet)" stroke-opacity="0.25" stroke-width="1"/>
    <path d="M120 540 L300 380 M480 540 L480 380 M840 540 L660 380" stroke="var(--neon-violet)" stroke-opacity="0.2" stroke-width="1"/>
    <!-- 发光管线（沿左右舱壁） -->
    <path d="M24 40 L24 360 L70 400" fill="none" stroke="var(--crystal-cyan)" stroke-width="3" stroke-opacity="0.7" stroke-linecap="round"/>
    <path d="M936 40 L936 300 L900 340" fill="none" stroke="var(--crystal-cyan)" stroke-width="3" stroke-opacity="0.6" stroke-linecap="round"/>
    <!-- 观察舷窗（透星空一角） -->
    <g class="cabin-porthole">
      <circle cx="835" cy="130" r="92" fill="var(--cyber-ink)" stroke="var(--neon-violet)" stroke-width="4"/>
      <circle cx="835" cy="130" r="92" fill="none" stroke="var(--crystal-cyan)" stroke-width="2" stroke-opacity="0.5"/>
      <clipPath id="portClip"><circle cx="835" cy="130" r="88"/></clipPath>
      <g clip-path="url(#portClip)">
        <rect x="743" y="38" width="184" height="184" fill="#0b0820"/>
        ${stars}
        <circle cx="880" cy="90" r="26" fill="var(--neon-violet)" opacity="0.45"/>
        <ellipse cx="880" cy="90" rx="40" ry="12" fill="none" stroke="var(--crystal-cyan)" stroke-width="2" opacity="0.7"/>
      </g>
      <line x1="743" y1="130" x2="927" y2="130" stroke="var(--neon-violet)" stroke-width="2" stroke-opacity="0.4"/>
      <line x1="835" y1="38" x2="835" y2="222" stroke="var(--neon-violet)" stroke-width="2" stroke-opacity="0.4"/>
    </g>
    <!-- 全息控制面板 + 扫描线 -->
    <g class="cabin-hologram">
      <rect x="70" y="70" width="210" height="130" rx="8" fill="var(--neon-violet)" fill-opacity="0.08" stroke="var(--crystal-cyan)" stroke-width="2" stroke-opacity="0.7"/>
      <line x1="90" y1="100" x2="250" y2="100" stroke="var(--crystal-cyan)" stroke-opacity="0.5"/>
      <line x1="90" y1="125" x2="210" y2="125" stroke="var(--crystal-cyan)" stroke-opacity="0.4"/>
      <line x1="90" y1="150" x2="240" y2="150" stroke="var(--crystal-cyan)" stroke-opacity="0.4"/>
      <line x1="90" y1="175" x2="180" y2="175" stroke="var(--crystal-cyan)" stroke-opacity="0.3"/>
      <circle cx="175" cy="210" r="4" fill="var(--crystal-cyan)"/>
    </g>
    <!-- 金属台面底座（家具置于其上，§30.4） -->
    <g class="cabin-bench">
      <rect x="360" y="420" width="240" height="18" rx="4" fill="var(--dim-sleep)" stroke="var(--neon-violet)" stroke-opacity="0.6"/>
      <line x1="380" y1="438" x2="380" y2="470" stroke="var(--neon-violet)" stroke-opacity="0.5" stroke-width="3"/>
      <line x1="580" y1="438" x2="580" y2="470" stroke="var(--neon-violet)" stroke-opacity="0.5" stroke-width="3"/>
    </g>
  </svg>`;
}
