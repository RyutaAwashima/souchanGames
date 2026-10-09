const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGame(width = 390) {
  const calls = [];
  const audioCalls = [];
  const intervals = [];
  const ctx = new Proxy({}, {
    get(_, name) {
      return (...args) => {
        calls.push({ name, args });
        if (name === "createLinearGradient") return { addColorStop() {} };
        if (name === "arcTo") assert.ok(args.every(Number.isFinite));
      };
    }
  });
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        getContext: () => ctx,
        getBoundingClientRect: () => ({ width, height: 800, left: 0 }),
        addEventListener(name, callback) { this[`on${name}`] = callback; },
        setAttribute(name, value) { this[name] = value; },
        textContent: "",
        onclick: null
      });
      return elements.get(id);
    }
  };
  class AudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime() {} },
        connect() {},
        start() { audioCalls.push("tone"); },
        stop() {}
      };
      return oscillator;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
    resume() {}
  }
  const html = fs.readFileSync(path.join(__dirname, "../games/popo-sky-trip/index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const sandbox = {
    document,
    window: {
      devicePixelRatio: 1,
      AudioContext,
      addEventListener() {},
      requestAnimationFrame() {},
      setInterval(callback) { intervals.push(callback); return intervals.length; },
      clearInterval() {}
    }
  };
  vm.runInNewContext(script.replace(/\}\)\(\);\s*$/, `
    globalThis.game = {
      startStage, beginBoss, update, draw, drawPlayerHearts, drawRobot, drawUfo,
      damagePlayer, actInLane, toggleSound,
      state: () => ({
        boss, lives, playerX, playerY, bossShotTimer, waterShotTimer, mode, soundEnabled,
        enemyShotCount: enemyShots.length
      }),
      fireAt: (lane) => shots.push({ lane, y: boss.y + 1, speed: 0 }),
      setBossTimers: (shot, water) => { bossShotTimer = shot; waterShotTimer = water; },
      clearEnemyShots: () => { enemyShots = []; },
      setInvulnerable: () => { invulnerable = 1; elapsed = 0; }
    };
  })();`), sandbox);
  return { game: sandbox.game, calls, audioCalls, intervals, elements };
}

test("six hearts follow the player and remain visible during damage blinking", () => {
  const { game, calls } = loadGame();
  game.startStage(1, 6);
  game.actInLane(2);
  game.update(0.1);
  game.damagePlayer(false);
  game.setInvulnerable();
  calls.length = 0;
  game.draw();
  const hearts = calls.filter(c => c.name === "fillText" && c.args[0] === "♥");
  assert.equal(hearts.length, 6);
  assert.equal(game.state().lives, 5);
  const translation = calls.find(c => c.name === "translate");
  assert.equal(translation.args[0], game.state().playerX);
  assert.equal(translation.args[1], game.state().playerY + 51);
});

test("UFO visits every lane and only takes hits at its visible position", () => {
  const { game } = loadGame();
  game.startStage(1, 6);
  game.beginBoss();
  const visited = new Set();
  for (let i = 0; i < 400; i++) {
    game.update(0.04);
    visited.add(Math.round(game.state().boss.lane));
  }
  assert.deepEqual([...visited].sort(), [0, 1, 2]);
  game.state().boss.lane = 0;
  game.fireAt(1);
  game.update(0);
  assert.equal(game.state().boss.hp, 12);
  game.fireAt(0);
  game.update(0);
  assert.equal(game.state().boss.hp, 11);
  game.state().boss.lane = 0.4;
  game.fireAt(0);
  game.update(0);
  assert.equal(game.state().boss.hp, 10);
});

test("both bosses have 30% longer normal and water firing intervals", () => {
  for (const stage of [1, 2]) {
    const { game } = loadGame();
    game.startStage(stage, 6);
    game.beginBoss();
    assert.equal(game.state().bossShotTimer, 0.8 * 1.3);
    assert.equal(game.state().waterShotTimer, 4 * 1.3);
    game.update(0.01);
    assert.equal(game.state().bossShotTimer, 0.8 * 1.3 - 0.01);
    assert.equal(game.state().waterShotTimer, 4 * 1.3 - 0.01);
  }
});

