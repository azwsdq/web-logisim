import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, junctions, marqueeBox, nodeBounds, segmentTouchesBox, touchesBox, itemsInBox, localPin, bodySpan, nodeBox } from '../geometry.js';
import { inputPins } from '../components.js';
import { halfAdder } from '../examples.js';
test('routes stay orthogonal through user points and terminate at both pins', () => {
  const a = { x: 10, y: 20 }, b = { x: 300, y: 50 }, points = [{ x: 200, y: 100 }, { x: 100, y: 150 }];
  const path = route(a, b, points);
  assert.deepEqual(path[0], a);
  assert.deepEqual(path.at(-1), b);
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y);
  }
  for (const p of points) {
    assert.ok(path.some(q => q.x === p.x && q.y === p.y));
  }
});
test('T branch gets a dot; an unrelated crossing does not', () => {
  const from = { node: 'input', pin: 'out' };
  const trunk = { from, route: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const branch = { from, route: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }] };
  assert.deepEqual(junctions([trunk, branch]), [{ x: 50, y: 0, source: 'input' }]);
  assert.deepEqual(junctions([trunk, { ...branch, from: { node: 'other', pin: 'out' } }]), []);
});
test('a frame works from either drag direction and covers a node body', () => {
  assert.deepEqual(marqueeBox({ x: 90, y: 40 }, { x: 10, y: 100 }), { x: 10, y: 40, width: 80, height: 60 });
  const node = { x: 100, y: 200 };
  assert.deepEqual(nodeBounds(node), { x: 92, y: 178, width: 96, height: 94 });
  assert.equal(touchesBox({ x: 90, y: 180, width: 20, height: 20 }, nodeBounds(node)), true);
  assert.equal(touchesBox({ x: 90, y: 100, width: 20, height: 20 }, nodeBounds(node)), false);
});
test('segments join the frame when they cross it, not when they miss it', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(segmentTouchesBox(box, { x: -50, y: 50 }, { x: 150, y: 50 }), true);
  assert.equal(segmentTouchesBox(box, { x: 50, y: 20 }, { x: 50, y: 90 }), true);
  assert.equal(segmentTouchesBox(box, { x: 0, y: 0 }, { x: 0, y: 0 }), true, 'a corner point counts');
  assert.equal(segmentTouchesBox(box, { x: -50, y: -50 }, { x: -10, y: -10 }), false);
  assert.equal(segmentTouchesBox(box, { x: 120, y: 120 }, { x: 200, y: 200 }), false);
  assert.equal(segmentTouchesBox(box, { x: 40, y: -50 }, { x: 40, y: 150 }), true, 'diagonal routes also work');
});
test('gate pins spread on the grid and the frame follows the body', () => {
  const gate = { type: 'AND' };
  assert.deepEqual(localPin(gate, 'a'), { x: 0, y: 20 });
  assert.deepEqual(localPin(gate, 'b'), { x: 0, y: 40 });
  assert.deepEqual(localPin({ type: 'AND', inputs: 3 }, 'c'), { x: 0, y: 50 });
  assert.deepEqual(localPin({ type: 'OR', inputs: 4 }, 'd'), { x: 0, y: 60 });
  assert.deepEqual(localPin({ type: 'AND', inputs: 32 }, 'in32'), { x: 0, y: 340 });
  for (const count of [2, 3, 4, 7, 32]) {
    const node = { type: 'AND', inputs: count };
    const ys = inputPins(node).map(name => localPin(node, name).y);
    assert.equal(ys.length, count);
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'pins run from top to bottom');
    assert.ok(ys.every(y => y % 10 === 0), 'pins stay on the grid');
  }
  // Two inputs keep the original span, so symbols placed before stay where they were.
  assert.deepEqual(bodySpan(gate), { top: 5, bottom: 55 });
  assert.deepEqual(nodeBox(gate), { x: -8, y: -22, width: 96, height: 94 });
  assert.deepEqual(bodySpan({ type: 'XOR', inputs: 3 }), { top: -5, bottom: 65 });
  assert.deepEqual(nodeBox({ type: 'XOR', inputs: 3 }), { x: -8, y: -28, width: 96, height: 110 });
  const wide = { type: 'NAND', inputs: 8 }, box = nodeBox(wide);
  assert.ok(box.y <= bodySpan(wide).top - 23, 'the label stays inside the frame');
  assert.ok(box.y + box.height >= bodySpan(wide).bottom, 'the body stays inside the frame');
  // A pin name outside the set falls back to the centre instead of failing.
  assert.deepEqual(localPin(gate, 'c'), { x: 0, y: 30 });
});
test('a frame takes every component and wire it touches', () => {
  const model = halfAdder();
  const nodes = new Set(model.nodes.map(node => node.id));
  assert.deepEqual(itemsInBox(model, marqueeBox({ x: 900, y: 900 }, { x: 1000, y: 1000 })), []);
  assert.deepEqual(itemsInBox(model, marqueeBox({ x: 100, y: 420 }, { x: 250, y: 480 })), [], 'empty area below the circuit');
  // Upper band: the three top components plus the wires that reach into the band,
  // including the fan-out legs of the lower row that pass through it.
  const top = itemsInBox(model, marqueeBox({ x: 60, y: 80 }, { x: 620, y: 200 }));
  assert.deepEqual(top.filter(id => nodes.has(id)).sort(), ['a', 'sum', 'xor']);
  assert.ok(top.includes('w0') && top.includes('w4'), 'wires inside the band come along');
  assert.ok(!top.includes('w3') && !top.includes('w5'), 'wires below the band stay out');
  // A frame in the middle gap reaches the fan-out legs but neither gate.
  assert.deepEqual(itemsInBox(model, marqueeBox({ x: 200, y: 260 }, { x: 300, y: 360 })), ['w1', 'w2', 'w3']);
});
