/**
 * Browser ring tone for inbound Verto invites (no audio files; uses Web Audio API).
 * Requires a prior user gesture on the page (e.g. Register) so AudioContext can resume.
 */
export class IncomingRingTone {
  private ctx: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.interval) {
      return;
    }
    this.ctx = new AudioContext();
    await this.ctx.resume();

    const beep = (): void => {
      const c = this.ctx;
      if (!c) {
        return;
      }
      const t0 = c.currentTime;
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(c.destination);
      g.gain.linearRampToValueAtTime(0.1, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + 0.55);

      for (const hz of [440, 480]) {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = hz;
        o.connect(g);
        o.start(t0);
        o.stop(t0 + 0.56);
      }
    };

    beep();
    this.interval = setInterval(beep, 2200);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}