test("robot arms render centered in opposite lanes with valid geometry", () => {
  for (const width of [320, 390, 900]) {
    const { game, calls } = loadGame(width);
    game.startStage(2, 6);
    game.beginBoss();
    game.drawRobot();
    const armRadius = Math.min(width * 0.065, 28);
    const armJointXs = calls
      .filter(c => c.name === "arc" && c.args[2] === armRadius)
      .map(c => c.args[0]);
    assert.ok(armJointXs.includes(width / 6));
    assert.ok(armJointXs.includes(width * 5 / 6));
    const eyeXs = calls
      .filter(c => c.name === "arc" && c.args[2] === 13)
      .map(c => c.args[0]);
    assert.ok(eyeXs.includes(width / 2 - 20));
    assert.ok(eyeXs.includes(width / 2 + 20));
    game.fireAt(0);
    game.update(0);
    assert.equal(game.state().boss.armHp[0], 1);
    assert.equal(game.state().boss.armHp[1], 2);
    game.fireAt(2);
    game.update(0);
    assert.equal(game.state().boss.armHp[1], 1);
  }
});

test("upbeat generated music and sound effects can be turned off and on", () => {
  const { game, audioCalls, intervals, elements } = loadGame();
  game.startStage(1, 6);
  assert.ok(audioCalls.length > 0);
  assert.equal(intervals.length, 1);
  const soundButton = elements.get("sound-toggle");
  soundButton.onclick();
  assert.equal(game.state().soundEnabled, false);
  assert.equal(soundButton.textContent, "🔇 おと");
  const toneCount = audioCalls.length;
  game.actInLane(1);
  assert.equal(audioCalls.length, toneCount);
  soundButton.onclick();
  assert.equal(game.state().soundEnabled, true);
  assert.equal(soundButton.textContent, "🔊 おと");
  assert.equal(intervals.length, 2);
});

test("UFO pauses between lanes to show a warning and a tired opening", () => {
  const { game, calls } = loadGame();
  game.startStage(1, 6);
  game.beginBoss();
  const boss = game.state().boss;
  game.setBossTimers(20, 20);
  boss.pauseTimer = 0.01;
  game.update(0.02);
  assert.equal(boss.pauseState, "warning");
  calls.length = 0;
  game.drawUfo();
  assert.ok(calls.some(c => c.name === "fillText" && c.args[0] === "💦"));

  const warningLane = boss.lane;
  game.update(0.71);
  assert.equal(boss.pauseState, "resting");
  game.setBossTimers(0.01, 0.01);
  game.clearEnemyShots();
  const restingLane = boss.lane;
  game.update(0.5);
  assert.equal(boss.lane, restingLane);
  assert.equal(game.state().enemyShotCount, 0);
  calls.length = 0;
  game.drawUfo();
  assert.ok(calls.some(c => c.name === "fillText" && c.args[0] === "😮‍💨"));
  assert.notEqual(warningLane, undefined);

  game.update(1.4);
  assert.equal(boss.pauseState, "moving");
});

test("robot stops firing during its weak-point opening and shows a sweat icon", () => {
  const { game, calls } = loadGame();
  game.startStage(2, 6);
  game.beginBoss();
  const boss = game.state().boss;
  boss.phase = "core";
  boss.phaseTimer = 5;
  game.setBossTimers(0.01, 0.01);
  game.update(0.2);
  assert.equal(game.state().bossShotTimer, 0.01);
  assert.equal(game.state().waterShotTimer, 0.01);
  assert.equal(game.state().enemyShotCount, 0);
  calls.length = 0;
  game.drawRobot();
  assert.ok(calls.some(c => c.name === "fillText" && c.args[0] === "💦"));
});
