// 虫洞超时空传送器装置（design §20.6 / §30.1）。
// 在全景地图上渲染显眼的霓虹虫洞环 + 底部进度条（纯 Canvas 手绘）：
//   - 进度条宽度 = progress/100，青紫→晶体青渐变；轮次角标「第 N 座」。
//   - 进度数值只读 store.snapshot.project，前端不自增；进度条做补间动画（表现层，不改数值来源）。
//   - 收到 project_update{status:'completed'} 触发一次性建成动画（辉光爆发 + 环旋转），
//     随后 {progress:0} 帧把进度归零、显示新轮次。
// 前端只渲染后端下发的进度，绝不自推进共享状态。

export class Wormhole {
  /**
   * @param {HTMLCanvasElement} canvasEl 挂在全景地图上方的装置画布
   * @param {object} store 只读快照镜像
   */
  constructor(canvasEl, store) {
    this.canvas = canvasEl;
    this.store = store;
    this.ctx = canvasEl.getContext('2d');

    this._shownProgress = 0; // 补间显示值（平滑逼近真实值）
    this._rotation = 0; // 环旋转相位
    this._burst = 0; // 建成辉光爆发强度 [0,1]，>0 时衰减
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvasEl);

    this._running = true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(w * this._dpr);
    this.canvas.height = Math.round(h * this._dpr);
    this._w = w;
    this._h = h;
  }

  /** store 的 project 快照（防御式读取，缺省回退）。 */
  _project() {
    const p = this.store.snapshot && this.store.snapshot.project;
    return p || { progress: 0, round: 1, status: 'building' };
  }

  /** 收到 project_update{status:'completed'} 时由 main.js 调用，触发建成动画。 */
  onCompleted() {
    this._burst = 1;
  }

  /** 由 main.js 在 project_update / world_state 后调用一次（补间会在 rAF 里继续追）。 */
  render() {
    // 真正绘制在 rAF 循环里持续进行；此方法仅作为语义挂点（§20.6 main.js 调用约定）。
  }

  _loop() {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    const p = this._project();
    const target = Math.max(0, Math.min(100, p.progress));

    // 补间：平滑逼近真实进度（表现层）
    const diff = target - this._shownProgress;
    this._shownProgress += diff * 0.12;
    if (Math.abs(diff) < 0.3) this._shownProgress = target;

    // 建成时环旋转更快、辉光衰减
    this._rotation += this._burst > 0 ? 0.06 : 0.012;
    if (this._burst > 0) this._burst = Math.max(0, this._burst - 0.012);

    this._draw(p);
  }

  _draw(p) {
    const ctx = this.ctx;
    const W = this._w;
    const H = this._h;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const ringCY = H * 0.42;
    const R = Math.min(W * 0.5, H * 0.52) * 0.72;

    // 尺寸守卫：容器被隐藏/折叠（如进入家内景时）或过小会让 R 过小，
    // 后续 arc(R - i*6) 可能传入负半径而每帧抛 IndexSizeError。
    // R 不足以安全绘制时本帧直接跳过（已 clearRect），不影响容器恢复尺寸后重新绘制。
    if (!(R > 24)) return;

    // ── 虫洞环（多层霓虹同心环 + 旋转刻度） ────────────────
    ctx.save();
    ctx.translate(cx, ringCY);

    // 外层辉光爆发（建成时）
    if (this._burst > 0) {
      ctx.save();
      ctx.globalAlpha = this._burst;
      const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.8);
      g.addColorStop(0, 'rgba(56,242,230,0.6)');
      g.addColorStop(0.5, 'rgba(162,75,255,0.35)');
      g.addColorStop(1, 'rgba(162,75,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 环本体：青紫→晶体青渐变描边，多层发光
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, R - i * 6, 0, Math.PI * 2);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(162,75,255,0.85)' : 'rgba(56,242,230,0.8)';
      ctx.lineWidth = 3 - i * 0.6;
      ctx.shadowBlur = 18;
      ctx.shadowColor = i % 2 === 0 ? '#A24BFF' : '#38F2E6';
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 内部漩涡：旋转刻度段
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const a = this._rotation + (i / segs) * Math.PI * 2;
      const r0 = R * 0.46;
      const r1 = R * 0.9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(56,242,230,0.28)' : 'rgba(162,75,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 内核光点
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
    core.addColorStop(0, 'rgba(56,242,230,0.5)');
    core.addColorStop(1, 'rgba(10,7,20,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── 底部进度条 ──────────────────────────────────────
    const barW = Math.min(W * 0.8, R * 2.2);
    const barX = cx - barW / 2;
    const barY = ringCY + R + 18;
    const barH = 12;

    // 轨道
    ctx.fillStyle = 'rgba(42,33,64,0.85)';
    roundRect(ctx, barX, barY, barW, barH, 6);
    ctx.fill();

    // 填充：青紫→晶体青渐变，宽度 = shownProgress/100
    const ratio = Math.max(0, Math.min(1, this._shownProgress / 100));
    if (ratio > 0) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad.addColorStop(0, '#A24BFF');
      grad.addColorStop(1, '#38F2E6');
      ctx.fillStyle = grad;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#38F2E6';
      roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ── 文案：轮次角标 + 百分比 ─────────────────────────
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(12, Math.round(W * 0.028))}px "PingFang SC", system-ui, sans-serif`;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#A24BFF';
    const label = p.status === 'completed' ? '虫洞开启！' : `第 ${p.round} 座 · 虫洞超时空传送器`;
    ctx.fillText(label, cx, barY + barH + 22);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#38F2E6';
    ctx.font = `600 ${Math.max(10, Math.round(W * 0.022))}px "PingFang SC", system-ui, sans-serif`;
    ctx.fillText(`${Math.round(this._shownProgress)}%`, cx, barY - 8);
  }

  destroy() {
    this._running = false;
    if (this._ro) this._ro.disconnect();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
