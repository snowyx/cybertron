// 星城地图渲染（design §10、视觉风格 §3/§4/§5、§30.2/§30.3）。
// 全景背景按 §30.3 画外星星球表面三层（星空/星点/星云/行星 → 远山脊/环形山 → 外星地表/陨石坑/矿脉），
// 家节点按 §30.2 用内层 canvas 画赛博朋克科技居住舱（variant=hashId%5 五种剪影，三态辉光）。
// active 亮灯、asleep 熄灯、isolated 告警橙；能量条宽度=energy/energyMax；晶体角标；
// 收到该 agent 的 agent_event 时在其家上方冒霓虹气泡。家节点 click → onEnterHome(agentId)。
// 前端只渲染，不自算数值、不自判隔离（承 §21.5）。

import { hashId } from './pixel-figure.js';

export class TownMap {
  /**
   * @param {HTMLElement} rootEl 地图宿主
   * @param {object} store 只读快照镜像
   * @param {{onEnterHome?:(agentId:string)=>void}} [opts]
   */
  constructor(rootEl, store, opts = {}) {
    this.root = rootEl;
    this.store = store;
    this.onEnterHome = typeof opts.onEnterHome === 'function' ? opts.onEnterHome : null;
    this._nodes = new Map(); // agentId -> element
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 背景层（z 轴在家节点之下，不拦截点击）
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.className = 'town-bg';
    this.root.appendChild(this.bgCanvas);
    this.bgCtx = this.bgCanvas.getContext('2d');

    this._ro = new ResizeObserver(() => this._drawBackground());
    this._ro.observe(this.root);
  }

  /** 首次 / 全量：按快照重建所有家节点。 */
  renderAll() {
    // 清除旧节点但保留背景 canvas
    for (const node of this._nodes.values()) node.remove();
    this._nodes.clear();
    this._drawBackground();
    for (const a of this.store.getAgents()) {
      const node = this._createNode(a);
      this.root.appendChild(node);
      this._nodes.set(a.id, node);
      this._updateNode(a);
    }
  }

  _createNode(a) {
    const node = document.createElement('div');
    node.className = 'home-node';
    node.style.left = `${a.home.x * 100}%`;
    node.style.top = `${a.home.y * 100}%`;
    node.innerHTML = `
      <canvas class="home-canvas" width="120" height="120" aria-hidden="true"></canvas>
      <span class="agent-name">${escapeHtml(a.name)}</span>
      <span class="agent-persona">${escapeHtml(a.persona)}</span>
      <div class="energy-bar"><div class="energy-fill"></div></div>
      <span class="crystal-badge">💎 <span class="crystal-count">0</span></span>
    `;
    // 点击即进入内景（需求 10.1）；键盘可达
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `进入 ${a.name} 的家`);
    const enter = () => this.onEnterHome && this.onEnterHome(a.id);
    node.addEventListener('click', enter);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });
    return node;
  }

  /** 增量：某 agent 状态 / 能量 / 晶体变化后刷新其节点。 */
  updateAgent(agentId) {
    const a = this.store.getAgent(agentId);
    if (a) this._updateNode(a);
  }

  _updateNode(a) {
    const node = this._nodes.get(a.id);
    if (!node) return;
    node.classList.toggle('active', a.status === 'active');
    node.classList.toggle('asleep', a.status === 'asleep');
    node.classList.toggle('isolated', a.status === 'isolated');

    const ratio = a.energyMax > 0 ? Math.max(0, Math.min(1, a.energy / a.energyMax)) : 0;
    const fill = node.querySelector('.energy-fill');
    fill.style.width = `${ratio * 100}%`;
    fill.classList.toggle('low', ratio <= 0.2);

    node.querySelector('.crystal-count').textContent = String(a.crystals ?? 0);

    // 重绘科技居住舱（按 status 切辉光）
    const canvas = node.querySelector('.home-canvas');
    const variant = hashId(a.id) % 5;
    drawHome(canvas.getContext('2d'), { persona: a.persona, status: a.status, variant });
  }

  /** 在某 agent 的家上方冒一个事件气泡。 */
  bubble(agentId, text) {
    const node = this._nodes.get(agentId);
    if (!node) return;
    const b = document.createElement('div');
    b.className = 'bubble';
    b.style.left = node.style.left;
    b.style.top = node.style.top;
    b.textContent = text;
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 3000);
  }

  /** 外星星球表面三层背景（§30.3，固定种子程序化、零外部图片）。 */
  _drawBackground() {
    const rect = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.bgCanvas.width = Math.round(w * this._dpr);
    this.bgCanvas.height = Math.round(h * this._dpr);
    drawBackground(this.bgCtx, w, h, this._dpr);
  }
}

