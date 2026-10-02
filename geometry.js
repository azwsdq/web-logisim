import { VARIABLE_GATES, inputCount, inputPins } from './components.js';
import { pinKey } from './circuit.js';
export const GRID = 10;
export const snap = value => Math.round(value / GRID) * GRID;
export const INPUT_SPACING = 20;
export function localPin(node, pin, output = false) {
  if (output) {
    return { x: 80, y: 30 };
  }
  const inputs = inputPins(node);
  const index = inputs.indexOf(pin);
  if (index < 0) {
    return { x: 0, y: 30 };
  }
  return { x: 0, y: 30 + (index - (inputs.length - 1) / 2) * INPUT_SPACING };
}
export function pinPoint(nodes, reference, output = false) {
  const node = nodes instanceof Map ? nodes.get(reference.node) : nodes.find(node => node.id === reference.node);
  const position = localPin(node, reference.pin, output);
  return { x: node.x + position.x, y: node.y + position.y };
}
export function route(source, target, points = []) {
  const vertices = [source];
  let previous = source;
  for (const point of points) {
    vertices.push({ x: point.x, y: previous.y }, { ...point });
    previous = point;
  }
  const middle = snap((previous.x + target.x) / 2);
  vertices.push({ x: middle, y: previous.y }, { x: middle, y: target.y }, target);
  return vertices.filter((point, index) => index === 0 ||
    point.x !== vertices[index - 1].x || point.y !== vertices[index - 1].y);
}
export const pathFor = points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
// The body span drives the symbol and the frame selection box that the renderer
// highlights, so hit tests match the drawing. Two inputs keep the original
// -22..72 frame; taller gates grow upwards together with their body.
export const LABEL_OFFSET = 14;
export function bodySpan(node) {
  const half = VARIABLE_GATES.includes(node.type) ? (inputCount(node) - 1) * INPUT_SPACING / 2 + 15 : 25;
  return { top: 30 - half, bottom: 30 + half };
}
export function nodeBox(node) {
  const { top, bottom } = bodySpan(node);
  const y = Math.min(-22, top - LABEL_OFFSET - 9);
  return { x: -8, y, width: 96, height: bottom + 17 - y };
}
export const nodeBounds = node => {
  const box = nodeBox(node);
  return { x: node.x + box.x, y: node.y + box.y, width: box.width, height: box.height };
};
export const marqueeBox = (start, end) => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});
export function touchesBox(box, rect) {
  return box.x <= rect.x + rect.width && rect.x <= box.x + box.width &&
    box.y <= rect.y + rect.height && rect.y <= box.y + box.height;
}
// Liang-Barsky clip: the segment counts as touched when it enters or crosses the box.
export function segmentTouchesBox(box, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  let enter = 0, leave = 1;
  for (const [p, q] of [[-dx, start.x - box.x], [dx, box.x + box.width - start.x],
    [-dy, start.y - box.y], [dy, box.y + box.height - start.y]]) {
    if (p === 0) {
      if (q < 0) {
        return false;
      }
      continue;
    }
    const t = q / p;
    if (p < 0) {
      enter = Math.max(enter, t);
    }
    else {
      leave = Math.min(leave, t);
    }
  }
  return enter <= leave;
}
// A wire is picked up when any route segment meets the frame, not only its ends.
export function itemsInBox(model, box) {
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const ids = [];
  for (const node of model.nodes) {
    if (touchesBox(box, nodeBounds(node))) {
      ids.push(node.id);
    }
  }
  for (const wire of model.wires) {
    const path = route(pinPoint(nodes, wire.from, true), pinPoint(nodes, wire.to), wire.points);
    if (path.some((point, index) => index > 0 && segmentTouchesBox(box, path[index - 1], point))) {
      ids.push(wire.id);
    }
  }
  return ids;
}
export function nearestPoint(points, target) {
  let nearest = { distance: Infinity, index: 0, point: points[0] };
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const dx = end.x - start.x, dy = end.y - start.y;
    const projection = ((target.x - start.x) * dx + (target.y - start.y) * dy) / (dx * dx + dy * dy || 1);
    const fraction = Math.max(0, Math.min(1, projection));
    const point = { x: start.x + fraction * dx, y: start.y + fraction * dy };
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < nearest.distance) {
      nearest = { distance, index, point };
    }
  }
  return nearest;
}
function addSegment(index, coordinate, first, second) {
  if (!index.has(coordinate)) {
    index.set(coordinate, []);
  }
  index.get(coordinate).push({ min: Math.min(first, second), max: Math.max(first, second) });
}
function directionsAt(segments = [], position) {
  let directions = 0;
  for (const segment of segments) {
    if (position < segment.min || position > segment.max) {
      continue;
    }
    if (position > segment.min) {
      directions |= 1;
    }
    if (position < segment.max) {
      directions |= 2;
    }
    if (directions === 3) {
      break;
    }
  }
  return directions;
}
function sourceJunctions(wires) {
  const candidates = new Map(), horizontal = new Map(), vertical = new Map();
  for (const wire of wires) {
    for (const point of wire.route) {
      candidates.set(`${point.x},${point.y}`, point);
    }
    for (let index = 1; index < wire.route.length; index++) {
      const start = wire.route[index - 1], end = wire.route[index];
      if (start.y === end.y) {
        addSegment(horizontal, start.y, start.x, end.x);
      }
      if (start.x === end.x) {
        addSegment(vertical, start.x, start.y, end.y);
      }
    }
  }
  const result = [];
  for (const point of candidates.values()) {
    const xDirections = directionsAt(horizontal.get(point.y), point.x);
    const yDirections = directionsAt(vertical.get(point.x), point.y);
    if ((xDirections === 3 && yDirections !== 0) || (yDirections === 3 && xDirections !== 0)) {
      result.push({ ...point, source: wires[0].from.node });
    }
  }
  return result;
}
// Only shared sources can form a junction. Line indices avoid scanning every
// route segment for each candidate vertex on unrelated rows and columns.
export function junctions(wires) {
  const groups = new Map();
  for (const wire of wires) {
    const key = pinKey(wire.from.node, wire.from.pin);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(wire);
  }
  return [...groups.values()].filter(group => group.length > 1).flatMap(sourceJunctions);
}
