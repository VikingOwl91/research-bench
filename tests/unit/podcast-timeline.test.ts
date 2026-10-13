import { describe, expect, it } from 'vitest';
import { podcastSeekTarget } from '../../src/lib/audio/timeline.ts';
import { AUDIO_SAMPLE_RATE } from '../../src/lib/audio/pcm.ts';
import type { PodcastTiming } from '../../src/lib/types.ts';

const timeline: PodcastTiming[] = [
  { turnId: 'T3', start: 6.406041666666667, end: 9.406041666666667 },
  { turnId: 'T4', start: 9.586041666666667, end: 12.586041666666667 }
];
const at = (time: number) => timeline.find(entry => time >= entry.start && time < entry.end);

describe('native contribution seek target', () => {
  it('avoids the proven fractional-start microsecond round-down', () => {
    expect(at(6.406041)).toBeUndefined();
    const target = podcastSeekTarget(timeline[0])!;
    expect(target).toBeCloseTo(timeline[0].start + 1 / AUDIO_SAMPLE_RATE, 12);
    const nativeRounded = Math.floor(target * 1_000_000) / 1_000_000;
    expect(nativeRounded).toBeGreaterThan(timeline[0].start);
    expect(at(nativeRounded)).toBe(timeline[0]);
  });
  it('clamps the offset to half the duration of a tiny contribution', () => {
    const timing = { turnId: 'tiny', start: 1, end: 1.000002 };
    const target = podcastSeekTarget(timing)!;
    expect(target).toBeCloseTo(1.000001, 12);
    expect(target).toBeGreaterThan(timing.start);
    expect(target).toBeLessThan(timing.end);
  });
  it('rejects negative, non-finite, empty and reversed intervals', () => {
    for (const [start, end] of [[NaN, 2], [0, Infinity], [-1, 2], [2, 1], [1, 1], [Infinity, Infinity], [0, NaN]]) expect(podcastSeekTarget({ turnId: 'invalid', start, end })).toBeUndefined();
  });
  it('preserves persisted boundaries, strict ends and the full ordinary-playback pause', () => {
    const before = structuredClone(timeline);
    podcastSeekTarget(timeline[0]);
    expect(timeline).toEqual(before);
    expect(at(timeline[0].start - 0.000001)).toBeUndefined();
    expect(at(timeline[0].end)).toBeUndefined();
    expect(at(timeline[0].end + 0.09)).toBeUndefined();
    expect(at(timeline[1].end)).toBeUndefined();
  });
  it('keeps a zero-start contribution seek strictly inside its real span', () => {
    const timing = { turnId: 'first', start: 0, end: 3 };
    expect(podcastSeekTarget(timing)).toBe(1 / AUDIO_SAMPLE_RATE);
  });
});
