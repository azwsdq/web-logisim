import { bodySpan } from '../geometry.js';

function gateBody(node) {
  const { top, bottom } = bodySpan(node);
  // OR family: the same curves stretched to the taller body, so two inputs match the old path.
  if (['OR', 'NOR', 'XOR'].includes(node.type)) {
    return `M10 ${top} Q34 30 10 ${bottom} Q50 ${bottom} 65 30 Q50 ${top} 10 ${top} Z`;
  }
  // AND family: a half ellipse, so the body keeps its width while it grows tall.
  return `M10 ${top} H35 A25 ${30 - top} 0 0 1 35 ${bottom} H10 Z`;
}

export function shape(node) {
  if (node.type === 'INPUT') {
    return '<rect class="body" x="10" y="10" width="50" height="40"/>';
  }
  if (node.type === 'OUTPUT') {
    return '<path class="body" d="M10 10 H50 L65 30 L50 50 H10 Z"/>';
  }
  if (node.type === 'NOT') {
    return '<path class="body" d="M10 5 V55 L60 30 Z"/><circle class="body" cx="65" cy="30" r="5"/>';
  }
  if (node.type === 'NMOS' || node.type === 'PMOS') {
    return `<path fill="none" stroke="currentColor" stroke-width="2" d="M0 20 H25 M25 8 V50 M34 8 V50 M34 10 H60 V30 H80 M34 45 H50 V60 H5 V40 H0"/>${node.type === 'PMOS' ? '<circle class="body" cx="20" cy="20" r="4"/>' : ''}<path fill="currentColor" d="${node.type === 'NMOS' ? 'M45 40 L37 45 L45 50' : 'M38 40 L46 45 L38 50'}"/>`;
  }
  const { top, bottom } = bodySpan(node);
  const xor = node.type === 'XOR'
    ? `<path d="M3 ${top} Q27 30 3 ${bottom}" fill="none" stroke="currentColor" stroke-width="1.8"/>` : '';
  const bubble = ['NAND', 'NOR'].includes(node.type) ? '<circle class="body" cx="70" cy="30" r="5"/>' : '';
  return `<path class="body" d="${gateBody(node)}"/>${xor}${bubble}`;
}
export const color = v => v === 1 ? '#00b000' : v === 0 ? '#006400' : v === 'Z' ? '#999' : '#155acc';
