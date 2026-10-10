import { describe, expect, it } from 'vitest';
import { buildSampleMap } from '../../data/sampleMap';
import { connect, mergeNodes, removeNode } from './graph';
import { emptyGraph } from './types';
import { validateGraph } from './validate';

describe('validateGraph', () => {
  it('accepts the sample map with no errors or warnings', () => {
    const r = validateGraph(buildSampleMap());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.components).toHaveLength(1);
  });

  it('flags an empty map', () => {
    expect(validateGraph(emptyGraph())).toMatchObject({ ok: false, issues: [{ code: 'empty' }] });
  });

  it('detects disconnected floors', () => {
    const g = buildSampleMap();
    g.edges = g.edges.filter((e) => e.kind !== 'stairs' && e.kind !== 'elevator');
    const r = validateGraph(g);
    expect(r.issues.map((i) => i.code)).toContain('disconnected');
    expect(r.components).toHaveLength(2);
  });

  it('detects unmatched doors and isolated nodes', () => {
    const g = buildSampleMap();
    g.nodes.push({ id: 'dx', kind: 'door', floorId: 'g', position: { x: 30, y: 0 }, label: 'Mystery door' });
    const r = validateGraph(g);
    expect(r.issues.find((i) => i.code === 'unmatched_door')?.nodeIds).toEqual(['dx']);
    expect(r.issues.find((i) => i.code === 'isolated_node')?.nodeIds).toEqual(['dx']);
  });

  it('errors on dangling edges and flat edges across floors', () => {
    let g = buildSampleMap();
    g = removeNode(g, 'g-kit');
    g.edges.push({ id: 'bad', from: 'g-kitd', to: 'ghost', kind: 'walk', length: 1 });
    g = connect(g, 'g-lobby', 'f1-lounge', 'walk');
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['dangling_edge', 'cross_floor_walk_edge']));
  });

  it('warns when no exit exists', () => {
    const g = buildSampleMap();
    g.nodes = g.nodes.map((n) => ({ ...n, exterior: false, poiType: n.poiType === 'exit' ? undefined : n.poiType }));
    expect(validateGraph(g).issues.map((i) => i.code)).toContain('no_exit');
  });
});

describe('graph edits', () => {
  it('mergeNodes rewires edges and removes duplicates', () => {
    let g = buildSampleMap();
    g = mergeNodes(g, 'g-j2', 'g-kitd');
    expect(g.nodes.find((n) => n.id === 'g-kitd')).toBeUndefined();
    expect(g.edges.some((e) => e.from === 'g-kitd' || e.to === 'g-kitd')).toBe(false);
    expect(g.edges.some((e) => (e.from === 'g-j2' && e.to === 'g-kit') || (e.from === 'g-kit' && e.to === 'g-j2'))).toBe(true);
    expect(g.edges.filter((e) => e.from === e.to)).toEqual([]);
  });

  it('connect does not duplicate edges', () => {
    const g = buildSampleMap();
    expect(connect(g, 'g-lobby', 'g-j1').edges.length).toBe(g.edges.length);
  });
});
