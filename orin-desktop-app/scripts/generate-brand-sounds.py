#!/usr/bin/env python3
"""
Render Orin's UI cues to real 16-bit PCM WAV files.

These are the same five cues `ui/src/design/sound.ts` synthesises at runtime --
same frequencies, same envelope shape, same relative levels -- but baked to
files, so the brand has an audible identity that does not depend on whichever
surface plays it. A website, a video, or a support clip can use the same cue
the desktop app does.

The app still synthesises by default: a runtime oscillator costs no download, no
decode, and carries no licence. The files are the fallback-free, portable
version of the same design, and `ui/src/design/soundAssets.ts` loads them only
when asked.

Deterministic by construction: no randomness, no timestamps in the data, so
regenerating produces byte-identical output and `git diff` stays meaningful.

Usage:  python scripts/generate-brand-sounds.py [--out DIR]
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
MASTER_GAIN = 0.9
# Matches the 0.012 s attack in sound.ts. A hard gate on an oscillator clicks;
# both the runtime and the file need a ramp.
ATTACK_S = 0.012
# A little longer than the shortest note so a cue never ends on a cliff.
RELEASE_S = 0.020
# Below this the WAV quantises to silence anyway; keep the same near-floor the
# runtime uses so the two renderings do not differ audibly.
FLOOR = 0.0001


class Tone:
    def __init__(self, freq: float, duration: float, gain: float, delay: float = 0.0, kind: str = "sine"):
        self.freq = freq
        self.duration = duration
        self.gain = gain
        self.delay = delay
        self.kind = kind


# Mirrors the TONES table in ui/src/design/sound.ts. Keep the two in step: this
# is the portable copy, that is the runtime copy, and they should be the same
# design rather than two designs that drifted.
TONES: dict[str, list[Tone]] = {
    # A soft rising fifth: "your message went out".
    "send": [
        Tone(392.00, 0.09, 0.05, 0.00, "sine"),
        Tone(587.33, 0.11, 0.04, 0.06, "sine"),
    ],
    # One low note the thinking animation can retrigger; never a loop.
    "thinking": [
        Tone(196.00, 0.50, 0.022, 0.00, "sine"),
    ],
    # Arrival: the send gesture, resolved.
    "reply": [
        Tone(523.25, 0.10, 0.045, 0.00, "sine"),
        Tone(783.99, 0.16, 0.035, 0.07, "sine"),
    ],
    "success": [
        Tone(659.25, 0.13, 0.05, 0.00, "triangle"),
    ],
    # Falling minor second. Short, so it never becomes grating.
    "error": [
        Tone(311.13, 0.10, 0.05, 0.00, "triangle"),
        Tone(261.63, 0.17, 0.045, 0.09, "triangle"),
    ],
}


def waveform(kind: str, phase: float) -> float:
    """Unit-amplitude sample for a cycle position in [0, 1)."""
    if kind == "sine":
        return math.sin(2.0 * math.pi * phase)
    if kind == "triangle":
        # Odd harmonics only, like a soft synth triangle.
        return 2.0 * abs(2.0 * (phase - math.floor(phase + 0.5))) - 1.0
    raise ValueError(f"unknown waveform: {kind}")


def envelope(t: float, duration: float) -> float:
    """Attack ramp in, release ramp out, silence in between. Never negative."""
    if t < 0.0 or t > duration:
        return 0.0
    if t < ATTACK_S:
        # Exponential attack, matching exponentialRampToValueAtTime in the app.
        return FLOOR * ((1.0 / FLOOR) ** (t / ATTACK_S))
    remaining = duration - t
    if remaining < RELEASE_S:
        # Raised-cosine release: smoother at the tail than a straight ramp, and
        # it cannot ring past the end of the note.
        return 0.5 * (1.0 + math.cos(math.pi * (1.0 - remaining / RELEASE_S)))
    return 1.0


def render(tones: list[Tone]) -> list[float]:
    total = max((tone.delay + tone.duration for tone in tones), default=0.0) + RELEASE_S
    count = int(round(total * SAMPLE_RATE))
    buf = [0.0] * count
    for tone in tones:
        start = int(round(tone.delay * SAMPLE_RATE))
        length = int(round(tone.duration * SAMPLE_RATE))
        peak = tone.gain * MASTER_GAIN
        for i in range(length):
            index = start + i
            if index >= count:
                break
            t = i / SAMPLE_RATE
            sample = waveform(tone.kind, tone.freq * t)
            buf[index] += sample * peak * envelope(t, tone.duration)
    # Guard against clipping if two notes ever overlap harder than intended.
    ceiling = max((abs(v) for v in buf), default=0.0)
    if ceiling > 0.999:
        buf = [v * (0.999 / ceiling) for v in buf]
    return buf


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for value in samples:
            clamped = max(-1.0, min(1.0, value))
            frames += struct.pack("<h", int(round(clamped * 32767.0)))
        handle.writeframes(bytes(frames))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "brand" / "sounds"),
        help="output directory for the WAV files",
    )
    args = parser.parse_args()
    out = Path(args.out)

    for name, tones in TONES.items():
        samples = render(tones)
        path = out / f"orin-{name}.wav"
        write_wav(path, samples)
        peak = max((abs(v) for v in samples), default=0.0)
        print(
            f"{path.name:<22} {len(samples) / SAMPLE_RATE:>5.2f}s  "
            f"{len(tones)} note{'s' if len(tones) != 1 else ''}  peak {peak:.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
