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
  let station = 0;
  let muted = false;
  let started = false;

  // Four original stations, each with its own key, tempo, wave and melodic
  // pattern — all synthesized live, no audio files. Melody entries are
  // indexes into the station's scale (null = rest); bass entries are
  // semitone offsets from the station root.
  const STATIONS = [
    {
      name: 'SOL BAY FM', freq: '92.4', genre: 'Coastal Pop', wave: 'triangle', bpm: 96, root: 220.0,
      scale: [0, 2, 4, 7, 9, 12, 14, 16], chord: [4, 7],
      melody: [0, null, 2, 4, null, 7, 4, 2, 0, null, 2, 4, 7, 9, 7, 4],
      bass: [0, null, null, null, 7, null, null, null, 5, null, null, null, 7, null, 4, null],
    },
    {
      name: 'NEON NIGHTS', freq: '101.7', genre: 'Synthwave', wave: 'sawtooth', bpm: 112, root: 110.0,
      scale: [0, 2, 3, 5, 7, 8, 10, 12], chord: [3, 7],
      melody: [0, null, null, 3, null, 5, 7, null, 5, null, 3, 2, null, 0, null, null],
      bass: [0, 0, null, 0, 3, null, 3, null, 5, null, 5, null, 7, null, 5, 3],
    },
    {
      name: 'PALMA JAZZ', freq: '96.3', genre: 'Marina Jazz', wave: 'sine', bpm: 84, root: 130.81,
      scale: [0, 3, 5, 7, 10, 12, 15, 17], chord: [3, 10],
      melody: [0, null, 2, null, 4, 2, null, 1, 0, null, 3, 2, null, 4, null, 2],
      bass: [0, null, null, null, 10, null, null, null, 7, null, null, null, 5, null, 7, null],
    },
    {
      name: 'HARBOR BEAT', freq: '104.5', genre: 'Dance', wave: 'sawtooth', bpm: 122, root: 87.31, kick: true,
      scale: [0, 2, 3, 5, 7, 10, 12], chord: [3, 7],
      melody: [0, null, 2, null, 4, null, 2, 0, 5, null, 4, 2, null, 0, null, null],
      bass: [0, null, 0, null, 0, null, 0, null, 3, null, 0, null, 5, null, 3, null],
    },
  ];

  function semi(root, n) {
    return root * Math.pow(2, n / 12);
  }

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
    /** Radio station the sequencer is playing (0..3). */
    stationIndex() {
      return station;
    },
    stationLabel() {
      const st = STATIONS[station];
      return `♪ ${st.name} ${st.freq}`;
    },
    stationCount() {
      return STATIONS.length;
    },
    setStation(i) {
      station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
      musicStep = 0;
      musicTimer = 0;
    },
    nextStation() {
      this.setStation(station + 1);
      tone(660, 0.09, 'sine', 0.12);
      setTimeout(() => tone(880, 0.12, 'sine', 0.12), 90);
      return this.stationLabel();
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
    /** A stolen car's alarm: two-tone, hard to miss. */
    alarm() {
      tone(1240, 0.12, 'square', 0.12);
      setTimeout(() => tone(930, 0.12, 'square', 0.12), 130);
      setTimeout(() => tone(1240, 0.12, 'square', 0.12), 260);
      setTimeout(() => tone(930, 0.18, 'square', 0.12), 390);
    },
    /** A car or helicopter exploding: a low, long noise burst. */
    explosion() {
      noise(0.7, 0.6, 300);
      tone(70, 0.6, 'sine', 0.35, 35);
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
      // Radio: an eighth-note step sequencer per station — lead melody,
      // bass line, four-on-the-floor kick on the dance station, and a soft
      // pad chord every 32 steps.
      const st = STATIONS[station];
      const stepDur = 60 / st.bpm / 2;
      musicTimer += dt;
      while (musicTimer >= stepDur) {
        musicTimer -= stepDur;
        const s = musicStep;
        musicStep += 1;
        const mel = st.melody[s % st.melody.length];
        if (mel !== null && mel !== undefined) {
          tone(semi(st.root * 2, st.scale[mel % st.scale.length]), stepDur * 1.8, st.wave, 0.05);
        }
        const bass = st.bass[s % st.bass.length];
        if (bass !== null && bass !== undefined) tone(semi(st.root, bass), stepDur * 1.9, st.wave, 0.07);
        if (st.kick && s % 4 === 0) tone(55, 0.14, 'sine', 0.14);
        if (s % 32 === 0) {
          for (const n of [0, st.chord[0], st.chord[1]]) tone(semi(st.root, n), 2.4, 'triangle', 0.03);
        }
      }
    },
  };
}
