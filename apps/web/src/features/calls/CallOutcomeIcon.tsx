import { PhoneIncoming, PhoneX, PhoneDisconnect, PhoneSlash } from '@phosphor-icons/react';
import type { Call } from './api.ts';

const icons = {incoming:PhoneIncoming,missed:PhoneX,rejected:PhoneDisconnect,blocked:PhoneSlash};

/** Shape and text distinguish outcomes even when color is not perceived. */
export function CallOutcomeIcon({outcome}:{outcome:Call['outcome']}) {
  const Icon=icons[outcome];
  return <span className={`call-outcome-icon is-${outcome}`} aria-hidden="true"><Icon size={24} weight="bold"/></span>;
}
