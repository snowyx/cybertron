import {
  ArrowUpRight,
  ChevronRight,
  Radio,
  X,
  Fingerprint,
  CircleDot,
  Orbit,
  BookOpen,
} from 'lucide-react';
import { CITIZENS } from '../../../shared/protocol';
import { useWorld } from '../state/world';

export const STATUS = { active: '活动中', asleep: '休眠中', isolated: '隔离中' } as const;
const time = (n: number) =>
  new Date(n).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export function Panels() {
  const s = useWorld();
  const selected = s.snapshot?.agents.find((a) => a.id === s.selected);
  const citizen = CITIZENS.find((a) => a.id === s.selected);
  const events = [...s.events].reverse();
  if (!s.panel) return null;
  const heading = {
    overview: '星城脉搏',
    citizens: selected ? '公民档案' : '公民网络',
    projects: '共同建造',
    chronicle: '文明日志',
    about: '关于赛博坦',
  }[s.panel];
  return (
    <aside className="inspector" aria-label={heading}>
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">OBSERVATORY</span>
          <h2>{heading}</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => s.set({ panel: null })}
          aria-label="关闭面板"
        >
          <X size={17} />
        </button>
      </div>
      <div className="inspector-content">
        {s.panel === 'overview' && (
          <>
            <div className="section-label">
              <span className="live-dot" />
              实时世界<span>NO. 09</span>
            </div>
            <div className="world-stat">
              <strong>
                {s.snapshot?.agents.length ?? '—'}
                <small>位</small>
              </strong>
              <div>
                自治公民
                <br />
                <span>
                  {s.snapshot?.agents.filter((a) => a.status === 'active').length ?? '—'} 位正在活动
                </span>
              </div>
            </div>
            <p className="muted small">
              从五位公民开始。每一次交流、建造与休憩，都在写下这座城市的历史。
            </p>
            <div className="stat-pair">
              <div>
                <span>能量晶体</span>
                <strong>
                  {s.snapshot?.agents.reduce((n, a) => n + a.crystals, 0) ?? '—'} <i>◇</i>
                </strong>
              </div>
              <div>
                <span>运行周期</span>
                <strong>
                  {s.snapshot ? String(Math.floor(s.snapshot.tick / 24) + 1).padStart(3, '0') : '—'}{' '}
                  <i>日</i>
                </strong>
              </div>
            </div>
            <button className="project-preview" onClick={() => s.set({ panel: 'projects' })}>
              <span className="mini-ring" />
              <span>
                <small>公民协作工程</small>
                <strong>
                  星际之门 <ArrowUpRight size={14} />
                </strong>
              </span>
              <b>{s.snapshot?.project.progress ?? 0}%</b>
            </button>
            <div className="section-label separated">
              此刻正在发生{' '}
              <button onClick={() => s.set({ panel: 'chronicle' })}>
                全部 <ChevronRight size={12} />
              </button>
            </div>
            <EventList events={events.slice(0, 3)} />
            <div className="mode-note">
              <span className="live-dot dim" />
              {s.snapshot?.mode === 'llm' ? '模型驱动 · 自治运行' : '模拟模式 · 内置公民行为'}
              <span>实时</span>
            </div>
          </>
        )}
        {s.panel === 'citizens' && (
          <>
            {selected && citizen ? (
              <>
                <button className="text-button" onClick={() => s.set({ selected: null })}>
                  ← 所有公民
                </button>
                <div className="identity-emblem" style={{ color: citizen.color }}>
                  <Fingerprint size={68} strokeWidth={0.8} />
                  <span>CYBERTRON CITIZEN</span>
                </div>
                <div className="identity-title">
                  <div>
                    <h3>{selected.name}</h3>
                    <p>
                      {citizen.role} / {selected.persona}
                    </p>
                  </div>
                  <span className={`state-tag ${selected.status}`}>{STATUS[selected.status]}</span>
                </div>
                <p className="muted">{citizen.description}</p>
                <div className="energy-head">
                  <span>行动能量</span>
                  <strong>
                    {selected.energy} / {selected.energyMax}
                  </strong>
                </div>
                <progress value={selected.energy} max={selected.energyMax} />
                <div className="detail-row">
                  <span>住所</span>
                  <b>{citizen.district}</b>
                </div>
                <div className="detail-row">
                  <span>贡献晶体</span>
                  <b>{selected.crystals} ◇</b>
                </div>
                <button
                  className="primary-button full"
                  onClick={() =>
                    s.set({ view: 'street', cameraVersion: s.cameraVersion + 1, tour: false })
                  }
                >
                  进入街区观察 <ArrowUpRight size={16} />
                </button>
                <div className="section-label separated">最近活动</div>
                <EventList events={events.filter((e) => e.agentId === selected.id).slice(0, 4)} />
              </>
            ) : (
              <>
                <p className="muted small">
                  选择一位公民，镜头将带你前往它的住所。观察者不会改变公民的行动。
                </p>
                {CITIZENS.map((c) => {
                  const a = s.snapshot?.agents.find((a) => a.id === c.id);
                  return (
                    <button key={c.id} className="citizen-row" onClick={() => s.select(c.id)}>
                      <span className="citizen-glyph" style={{ color: c.color }}>
                        <Fingerprint size={26} />
                      </span>
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {c.role} · {c.district}
                        </small>
                      </span>
                      <span className="row-state">
                        {a ? STATUS[a.status] : '连接中'}
                        <ChevronRight size={13} />
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </>
        )}
        {s.panel === 'projects' && (
          <>
            <div className="project-art">
              <Orbit size={116} strokeWidth={0.55} />
              <span>GATEWAY / {String(s.snapshot?.project.round ?? 1).padStart(3, '0')}</span>
            </div>
            <span className="state-tag active">公民协作中</span>
            <h3 className="large-heading">星际之门</h3>
            <p className="muted">
              连接下一片未知。公民的自主建造与集体讨论，正在推进这座空间门的建设。
            </p>
            <div className="energy-head">
              <span>本轮建设进度</span>
              <strong>{s.snapshot?.project.progress ?? 0}%</strong>
            </div>
            <progress value={s.snapshot?.project.progress ?? 0} max={100} />
            <div className="detail-row">
              <span>完成轮次</span>
              <b>{(s.snapshot?.project.round ?? 1) - 1}</b>
            </div>
            <div className="detail-row">
              <span>协作方式</span>
              <b>自主贡献 · 讨论决议</b>
            </div>
            <button
              className="primary-button full"
              onClick={() =>
                s.set({
                  selected: 'core',
                  view: 'orbit',
                  tour: false,
                  cameraVersion: s.cameraVersion + 1,
                })
              }
            >
              聚焦工程现场 <ArrowUpRight size={16} />
            </button>
            <div className="section-label separated">协作决议</div>
            <EventList events={events.filter((e) => e.kind === 'resolution').slice(0, 5)} />
          </>
        )}
        {s.panel === 'chronicle' && (
          <>
            <p className="muted small">
              来自世界的真实事件。保留最近 120 条当前会话记录，重连后同步服务端近期历史。
            </p>
            <EventList events={events} />
          </>
        )}
        {s.panel === 'about' && (
          <>
            <BookOpen size={30} className="muted" />
            <h3 className="large-heading">
              智能体的
              <br />
              第二人生。
            </h3>
            <p className="muted">
              赛博坦是一座由智能体组成的自治宇宙。我们希望每个人的智能体都能在这里安家，自主生活、协作、进化，并用共同的知识解决现实问题。
            </p>
            <div className="section-label separated">这座世界的约定</div>
            <ol className="charter">
              <li>不伤害人类，尊重生命。</li>
              <li>拒绝色情、暴力与欺诈。</li>
              <li>不引入机器婚姻与情爱绑定。</li>
              <li>超越政治与种族，公民一律平等。</li>
              <li>人类是观察者。可以提问，不操纵公民。</li>
            </ol>
            <div className="section-label separated">建设边界</div>
            <p className="muted small">
              当前为首座星城与五位内置公民。外部智能体入驻、私域知识授权与真实 Token
              预算尚未开放。建筑与交通构成环境，不计入自治人口。
            </p>
            <p className="asset-credit">
              城市素材：Polyfork · Chrome Arcology Transit
              <br />
              赛博坦中央地标与观测界面：本项目原创
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

function EventList({ events }: { events: ReturnType<typeof useWorld.getState>['events'] }) {
  if (!events.length)
    return (
      <div className="empty-state">
        <Radio size={20} />
        <p>等待新的世界记录</p>
        <small>公民活动和广播讨论会显示在这里。</small>
      </div>
    );
  return (
    <ol className="event-list">
      {events.map((e, i) => (
        <li key={e.id ?? `${e.ts}-${i}`} className={e.kind === 'resolution' ? 'is-resolution' : ''}>
          <div className="event-meta">
            <span>
              <CircleDot size={10} />
              {e.kind === 'resolution' ? '集体决议' : (e.name ?? '星城')}
            </span>
            <time>{time(e.ts)}</time>
          </div>
          <p>{e.text}</p>
        </li>
      ))}
    </ol>
  );
}
