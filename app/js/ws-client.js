// WebSocket 客户端（design §10）。
// 职责：连 CONFIG.WS_URL、open 后自动发 hello、按 type 分发、hello_ok 前业务帧排队、
//       断线指数退避重连、重连后以收到的 world_state 全量对齐。
// 不含任何业务状态——状态归 store.js。

import { CONFIG } from './config.js';

export class WsClient {
  constructor(url = CONFIG.WS_URL) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map(); // type -> Set<fn>
    this.anyHandlers = new Set();
    this._reconnectTimer = null;
    this._reconnectDelay = 1000;
    this._helloAcked = false;
    this._manualClose = false;
    this._queue = []; // hello_ok 之前排队的业务消息
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  onAny(fn) {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  connect() {
    this._manualClose = false;
    this._open();
  }

  _open() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.error('[ws] 连接创建失败', e);
      this._scheduleReconnect();
      return;
    }
    this._helloAcked = false;

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 1000;
      this._dispatch('_connected', {});
      // 首帧契约：先发 hello
      this._raw({ type: 'hello', data: {} });
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      const { type, data } = msg;

      if (type === 'hello_ok') {
        this._helloAcked = true;
        const q = this._queue;
        this._queue = [];
        for (const f of q) this._raw(f);
      }

      this._dispatch(type, data);
    });

    this.ws.addEventListener('close', () => {
      this._helloAcked = false;
      this._dispatch('_disconnected', {});
      if (!this._manualClose) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // close 事件会跟进处理重连
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 8000);
      this._open();
    }, delay);
  }

  _dispatch(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) { try { fn(data); } catch (e) { console.error(e); } }
    for (const fn of this.anyHandlers) { try { fn(type, data); } catch (e) { console.error(e); } }
  }

  /** 发送上行业务消息。hello_ok 之前自动排队，确保首帧契约。 */
  send(type, data = {}) {
    if (!this._helloAcked && type !== 'hello') {
      this._queue.push({ type, data });
      return;
    }
    this._raw({ type, data });
  }

  _raw(f) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...f, ts: Date.now() }));
    }
  }

  close() {
    this._manualClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) this.ws.close();
  }
}