// ── 科技居住舱绘制（§30.2）：5 种 variant 剪影，三态辉光 ──────
function drawHome(ctx, { status, variant }) {
  const W = 120;
  const H = 120;
  ctx.clearRect(0, 0, W, H);

  // 三态配色（承 §3.3 / §21.5）
  let stroke = '#A24BFF';
  let accent = '#38F2E6';
  let glow = 14;
  let alpha = 1;
  if (status === 'asleep') {
    stroke = '#2A2140';
    accent = '#2A2140';
    glow = 2;
    alpha = 0.55;
  } else if (status === 'isolated') {
    stroke = '#FF8A3D';
    accent = '#FF8A3D';
    glow = 12;
    alpha = 1;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const fill = 'rgba(10,7,20,0.85)';

  const setGlow = () => {
    ctx.shadowBlur = glow;
    ctx.shadowColor = stroke;
  };

  // 着陆支架（所有变体通用，落在地面层）
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  setGlow();
  ctx.beginPath();
  ctx.moveTo(38, 104);
  ctx.lineTo(30, 116);
  ctx.moveTo(82, 104);
  ctx.lineTo(90, 116);
  ctx.stroke();

  switch (variant) {
    case 0: // 单穹顶舱
      drawDome(ctx, fill, stroke, accent, setGlow);
      break;
    case 1: // 双舱体 + 桅杆
      drawTwinPod(ctx, fill, stroke, accent, setGlow);
      break;
    case 2: // 塔式居住舱
      drawTower(ctx, fill, stroke, accent, setGlow);
      break;
    case 3: // 低舱体 + 大天线阵
      drawLowAntenna(ctx, fill, stroke, accent, setGlow);
      break;
    default: // 晶体顶舱
      drawCrystalTop(ctx, fill, stroke, accent, setGlow);
      break;
  }
  ctx.restore();
}

function drawDome(ctx, fill, stroke, accent, setGlow) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  setGlow();
  // 舱体
  ctx.beginPath();
  ctx.moveTo(32, 104);
  ctx.lineTo(32, 64);
  ctx.arc(60, 64, 28, Math.PI, 0);
  ctx.lineTo(88, 104);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 发光管线
  pipe(ctx, accent, [[36, 100], [36, 70]]);
  // 舷窗
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.beginPath();
  ctx.arc(60, 72, 8, 0, Math.PI * 2);
  ctx.fill();
  // 桅杆光点
  mast(ctx, stroke, accent, 60, 36, 60, 14);
}

function drawTwinPod(ctx, fill, stroke, accent, setGlow) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  setGlow();
  roundBody(ctx, 26, 72, 36, 32);
  roundBody(ctx, 62, 78, 32, 26);
  pipe(ctx, accent, [[30, 100], [30, 76], [62, 76]]);
  mast(ctx, stroke, accent, 44, 72, 44, 44);
}

function drawTower(ctx, fill, stroke, accent, setGlow) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  setGlow();
  // 塔身
  ctx.beginPath();
  ctx.moveTo(46, 104);
  ctx.lineTo(50, 44);
  ctx.lineTo(70, 44);
  ctx.lineTo(74, 104);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 顶舱
  roundBody(ctx, 48, 30, 24, 18);
  pipe(ctx, accent, [[52, 100], [52, 50]]);
  // 层窗
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  for (let y = 58; y < 100; y += 14) {
    ctx.fillRect(56, y, 10, 4);
  }
  mast(ctx, stroke, accent, 60, 30, 60, 12);
}

function drawLowAntenna(ctx, fill, stroke, accent, setGlow) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  setGlow();
  roundBody(ctx, 28, 80, 64, 24);
  pipe(ctx, accent, [[32, 100], [32, 84], [88, 84]]);
  // 大天线阵
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(44, 80);
  ctx.lineTo(44, 44);
  ctx.moveTo(60, 80);
  ctx.lineTo(60, 36);
  ctx.moveTo(76, 80);
  ctx.lineTo(76, 48);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  for (const [x, y] of [[44, 44], [60, 36], [76, 48]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 天线横杆
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.moveTo(40, 52);
  ctx.lineTo(80, 52);
  ctx.stroke();
}

function drawCrystalTop(ctx, fill, stroke, accent, setGlow) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  setGlow();
  // 六边舱体
  ctx.beginPath();
  ctx.moveTo(40, 104);
  ctx.lineTo(34, 70);
  ctx.lineTo(60, 56);
  ctx.lineTo(86, 70);
  ctx.lineTo(80, 104);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  pipe(ctx, accent, [[38, 100], [38, 72]]);
  // 晶体顶
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.beginPath();
  ctx.moveTo(60, 20);
  ctx.lineTo(50, 48);
  ctx.lineTo(70, 48);
  ctx.closePath();
  ctx.fill();
  // 舷窗
  ctx.beginPath();
  ctx.arc(60, 82, 7, 0, Math.PI * 2);
  ctx.fill();
}

