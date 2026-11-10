import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_MIN_OPINION,
  assistanceOpinion,
  assistanceValue,
  clampOpinion,
  countriesToCall,
  pairOf,
  relationStage,
} from './index';

describe('diplomacy', () => {
  it('stages follow opinion, war and alliance', () => {
    expect(relationStage(0, false, false)).toBe('neutral');
    expect(relationStage(ALLIANCE_MIN_OPINION, false, false)).toBe('friendly');
    expect(relationStage(-40, false, false)).toBe('unfriendly');
    expect(relationStage(-80, false, false)).toBe('hostile');
    expect(relationStage(90, false, true)).toBe('allied');
    expect(relationStage(90, true, true)).toBe('war');
  });

  it('opinion is clamped', () => {
    expect(clampOpinion(500)).toBe(100);
    expect(clampOpinion(-500)).toBe(-100);
  });

  it('gifts are worth opinion with a cap, and manpower is ignored', () => {
    expect(assistanceValue({ money: 1000, steel: 100 })).toBe(1200);
    expect(assistanceOpinion({ money: 1500 })).toBe(10);
    expect(assistanceOpinion({ money: 450 })).toBe(3);
    expect(assistanceOpinion({ money: 999999 })).toBe(10);
    expect(assistanceOpinion({ manpower: 5000 })).toBe(0);
  });

  it('pair keys do not depend on order', () => {
    expect(pairOf('b', 'a')).toEqual(pairOf('a', 'b'));
  });

  it('defence calls skip the aggressor, its allies and countries already fighting it', () => {
    const called = countriesToCall(['x', 'y', 'z', 'agg'], 'agg', ['y'], ['z']);
    expect(called).toEqual(['x']);
  });
});
