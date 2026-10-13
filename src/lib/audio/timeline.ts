import type { PodcastTiming } from '#lib/types.ts';
import { AUDIO_SAMPLE_RATE } from './pcm';

// Native media clocks can round a fractional requested START down by a
// microsecond. Seek one output sample inside the contribution; retain exact
// start/end lookup rules for ordinary playback and all inter-turn pauses.
export function podcastSeekTarget(timing: PodcastTiming): number | undefined {
  if (!Number.isFinite(timing.start) || !Number.isFinite(timing.end)
    || timing.start < 0 || timing.end <= timing.start) return undefined;
  return timing.start + Math.min(1 / AUDIO_SAMPLE_RATE, (timing.end - timing.start) / 2);
}
