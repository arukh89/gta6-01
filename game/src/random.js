// Deterministic randomness for the city layout and screenshot scenes: the same
// seed always builds the same Solmaris, so a staged screenshot can be retaken
// exactly. Gameplay chaos (traffic turns, pedestrian chatter) draws from a
// second stream seeded at boot, so it never reshapes the city itself.

export function createSeededRandom(seedValue) {
  let state = (seedValue >>> 0) || 0x9e3779b9;
  function next() {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  }
  return {
    next,
    /** Integer in [min, max). */
    int(min, max) {
      return min + Math.floor(next() * (max - min));
    },
    /** Value in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}
