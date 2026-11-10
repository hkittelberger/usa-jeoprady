import confetti from "canvas-confetti";

const COLORS = ["#B31942", "#FFFFFF", "#0A3161", "#F2C14E"];

export function confettiBurst() {
  confetti({ particleCount: 140, spread: 100, startVelocity: 45, origin: { y: 0.65 }, colors: COLORS, disableForReducedMotion: true });
}

export function fireworks(durationMs = 2200) {
  const end = Date.now() + durationMs;
  const tick = () => {
    confetti({
      particleCount: 60, spread: 360, startVelocity: 30, ticks: 70, gravity: 0.6, scalar: 0.9,
      origin: { x: 0.1 + Math.random() * 0.8, y: 0.15 + Math.random() * 0.35 }, colors: COLORS, disableForReducedMotion: true,
    });
    if (Date.now() < end) setTimeout(tick, 280);
  };
  tick();
}

export function podiumCelebration() {
  fireworks(3500);
  const end = Date.now() + 3500;
  const side = () => {
    confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors: COLORS, disableForReducedMotion: true });
    confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors: COLORS, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(side);
  };
  side();
}
