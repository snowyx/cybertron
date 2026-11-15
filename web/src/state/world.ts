import { create } from 'zustand';
import { z } from 'zod';
import {
  SnapshotSchema,
  EventSchema,
  type Snapshot,
  type WorldEvent,
} from '../../../shared/protocol';

export type Panel = 'overview' | 'citizens' | 'projects' | 'chronicle' | 'about' | null;
export type View = 'orbit' | 'overview' | 'street';
interface WorldState {
  snapshot: Snapshot | null;
  events: WorldEvent[];
  connected: boolean;
  status: string;
  selected: string | null;
  panel: Panel;
  view: View;
  cameraVersion: number;
  tour: boolean;
  labels: boolean;
  lighting: 'dusk' | 'day';
  quality: 'high' | 'low';
  reducedMotion: boolean;
  modelReady: boolean;
  modelError: string | null;
  pending: boolean;
  notice: string;
  noticeKind: 'info' | 'error';
  destination: Record<string, { target: string; at: number }>;
  set: (patch: Partial<WorldState>) => void;
  select: (id: string | null) => void;
  receive: (raw: unknown) => void;
}
const Envelope = z.object({ type: z.string(), data: z.unknown(), ts: z.number().optional() });
export const useWorld = create<WorldState>((set, get) => ({
  snapshot: null,
  events: [],
  connected: false,
  status: '连接世界中',
  selected: null,
  panel: 'overview',
  view: 'orbit',
  cameraVersion: 0,
  tour: false,
  labels: true,
  lighting: 'dusk',
  quality: 'high',
  reducedMotion: false,
  modelReady: false,
  modelError: null,
  pending: false,
  notice: '',
  noticeKind: 'info',
  destination: {},
  set,
  select: (id) =>
    set({
      selected: id,
      panel: id ? 'citizens' : 'overview',
      tour: false,
      cameraVersion: get().cameraVersion + 1,
    }),
  receive(raw) {
    const parsed = Envelope.safeParse(raw);
    if (!parsed.success) return;
    const { type, data, ts } = parsed.data;
    if (type === 'world_state' || type === 'world_tick') {
      const result = SnapshotSchema.safeParse((data as { snapshot?: unknown })?.snapshot);
      if (!result.success) return;
      set({
        snapshot: result.data,
        ...(type === 'world_state'
          ? { events: result.data.recentEvents, connected: true, status: '世界已连接' }
          : {}),
      });
      return;
    }
    if (type === 'ask_rejected' || type === 'ask_queued' || type === 'ask_accepted') {
      const result = z.object({ message: z.string() }).safeParse(data);
      if (!result.success) return;
      set({
        pending: false,
        notice: result.data.message,
        noticeKind: type === 'ask_rejected' ? 'error' : 'info',
      });
      return;
    }
    if (type === 'service_error') {
      set({ notice: '世界服务暂时异常，请稍后重试。', noticeKind: 'error' });
      return;
    }
    if (!['agent_event', 'discussion_start', 'discussion_speak', 'resolution'].includes(type))
      return;
    const payload = z
      .object({
        agentId: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        text: z.string().optional(),
        question: z.string().optional(),
        kind: z.string().optional(),
        toAgentId: z.string().optional(),
      })
      .safeParse(data);
    if (!payload.success) return;
    const p = payload.data;
    const kind =
      type === 'discussion_start'
        ? 'discussion'
        : type === 'discussion_speak'
          ? 'speak'
          : type === 'resolution'
            ? 'resolution'
            : (p.kind ?? 'act');
    const ev = EventSchema.parse({
      ...p,
      id: `${ts ?? Date.now()}-${get().events.length}`,
      kind,
      text: p.text ?? p.question ?? '',
      ts: ts ?? Date.now(),
    });
    set((s) => ({
      events: [...s.events, ev].slice(-120),
      ...(p.agentId && p.toAgentId
        ? {
            destination: { ...s.destination, [p.agentId]: { target: p.toAgentId, at: Date.now() } },
          }
        : {}),
    }));
  },
}));

export class WorldConnection {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastMessage = 0;
  constructor(readonly url: string) {}
  connect() {
    this.closed = false;
    const ws = new WebSocket(this.url);
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retries = 0;
      this.lastMessage = Date.now();
      ws.send(JSON.stringify({ type: 'hello', data: {} }));
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 12000) {
          ws.close();
          return;
        }
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping', data: {} }));
      }, 4000);
    };
    ws.onmessage = (e) => {
      if (this.socket !== ws) return;
      this.lastMessage = Date.now();
      try {
        const msg = JSON.parse(e.data);
        useWorld.getState().receive(msg);
        if (['ask_accepted', 'ask_rejected', 'ask_queued'].includes(msg.type))
          clearTimeout(this.ackTimer);
      } catch {
        /* Invalid frames never reach the view. */
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.socket !== ws) return;
      clearTimeout(this.ackTimer);
      clearInterval(this.heartbeat);
      useWorld.getState().set({ connected: false, pending: false, status: '连接中断，正在重连' });
      if (!this.closed)
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(15000, 1000 * 2 ** this.retries++) + Math.random() * 300,
        );
    };
  }
  ask(question: string) {
    const q = question.trim();
    if (
      !q ||
      q.length > 200 ||
      !useWorld.getState().connected ||
      useWorld.getState().pending ||
      this.socket?.readyState !== 1
    )
      return false;
    this.socket.send(JSON.stringify({ type: 'visitor_ask', data: { question: q } }));
    useWorld.getState().set({ pending: true, notice: '正在送达星城…', noticeKind: 'info' });
    this.ackTimer = setTimeout(
      () =>
        useWorld.getState().set({
          pending: false,
          notice: '未收到广播确认。请先查看协作记录，避免重复提交。',
          noticeKind: 'error',
        }),
      20000,
    );
    return true;
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.ackTimer);
    clearInterval(this.heartbeat);
    this.socket?.close();
  }
}
