import { DEVELOPER } from '../server/developer.js';
import { AURORA } from '../server/aurora.js';

export function characterPortrait(element, color) {
  element.style.backgroundPosition = `${(color === DEVELOPER || color === AURORA ? 0 : color) * 100 / 3}% 0`;
  element.classList.toggle('developer-portrait', color === DEVELOPER);
  element.classList.toggle('aurora-portrait', color === AURORA);
}
