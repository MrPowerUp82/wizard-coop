import { DEVELOPER } from '../server/developer.js';
import { AURORA } from '../server/aurora.js';
import { GOD } from '../server/god.js';
import { assetUrl } from './platform.js';

export function characterPortrait(element, color) {
  element.style.backgroundImage = color === DEVELOPER ? `url("${assetUrl('assets/developer.png')}")`
    : color === GOD ? `url("${assetUrl('assets/the-god.png')}")`
      : color === AURORA ? `url("${assetUrl('assets/aurora.png')}")` : '';
  element.style.backgroundPosition = color === DEVELOPER || color === GOD || color === AURORA ? 'center' : `${color * 100 / 3}% 0`;
  element.classList.toggle('developer-portrait', color === DEVELOPER);
  element.classList.toggle('aurora-portrait', color === AURORA);
  element.classList.toggle('god-portrait', color === GOD);
}
