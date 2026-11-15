import test from 'node:test';
import assert from 'node:assert/strict';
import { useWorld } from './world';

test('Invalid server frames are ignored and cannot corrupt UI state', () => {
  useWorld.getState().set({ snapshot: null, events: [] });
  useWorld
    .getState()
    .receive({ type: 'world_state', data: { snapshot: { agents: [{ energy: NaN }] } } });
  assert.equal(useWorld.getState().snapshot, null);
  useWorld.getState().receive({ type: 'agent_event', data: { text: { unsafe: true } } });
  assert.equal(useWorld.getState().events.length, 0);
});
test('Live events remain bounded and visit targets are server-derived', () => {
  for (let i = 0; i < 140; i++)
    useWorld.getState().receive({
      type: 'agent_event',
      data: {
        agentId: 'poet',
        name: 'NOVA-7',
        kind: 'visit',
        text: '拜访',
        toAgentId: 'engineer',
      },
      ts: i,
    });
  assert.equal(useWorld.getState().events.length, 120);
  assert.equal(useWorld.getState().destination.poet.target, 'engineer');
});
