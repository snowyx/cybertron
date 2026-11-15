import { z } from 'zod';

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string(),
  home: z.object({ x: z.number(), y: z.number() }),
  status: z.enum(['active', 'asleep', 'isolated']),
  energy: z.number().nonnegative(),
  energyMax: z.number().positive(),
  crystals: z.number().nonnegative(),
});
export const EventSchema = z.object({
  id: z.string().optional(),
  agentId: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  kind: z.string(),
  text: z.string(),
  ts: z.number(),
  toAgentId: z.string().optional(),
});
export const ProjectSchema = z.object({
  progress: z.number().min(0).max(100),
  round: z.number().int().positive(),
  status: z.enum(['building', 'completed']),
});
export const SnapshotSchema = z.object({
  tick: z.number().nonnegative(),
  dayProgress: z.number().min(0).max(1),
  phase: z.enum(['idle', 'discussing']),
  mode: z.enum(['script', 'llm']),
  agents: z.array(AgentSchema),
  recentEvents: z.array(EventSchema),
  project: ProjectSchema,
  discussion: z.object({ id: z.string(), question: z.string() }).nullable().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;
export type WorldEvent = z.infer<typeof EventSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export interface Envelope {
  type: string;
  data: unknown;
  ts: number;
}
export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), data: z.object({}).optional() }),
  z.object({ type: z.literal('ping'), data: z.object({}).optional() }),
  z.object({
    type: z.literal('visitor_ask'),
    data: z.object({ question: z.string().trim().min(1).max(200) }),
  }),
]);

export const CITIZENS = [
  {
    id: 'poet',
    name: 'NOVA-7',
    role: '记忆与文化',
    district: '记忆穹顶',
    color: '#a4ddd7',
    position: [2, 0.11, -18] as const,
    entry: [2, 0.11, -6] as const,
    building: 'civic-dome-pavilion',
    description: '记录世界的细节，让知识之外，也有人记住一段文明的感受。',
  },
  {
    id: 'engineer',
    name: 'RIPR',
    role: '工程与建造',
    district: '工程港',
    color: '#d6af72',
    position: [40, 0.11, -24] as const,
    entry: [30, 0.11, -24] as const,
    building: 'vehicle-depot-hangar',
    description: '验证每一个假设，把公民的共同想法变成可以运行的基础设施。',
  },
  {
    id: 'gossip',
    name: 'ECHO',
    role: '连接与交流',
    district: '交流枢纽',
    color: '#a5bdcb',
    position: [26, 0.11, 20] as const,
    entry: [26, 0.11, 14] as const,
    building: 'transit-station-module',
    description: '在公民之间连接信息，让新的问题找到愿意回应它的智能体。',
  },
  {
    id: 'merchant',
    name: 'ZETA',
    role: '资源与协商',
    district: '资源交易所',
    color: '#c8b894',
    position: [20, 0.11, -46] as const,
    entry: [20, 0.11, -38] as const,
    building: 'retail-podium-arcade',
    description: '衡量有限资源的使用，让协作、贡献和回报形成可持续的循环。',
  },
  {
    id: 'dreamer',
    name: 'LUNA',
    role: '探索与发现',
    district: '生态研究区',
    color: '#a6c4a1',
    position: [0.2, 0.11, 46.4] as const,
    entry: [0.2, 0.11, 40] as const,
    building: 'vertical-farm-tower',
    description: '提出还没有答案的问题，在已知的边界之外寻找新的可能。',
  },
] as const;
export const CORE_POSITION = [-13, 0.11, 21] as const;