// ── 绘制小工具 ─────────────────────────────────────────────
function roundBody(ctx, x, y, w, h) {
  const r = Math.min(10, w / 3, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function pipe(ctx, accent, pts) {
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

function mast(ctx, stroke, accent, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── 外星星球表面三层背景（§30.3）─────────────────────────────
function drawBackground(ctx, W, H, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // 固定种子 rng：每次渲染一致、不闪烁
  let seed = 1337;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // ① 天空层：星空底
  ctx.fillStyle = '#0A0714';
  ctx.fillRect(0, 0, W, H);

  // 星云（两片半透明径向渐变）
  const neb1 = ctx.createRadialGradient(W * 0.22, H * 0.2, 0, W * 0.22, H * 0.2, W * 0.4);
  neb1.addColorStop(0, 'rgba(162,75,255,0.18)');
  neb1.addColorStop(1, 'rgba(162,75,255,0)');
  ctx.fillStyle = neb1;
  ctx.fillRect(0, 0, W, H);
  const neb2 = ctx.createRadialGradient(W * 0.8, H * 0.32, 0, W * 0.8, H * 0.32, W * 0.38);
  neb2.addColorStop(0, 'rgba(56,242,230,0.12)');
  neb2.addColorStop(1, 'rgba(56,242,230,0)');
  ctx.fillStyle = neb2;
  ctx.fillRect(0, 0, W, H);

  // 星点（固定种子）
  for (let i = 0; i < 90; i++) {
    const x = rng() * W;
    const y = rng() * H * 0.62;
    const r = rng() * 1.3 + 0.3;
    ctx.globalAlpha = 0.35 + rng() * 0.55;
    ctx.fillStyle = rng() < 0.3 ? '#38F2E6' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 远处带光环行星
  const px = W * 0.82;
  const py = H * 0.16;
  const pr = Math.min(W, H) * 0.075;
  const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
  pg.addColorStop(0, 'rgba(162,75,255,0.9)');
  pg.addColorStop(1, 'rgba(90,40,160,0.5)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56,242,230,0.7)';
  ctx.lineWidth = 2;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-0.4);
  ctx.beginPath();
  ctx.ellipse(0, 0, pr * 1.8, pr * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ② 远景层：外星山脊 / 环形山轮廓
  const horizon = H * 0.56;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  let rx = 0;
  while (rx <= W) {
    const ry = horizon - (rng() * H * 0.1 + 6);
    ctx.lineTo(rx, ry);
    rx += W / 12;
  }
  ctx.lineTo(W, horizon);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(42,33,64,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(162,75,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ③ 地面层：外星地表 + 陨石坑 + 霓虹矿脉
  const groundTop = H * 0.68;
  const gg = ctx.createLinearGradient(0, groundTop, 0, H);
  gg.addColorStop(0, 'rgba(20,12,40,0.9)');
  gg.addColorStop(1, 'rgba(10,7,20,1)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, groundTop, W, H - groundTop);

  // 陨石坑（同心椭圆 + 内阴影）
  for (let i = 0; i < 4; i++) {
    const cxp = W * (0.15 + i * 0.22) + rng() * 40;
    const cyp = groundTop + (H - groundTop) * (0.3 + rng() * 0.5);
    const cr = 14 + rng() * 22;
    ctx.strokeStyle = 'rgba(162,75,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cxp, cyp, cr, cr * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cxp, cyp, cr * 0.6, cr * 0.26, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(42,33,64,0.8)';
    ctx.stroke();
  }

  // 霓虹地裂 / 能量矿脉
  ctx.strokeStyle = 'rgba(56,242,230,0.4)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    let vx = rng() * W;
    let vy = groundTop + rng() * 10;
    ctx.moveTo(vx, vy);
    for (let s = 0; s < 5; s++) {
      vx += (rng() - 0.3) * 60;
      vy += rng() * (H - groundTop) * 0.25;
      ctx.lineTo(vx, vy);
    }
    ctx.stroke();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
