// Cielo Arms, the gun shop on Cielo Street: what it sells and what a
// purchase does. Pure logic — the DOM overlay in main.js only calls
// buyItem and shows the result. Nothing here touches the document.
import { playerCar } from './player.js';

/** What the garage pays for a borrowed car, by model. New body shapes
 * pay their class price: a coupe is a sports car, a hatch is a sedan,
 * a truck is a pickup — no price ever changed, only the shape did. */
export const SELL_VALUES = { sports: 800, sedan: 300, taxi: 250, pickup: 350, van: 200, police: 0, coupe: 800, hatch: 300, truck: 350 };

/** Sell a borrowed car to the garage: once per game day, by model.
 * Returns null on success, or a short reason when it cannot happen. */
export function sellCar(state, events) {
  const player = state.player;
  const car = playerCar(state);
  if (!car || !state.progress.garage) return 'Drive a car to the garage to sell it.';
  if (!car.stolen) return 'Only borrowed cars can be sold here.';
  if (state.totalMinutes - state.progress.lastSellAt < 1440) return 'The garage only buys one car a day.';
  const value = SELL_VALUES[car.kind] || 250;
  state.cars = state.cars.filter((c) => c !== car);
  player.onFoot = true;
  player.carId = null;
  player.money += value;
  state.progress.lastSellAt = state.totalMinutes;
  events.push({ type: 'toast', text: `Sold the ${car.name} for $${value}.` });
  return null;
}

export const SHOP_ITEMS = [
  { id: 'smg', name: 'SMG', price: 600 },
  { id: 'smg-ammo', name: 'SMG ammo +60', price: 80 },
  { id: 'pistol-ammo', name: 'Pistol ammo +48', price: 40 },
  { id: 'armour', name: 'Armour (full)', price: 150 },
  // A snack: the way back above 50 HP, since natural regen stops
  // there. Carried up to five, eaten with G.
  { id: 'snack', name: 'Snack (+30 HP)', price: 15 },
];

/** 'owned' | 'buy' | 'poor' | 'locked' for the shop button state. */
export function shopItemState(state, id) {
  const player = state.player;
  if (id === 'smg') {
    if (player.weapons.includes('smg')) return 'owned';
    return player.money >= 600 ? 'buy' : 'poor';
  }
  if (id === 'smg-ammo') {
    if (!player.weapons.includes('smg')) return 'locked';
    return player.money >= 80 ? 'buy' : 'poor';
  }
  if (id === 'pistol-ammo') return player.money >= 40 ? 'buy' : 'poor';
  if (id === 'armour') {
    if (player.armour >= 100) return 'owned';
    return player.money >= 150 ? 'buy' : 'poor';
  }
  if (id === 'snack') {
    if ((player.snacks || 0) >= 5) return 'owned';
    return player.money >= 15 ? 'buy' : 'poor';
  }
  return 'locked';
}

/**
 * Buy an item. Returns null on success, or a short reason the overlay
 * shows when the purchase cannot happen. Mutates the player on success.
 */
export function buyItem(state, id, events) {
  const player = state.player;
  if (id === 'smg') {
    if (player.weapons.includes('smg')) return 'Already owned.';
    if (player.money < 600) return 'Not enough money.';
    player.money -= 600;
    player.weapons.push('smg');
    player.ammo.smg += 60;
    events.push({ type: 'toast', text: 'SMG bought — press 3 to equip it.' });
    return null;
  }
  if (id === 'smg-ammo') {
    if (!player.weapons.includes('smg')) return 'Buy the SMG first.';
    if (player.money < 80) return 'Not enough money.';
    player.money -= 80;
    player.ammo.smg += 60;
    events.push({ type: 'toast', text: 'SMG ammo +60.' });
    return null;
  }
  if (id === 'pistol-ammo') {
    if (player.money < 40) return 'Not enough money.';
    player.money -= 40;
    player.ammo.pistol += 48;
    events.push({ type: 'toast', text: 'Pistol ammo +48.' });
    return null;
  }
  if (id === 'armour') {
    if (player.armour >= 100) return 'Armour already full.';
    if (player.money < 150) return 'Not enough money.';
    player.money -= 150;
    player.armour = 100;
    events.push({ type: 'toast', text: 'Armour fitted — 100%.' });
    return null;
  }
  if (id === 'snack') {
    if ((player.snacks || 0) >= 5) return 'Snack pouch is full (5).';
    if (player.money < 15) return 'Not enough money.';
    player.money -= 15;
    player.snacks = (player.snacks || 0) + 1;
    events.push({ type: 'toast', text: 'Snack stashed — press G to eat it (+30 HP).' });
    return null;
  }
  return 'Unknown item.';
}

/** Eat a snack (G): +30 HP, the way back above the 50 HP regen cap. */
export function eatSnack(state, events) {
  const player = state.player;
  if ((player.snacks || 0) <= 0) return 'No snacks — buy some at Cielo Arms.';
  if (player.health >= 100) return 'Already at full health.';
  player.snacks -= 1;
  player.health = Math.min(100, player.health + 30);
  events.push({ type: 'toast', text: 'Snack eaten — +30 HP.' });
  return null;
}
