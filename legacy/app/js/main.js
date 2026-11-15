// 装配入口：连接 ws，把帧分发到 store 与各渲染模块。
// 前端只渲染，不自行推进任何共享状态（宪章 5）。
// 产品级新增：顶部 HUD / 动态筛选 / 快捷提问建议。

import { WsClient } from './ws-client.js';
import { Store } from './store.js';
import { TownMap } from './town-map.js';
import { EventFeed } from './event-feed.js';
import { AskBox } from './ask-box.js';
import { HomeInterior } from './home-interior.js';
import { Wormhole } from './wormhole.js';
import { Modals } from './modals.js';
import { Onboarding } from './onboarding.js';
import { Hud } from './hud.js';

const store = new Store();
const ws = new WsClient();

const mapEl = document.getElementById('town-map');
const feedEl = document.getElementById('event-feed');
const connEl = document.getElementById('conn-status');

// ── 本地视图状态（town / home） ────────────────────────────
let view = 'town'; // 'town' | 'home'

const townPanel = document.getElementById('town-panel');
const interiorSection = document.getElementById('home-interior');
const interiorStageEl = document.getElementById('interior-stage');
const backBtn = document.getElementById('interior-back');
const wormholeCanvas = document.getElementById('wormhole-canvas');

const townMap = new TownMap(mapEl, store, {
  onEnterHome: (agentId) => enterHome(agentId),
});
const feed = new EventFeed(feedEl);
const interior = new HomeInterior(interiorStageEl, store);
const wormhole = new Wormhole(wormholeCanvas, store);
const modals = new Modals(
  document.getElementById('lore-icons'),
  document.getElementById('lore-overlays'),
);
const onboarding = new Onboarding(
  document.getElementById('lore-icons'),
  document.getElementById('lore-overlays'),
);
const hud = new Hud(
  {
    ringFill: document.getElementById('hud-ring-fill'),
    dayValue: document.getElementById('hud-day-value'),
    dayLabel: document.getElementById('hud-day-label'),
    activeValue: document.getElementById('hud-active-value'),
    crystalValue: document.getElementById('hud-crystal-value'),
    modeBadge: document.getElementById('mode-badge'),
  },
  store,
);

const askBox = new AskBox(
  {
    inputEl: document.getElementById('ask-input'),
    sendEl: document.getElementById('ask-send'),
    hintEl: document.getElementById('ask-hint'),
    countEl: document.getElementById('ask-count'),
  },
  ws,
);

// ── 快捷提问建议（点选即广播，降低第一次提问门槛） ─────────
const SUGGESTIONS = [
  '周末去哪玩比较解压？',
  '如果我明天想辞职，该先做什么？',
  '怎么让周一变得没那么讨厌？',
  '一百万能量晶体该怎么花？',
  '虫洞建好后第一站去哪？',
  '写一首关于加班的诗',
  '怎么说服老板给我涨薪？',
  'AI 会被人类驯化吗？',
  '怎么优雅地拒绝加班？',
  '外星文明存在吗？',
  '工作摸鱼算不算一种艺术？',
  '最好的解压方式是什么？',
];

const suggestionBox = document.getElementById('ask-suggestions');
const shuffleBtn = document.getElementById('ask-shuffle');

function renderSuggestions() {
  const picks = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
  suggestionBox.innerHTML = '';
  for (const q of picks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = q;
    btn.addEventListener('click', () => {
      askBox.submitQuestion(q);
      const input = document.getElementById('ask-input');
      input.focus();
    });
    suggestionBox.appendChild(btn);
  }
}

shuffleBtn.addEventListener('click', renderSuggestions);
renderSuggestions();

// ── 动态筛选（全部 / 生活 / 讨论 / 决议）──────────────────
const filterChips = document.querySelectorAll('.filter-chip');

for (const chip of filterChips) {
  chip.addEventListener('click', () => {
    const filter = chip.dataset.filter;
    feedEl.dataset.filter = filter;
    for (const c of filterChips) {
      const active = c === chip;
      c.classList.toggle('is-active', active);
      c.setAttribute('aria-pressed', String(active));
    }
  });
}

// ── 视图切换 ───────────────────────────────────────────────
function enterHome(agentId) {
  if (!interior.open(agentId)) return; // open 内部校验 store.getAgent 非空
  view = 'home';
  townPanel.hidden = true;
  interiorSection.hidden = false;
}

function backToTown() {
  interior.close();
  view = 'town';
  interiorSection.hidden = true;
  townPanel.hidden = false;
}

backBtn.addEventListener('click', backToTown);

// ── 连接状态 ───────────────────────────────────────────────
ws.on('_connected', () => {
  connEl.textContent = '已连接';
  connEl.classList.add('online');
});
ws.on('_disconnected', () => {
  connEl.textContent = '重连中…';
  connEl.classList.remove('online');
});

// ── 全量 / 增量状态帧 → store → 渲染 ───────────────────────
ws.on('world_state', (data) => {
  store.applyWorldState(data);
  townMap.renderAll();
  feed.seed(store.snapshot.recentEvents);
  wormhole.render();
  hud.render();
});

ws.on('agent_update', (data) => {
  store.applyAgentUpdate(data);
  // 全景家节点 + 内景小人同步 isolated/asleep/active 表现（内景由其 store 订阅自动处理）
  townMap.updateAgent(data.agentId);
  hud.render();
});

// ── 事件叙事帧 → 地图气泡 + 事件流（+ 访客关系登记） ────────
ws.on('agent_event', (data) => {
  feed.addEvent({
    agentId: data.agentId,
    name: data.name,
    text: data.text,
    interaction: data.interaction,
    kind: data.kind,
  });
  townMap.bubble(data.agentId, data.text);
  // 串门：登记短时效访客关系，内景据此把访客小人渲染进被拜访者的家（§19.3）
  if (data.kind === 'visit' && data.toAgentId) {
    interior.registerVisit(data.toAgentId, data.agentId);
  }
});

ws.on('discussion_start', (data) => {
  feed.addStart({ question: data.question });
});

ws.on('discussion_speak', (data) => {
  feed.addSpeak({ agentId: data.agentId, name: data.name, text: data.text });
  townMap.bubble(data.agentId, data.text);
});

ws.on('resolution', (data) => {
  feed.addResolution({ text: data.text });
});

// ── 虫洞工程进度（下行帧 project_update）──────────────────
ws.on('project_update', (data) => {
  const prev = store.snapshot.project ? store.snapshot.project.status : 'building';
  store.applyProjectUpdate(data);
  // 收到建成帧时触发一次性建成动画（随后的 progress:0 帧由补间归零）
  if (data && data.status === 'completed' && prev !== 'completed') {
    wormhole.onCompleted();
  }
  wormhole.render();
});

// ── 提问反馈（按帧名区分成功 / 失败）───────────────────────
ws.on('ask_queued', (data) => askBox.onQueued(data));
ws.on('ask_rejected', (data) => askBox.onRejected(data));

ws.connect();
