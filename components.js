export const TYPES = {
  INPUT: { name: 'Вход', group: 'ВХОДЫ И ВЫХОДЫ', inputs: [], outputs: ['out'] },
  OUTPUT: { name: 'Выход', group: 'ВХОДЫ И ВЫХОДЫ', inputs: ['in'], outputs: [] },
  AND: { name: 'AND', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['a', 'b'], outputs: ['out'] },
  OR: { name: 'OR', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['a', 'b'], outputs: ['out'] },
  XOR: { name: 'XOR', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['a', 'b'], outputs: ['out'] },
  NOT: { name: 'NOT', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['in'], outputs: ['out'] },
  NAND: { name: 'NAND', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['a', 'b'], outputs: ['out'] },
  NOR: { name: 'NOR', group: 'ЛОГИЧЕСКИЕ ВЕНТИЛИ', inputs: ['a', 'b'], outputs: ['out'] },
  NMOS: { name: 'n-MOS', group: 'ТРАНЗИСТОРЫ', inputs: ['gate', 'source'], outputs: ['out'] },
  PMOS: { name: 'p-MOS', group: 'ТРАНЗИСТОРЫ', inputs: ['gate', 'source'], outputs: ['out'] }
};
export const SIGNALS = [0, 1, 'X', 'Z'];
export const isSignal = value => SIGNALS.includes(value);
// Gates whose input count is a property of the instance, not of the type.
export const VARIABLE_GATES = ['AND', 'OR', 'XOR', 'NAND', 'NOR'];
export const MIN_INPUTS = 2;
export const MAX_INPUTS = 32;
// Pin names keep 'a' and 'b' first, so existing wires stay valid.
export function pinName(index) {
  return index < 26 ? String.fromCharCode(97 + index) : `in${index + 1}`;
}
export function inputCount(node) {
  if (!VARIABLE_GATES.includes(node.type)) {
    return TYPES[node.type].inputs.length;
  }
  return Math.min(MAX_INPUTS, Math.max(MIN_INPUTS, Math.trunc(node.inputs) || TYPES[node.type].inputs.length));
}
export function inputPins(node) {
  return VARIABLE_GATES.includes(node.type)
    ? Array.from({ length: inputCount(node) }, (_, index) => pinName(index))
    : TYPES[node.type].inputs;
}
