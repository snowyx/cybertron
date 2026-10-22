// 装配入口（design §10）：连接 ws，把帧分发到 store 与各渲染模块。
// 前端只渲染，不自行推进任何共享状态。
// 二期：view:'town'|'home' 本地视图切换 + 内景/虫洞/弹窗实例化 + project_update 分发。

import { WsClient } from './ws-client.js';
import { Store } from './store.js';
import { TownMap } from './town-map.js';
import { EventFeed } from './event-feed.js';
import { AskBox } from './ask-box.js';
import { HomeInterior } from './home-interior.js';
import { Wormhole } from './wormhole.js';
import { Modals } from './modals.js';
import { Onboarding } from './onboarding.js';

const store = new Store();
const ws = new WsClient();

const mapEl = document.getElementById('town-map');
const feedEl = document.getElementById('event-feed');
const badgeEl = document.getElementById('mode-badge');
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

const askBox = new AskBox(
  {
    inputEl: document.getElementById('ask-input'),
    sendEl: document.getElementById('ask-send'),
    hintEl: document.getElementById('ask-hint'),
  },
  ws,
);

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
  updateBadge();
});

ws.on('agent_update', (data) => {
  store.applyAgentUpdate(data);
  // 全景家节点 + 内景小人同步 isolated/asleep/active 表现（内景由其 store 订阅自动处理）
  townMap.updateAgent(data.agentId);
});

// ── 事件叙事帧 → 地图气泡 + 事件流（+ 访客关系登记） ────────
ws.on('agent_event', (data) => {
  feed.addEvent({ name: data.name, text: data.text, interaction: data.interaction });
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
  feed.addSpeak({ name: data.name, text: data.text });
  townMap.bubble(data.agentId, data.text);
});

ws.on('resolution', (data) => {
  feed.addResolution({ text: data.text });
});

// ── 虫洞工程进度（唯一新增下行帧 project_update，§20.6）─────
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

function updateBadge() {
  const mode = store.mode;
  badgeEl.textContent = `轨道：${mode === 'llm' ? '真实模型' : '剧本'}`;
}

ws.connect();
