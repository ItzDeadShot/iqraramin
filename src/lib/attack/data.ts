import enterprise from '../../content/data/attack/enterprise.json';
import type { AttackData } from './matrix';

// JSON can't express the tuple types, hence the unknown step.
export const ATTACK = enterprise as unknown as AttackData;
