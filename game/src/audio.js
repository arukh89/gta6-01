// Every sound in Solmaris is synthesized with WebAudio: no audio files, no
// network, nothing borrowed. Engine hum, sirens, gunshots, chimes and a slow
// warm chord loop are all oscillators and filtered noise, built at boot and
// started only after the player's first gesture.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = 0;
  let musicStep = 0;
  let muted = false;
  let started = false;

  const CHORDS = [
    [220.0, 277.18, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
    [146.83, 220.0, 293.66],
  ];

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      const engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = context.createOscillator();
      sirenOsc.type = 'triangle';
      sirenGain = context.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!context || muted) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, context.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, context.currentTime + dur);
    gain.gain.setValueAtTime(vol, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(context.currentTime + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!context || muted) return;
    const length = Math.floor(context.sampleRate * dur);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = context.createGain();
    gain.gain.value = vol;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  return {
    /** Call from a user gesture (button click): unlocks audio in the browser. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() {
      return muted;
    },
    isStarted() {
      return started;
    },
    shot() {
      noise(0.14, 0.5, 2600);
    },
    punch() {
      noise(0.08, 0.35, 500);
    },
    crash() {
      noise(0.25, 0.45, 700);
    },
    chime() {
      tone(880, 0.18, 'sine', 0.25);
      tone(1320, 0.24, 'sine', 0.2);
    },
    missionDone() {
      tone(523.25, 0.16, 'triangle', 0.3);
      setTimeout(() => tone(659.25, 0.16, 'triangle', 0.3), 130);
      setTimeout(() => tone(783.99, 0.3, 'triangle', 0.3), 260);
    },
    busted() {
      tone(392, 0.5, 'sawtooth', 0.2, 196);
    },
    /** Continuous layers, called every frame with the live situation. */
    update(dt, speed, policeNear, time) {
      if (!context || muted) return;
      if (engineOsc) {
        engineOsc.frequency.value = 55 + Math.abs(speed) * 0.16;
        engineGain.gain.value = Math.min(0.12, Math.abs(speed) * 0.00035);
      }
      if (sirenOsc) {
        sirenGain.gain.value = policeNear ? 0.05 : 0;
        sirenOsc.frequency.value = 660 + Math.sin(time * 5) * 160;
      }
      musicTimer += dt;
      if (musicTimer > 2.4) {
        musicTimer = 0;
        const chord = CHORDS[musicStep % CHORDS.length];
        musicStep += 1;
        for (const freq of chord) tone(freq, 2.2, 'triangle', 0.045);
      }
    },
  };
}
