import { TYPES, isSignal, VARIABLE_GATES, MAX_INPUTS, MIN_INPUTS, inputPins } from './components.js';
export const DOCUMENT_VERSION = 1;
export const LIMITS = { nodes: 1000, wires: 5000, points: 1000, coordinate: 1e6 };
// Tuples avoid collisions when imported IDs contain punctuation.
export const pinKey = (node, pin) => JSON.stringify([node, pin]);
export function indexCircuit(model) {
  return {
    nodes: new Map(model.nodes.map(node => [node.id, node])),
    wires: new Map(model.wires.map(wire => [wire.id, wire])),
    incoming: new Map(model.wires.map(wire => [pinKey(wire.to.node, wire.to.pin), wire])),
  };
}
function isPoint(point) {
  return point != null && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= LIMITS.coordinate);
}
function validateNodes(nodes) {
  const byId = new Map();
  for (const node of nodes) {
    // A gate input count is optional; documents without it stay two-input gates.
    if (node?.inputs !== undefined && !(VARIABLE_GATES.includes(node.type) &&
      Number.isInteger(node.inputs) && node.inputs >= MIN_INPUTS && node.inputs <= MAX_INPUTS)) {
      throw new Error('Некорректное число входов');
    }
    if (!node || typeof node.id !== 'string' || byId.has(node.id) ||
      !Object.hasOwn(TYPES, node.type) || !isPoint(node) ||
      typeof node.label !== 'string' || ![0, 1].includes(node.value)) {
      throw new Error('Некорректный компонент');
    }
    byId.set(node.id, node);
  }
  return byId;
}
function validateWires(wires, nodes) {
  const occupiedPins = new Set();
  const ids = new Set();
  for (const wire of wires) {
    const source = nodes.get(wire?.from?.node);
    const target = nodes.get(wire?.to?.node);
    const destination = pinKey(wire?.to?.node, wire?.to?.pin);
    if (!wire || typeof wire.id !== 'string' || ids.has(wire.id) ||
      !source || !target ||
      !TYPES[source.type].outputs.includes(wire.from.pin) ||
      !inputPins(target).includes(wire.to.pin) || occupiedPins.has(destination)) {
      throw new Error('Некорректное соединение');
    }
    if (wire.points !== undefined && (!Array.isArray(wire.points) ||
      wire.points.length > LIMITS.points || !wire.points.every(isPoint))) {
      throw new Error('Некорректный маршрут провода');
    }
    occupiedPins.add(destination);
    ids.add(wire.id);
  }
}
export function validate(data) {
  if (!data || data.version !== DOCUMENT_VERSION || typeof data.name !== 'string' ||
    !Array.isArray(data.nodes) || !Array.isArray(data.wires) ||
    data.nodes.length > LIMITS.nodes || data.wires.length > LIMITS.wires) {
    throw new Error('Некорректный формат схемы');
  }
  validateWires(data.wires, validateNodes(data.nodes));
  if (data.state !== undefined && (data.state === null ||
    typeof data.state !== 'object' || Array.isArray(data.state) ||
    !Object.values(data.state).every(isSignal))) {
    throw new Error('Некорректное состояние симуляции');
  }
  return data;
}
export function toDocument(model, values) {
  const state = Object.fromEntries(model.nodes
    .filter(node => Object.hasOwn(values, node.id))
    .map(node => [node.id, values[node.id]]));
  return { ...model, state };
}
export function fromDocument(data) {
  const { version, name, nodes, wires, state = {} } = validate(data);
  return { model: { version, name, nodes, wires }, values: state };
}
