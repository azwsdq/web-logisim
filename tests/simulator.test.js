import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, simulate, validate } from '../simulator.js';
test('truth tables for all binary gates', () => {
  const expected = { AND: [0, 0, 0, 1], OR: [0, 1, 1, 1], XOR: [0, 1, 1, 0], NAND: [1, 1, 1, 0], NOR: [1, 0, 0, 0] };
  for (const [type, table] of Object.entries(expected)) {
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        assert.equal(evaluate(type, [a, b]), table[a * 2 + b]);
      }
    }
  }
  assert.equal(evaluate('NOT', [0]), 1);
  assert.equal(evaluate('NOT', [1]), 0);
});
test('transistors pass signals only when enabled', () => {
  for (const type of ['NMOS', 'PMOS']) {
    for (const gate of [0, 1]) {
      for (const source of [0, 1, 'Z', 'X']) {
        assert.equal(evaluate(type, [gate, source]), gate === (type === 'NMOS' ? 1 : 0) ? source : 'Z');
      }
    }
  }
  assert.equal(evaluate('NMOS', ['X', 1]), 'X');
});
test('floating inputs and controlling values', () => {
  assert.equal(evaluate('AND', [0, 'Z']), 0);
  assert.equal(evaluate('OR', [1, 'X']), 1);
  assert.equal(evaluate('XOR', ['Z', 0]), 'X');
  assert.equal(evaluate('NOT', ['Z']), 'X');
});
test('gates keep their meaning with more than two inputs', () => {
  assert.equal(evaluate('AND', [1, 1, 1, 1]), 1);
  assert.equal(evaluate('AND', [1, 0, 1, 'Z']), 0);
  assert.equal(evaluate('AND', [1, 1, 'Z', 1]), 'X');
  assert.equal(evaluate('NAND', [1, 1, 1, 0]), 1);
  assert.equal(evaluate('NAND', [1, 1, 1, 1]), 0);
  assert.equal(evaluate('OR', [0, 0, 'Z', 0]), 'X');
  assert.equal(evaluate('OR', [0, 0, 1, 'X']), 1);
  assert.equal(evaluate('NOR', [0, 0, 0, 0]), 1);
  assert.equal(evaluate('NOR', [0, 0, 0, 1]), 0);
  // XOR is odd parity over every input.
  assert.equal(evaluate('XOR', [1, 1, 1, 1]), 0);
  assert.equal(evaluate('XOR', [1, 0, 1, 0]), 0);
  assert.equal(evaluate('XOR', [1, 0, 1, 0, 1]), 1);
  assert.equal(evaluate('AND', Array(32).fill(1)), 1);
  assert.equal(evaluate('AND', [...Array(31).fill(1), 0]), 0);
  assert.equal(evaluate('XOR', Array(32).fill(0)), 0);
});
test('a three-input gate reads every pin and unconnected inputs stay Z', () => {
  const nodes = [{ id: 'a', type: 'INPUT', value: 1 }, { id: 'b', type: 'INPUT', value: 0 },
    { id: 'c', type: 'INPUT', value: 1 }, { id: 'and', type: 'AND', inputs: 3 }, { id: 'out', type: 'OUTPUT' }];
  const wires = [['a', 'and', 'a'], ['b', 'and', 'b'], ['c', 'and', 'c'], ['and', 'out', 'in']]
    .map(([from, to, pin]) => ({ from: { node: from, pin: 'out' }, to: { node: to, pin } }));
  let result = simulate(nodes, wires);
  assert.equal(result.stable, true);
  assert.equal(result.values.out, 0);
  nodes.find(node => node.id === 'b').value = 1;
  result = simulate(nodes, wires, result.values);
  assert.equal(result.values.out, 1);
  // Losing the third wire must not invent a level on the freed input.
  wires.splice(2, 1);
  assert.equal(simulate(nodes, wires, result.values).values.out, 'X');
});
test('the optional input count is validated and pins follow it', () => {
  const gate = { id: 'g', type: 'AND', x: 0, y: 0, label: 'AND', value: 0 };
  const input = { id: 'a', type: 'INPUT', x: 0, y: 100, label: 'A', value: 1 };
  const wire = pin => ({ id: `w${pin}`, from: { node: 'a', pin: 'out' }, to: { node: 'g', pin } });
  const data = (count, pin) => ({ version: 1, name: 'Count', nodes: [{ ...gate, inputs: count }, input], wires: [wire(pin)] });
  assert.equal(validate(JSON.parse(JSON.stringify(data(3, 'c')))).nodes[0].inputs, 3);
  assert.equal(validate(data(2, 'a')).nodes[0].inputs, 2);
  // Documents without the field stay two-input gates.
  assert.equal(validate({ version: 1, name: 'Count', nodes: [gate, input], wires: [wire('a')] }).nodes[0].inputs, undefined);
  assert.equal(validate(data(32, 'in32')).nodes[0].inputs, 32);
  assert.throws(() => validate(data(2, 'c')), /соединение/);
  for (const count of [1, 33, 2.5, '3', null]) {
    assert.throws(() => validate(data(count, 'a')), /вход/);
  }
  assert.throws(() => validate({ version: 1, name: 'Count', nodes: [{ ...gate, type: 'NOT', inputs: 3 }, input], wires: [] }), /вход/);
});
test('half adder propagates through arbitrary node ordering', () => {
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      const nodes = [{ id: 's', type: 'OUTPUT' }, { id: 'c', type: 'OUTPUT' }, { id: 'xor', type: 'XOR' }, { id: 'and', type: 'AND' }, { id: 'a', type: 'INPUT', value: a }, { id: 'b', type: 'INPUT', value: b }];
      const wires = [['a', 'xor', 'a'], ['b', 'xor', 'b'], ['a', 'and', 'a'], ['b', 'and', 'b'], ['xor', 's', 'in'], ['and', 'c', 'in']].map(([f, t, p]) => ({ from: { node: f, pin: 'out' }, to: { node: t, pin: p } }));
      const result = simulate(nodes, wires);
      assert.equal(result.stable, true);
      assert.equal(result.values.s, a ^ b);
      assert.equal(result.values.c, a & b);
    }
  }
});
test('import rejects dangling connections and duplicate drivers', () => {
  const nodes = [{ id: 'a', type: 'INPUT', x: 0, y: 0, label: 'A', value: 0 }, { id: 'b', type: 'OUTPUT', x: 100, y: 0, label: 'B', value: 0 }];
  const wire = { id: 'w', from: { node: 'a', pin: 'out' }, to: { node: 'b', pin: 'in' } };
  const data = { version: 1, name: 'Test', nodes, wires: [wire] };
  assert.equal(validate(data), data);
  assert.throws(() => validate({ ...data, wires: [wire, { ...wire, id: 'w2' }] }));
  assert.throws(() => validate({ ...data, wires: [{ ...wire, from: { node: 'missing', pin: 'out' } }] }));
  assert.throws(() => validate({ ...data, nodes: [{ ...nodes[0], type: 'toString' }] }));
});
test('wire routes survive JSON round-trip without changing signals; invalid coordinates are rejected', () => {
  const data = { version: 1, name: 'Route', nodes: [{ id: 'a', type: 'INPUT', x: 0, y: 0, label: 'A', value: 1 }, { id: 'b', type: 'OUTPUT', x: 200, y: 0, label: 'B', value: 0 }], wires: [{ id: 'w', from: { node: 'a', pin: 'out' }, to: { node: 'b', pin: 'in' }, points: [{ x: 120, y: 96 }, { x: 168, y: -24 }] }] };
  const restored = validate(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored.wires[0].points, data.wires[0].points);
  assert.equal(simulate(restored.nodes, restored.wires).values.b, 1);
  for (const points of [null, {}, [null], [{ x: '12', y: 0 }], [{ x: Infinity, y: 0 }], [{ x: 0, y: 1000001 }]]) {
    assert.throws(() => validate({ ...data, wires: [{ ...data.wires[0], points }] }), /маршрут/);
  }
});
function latch(type) {
  const nodes = [{ id: 's', type: 'INPUT', value: type === 'NOR' ? 0 : 1 }, { id: 'r', type: 'INPUT', value: type === 'NOR' ? 0 : 1 }, { id: 'q', type }, { id: 'nq', type }, { id: 'out', type: 'OUTPUT' }];
  const wires = (type === 'NOR' ? [['r', 'q', 'a'], ['s', 'nq', 'a']] : [['s', 'q', 'a'], ['r', 'nq', 'a']]).concat([['q', 'nq', 'b'], ['nq', 'q', 'b'], ['q', 'out', 'in']]).map(([from, to, pin]) => ({ from: { node: from, pin: 'out' }, to: { node: to, pin } }));
  return { nodes, wires };
}
for (const type of ['NOR', 'NAND']) {
  test(`${type} RS latch: initialize, set, hold, reset, hold and repeat`, () => {
    for (const reverse of [false, true]) {
      const { nodes, wires } = latch(type);
      if (reverse) {
        nodes.reverse();
      }
      const active = type === 'NOR' ? 1 : 0, idle = 1 - active;
      let state = simulate(nodes, wires).values;
      assert.equal(state.q, 'X'); // No invented power-up state.
      function drive(s, r, q, nq) {
        nodes.find(n => n.id === 's').value = s;
        nodes.find(n => n.id === 'r').value = r;
        const result = simulate(nodes, wires, state);
        assert.equal(result.stable, true);
        state = result.values;
        assert.equal(state.q, q);
        assert.equal(state.nq, nq);
        assert.equal(state.out, q);
      }
      for (let i = 0; i < 5; i++) {
        drive(active, idle, 1, 0);
        drive(idle, idle, 1, 0);
        // Re-render/move/rename must not erase stored state.
        state = simulate(nodes, wires, state).values;
        assert.equal(state.q, 1);
        drive(idle, active, 0, 1);
        drive(idle, idle, 0, 1);
      }
    }
  });
}
test('forbidden NOR latch input and recovery; oscillation is local', () => {
  const { nodes, wires } = latch('NOR');
  nodes.push({ id: 'independent', type: 'INPUT', value: 1 }, { id: 'probe', type: 'OUTPUT' });
  wires.push({ from: { node: 'independent', pin: 'out' }, to: { node: 'probe', pin: 'in' } });
  nodes.find(n => n.id === 's').value = 1;
  nodes.find(n => n.id === 'r').value = 1;
  let result = simulate(nodes, wires);
  assert.equal(result.values.q, 0);
  assert.equal(result.values.nq, 0);
  nodes.find(n => n.id === 's').value = 0;
  nodes.find(n => n.id === 'r').value = 0;
  result = simulate(nodes, wires, result.values);
  assert.equal(result.stable, false);
  assert.equal(result.values.q, 'X');
  assert.equal(result.values.probe, 1);
  nodes.find(n => n.id === 'r').value = 1;
  result = simulate(nodes, wires, result.values);
  assert.equal(result.stable, true);
  assert.equal(result.values.q, 0);
});
test('self-inverter reports oscillation without corrupting an independent gate', () => {
  const nodes = [{ id: 'loop', type: 'NOT' }, { id: 'a', type: 'INPUT', value: 0 }, { id: 'b', type: 'NOT' }];
  const wires = [{ from: { node: 'loop', pin: 'out' }, to: { node: 'loop', pin: 'in' } }, { from: { node: 'a', pin: 'out' }, to: { node: 'b', pin: 'in' } }];
  const result = simulate(nodes, wires, { loop: 0 });
  assert.equal(result.stable, false);
  assert.equal(result.values.loop, 'X');
  assert.equal(result.values.b, 1);
});
test('import accepts saved logic state but rejects invalid state values', () => {
  const data = { version: 1, name: 'State', nodes: [{ id: 'a', type: 'INPUT', value: 1, x: 0, y: 0, label: 'A' }], wires: [], state: { a: 1 } };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(data))).state, { a: 1 });
  for (const state of [null, [], { a: 2 }, { a: '1' }, { a: {} }]) {
    assert.throws(() => validate({ ...data, state }), /состояние/);
  }
});
