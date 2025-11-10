// Platanus Survivor - Avoid the platanos!
// VampireSurvivors-like porque es god
//
// CODE STRUCTURE:
// - Configuration & Constants
// - Phaser Game Setup
// - Shader Definitions (CRT effect)
// - Game State Variables
// - Scene Lifecycle (preload, create, update)
// - Player Systems
// - Enemy Spawning & Difficulty
// - Weapon Systems
// - Enemy Systems
// - Particle & Visual Effects
// - Progression Systems (XP, Levels, Upgrades)
// - Collision Detection
// - Rendering
// - Game State Management
// - Audio Systems

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const GAME_CONFIG = {
  width: 800,
  height: 600,
  playerSize: 16,
  playerSpeed: 120,
  initialHp: 100,
  xpPerLevel: 10,
  magnetRange: 100,
  magnetSpeed: 200,
  initialSpawnRate: 500,
  minSpawnRate: 100,
  feverThreshold: 5,
  feverDuration: 3000,
  feverMagnetBonus: 100
};

const WEAPON_CONFIG = {
  laser: { damage: 15, rate: 400, speed: 600, minRate: 150 },
  blueLaser: { damage: 20, rate: 350, speed: 600, minRate: 150 },
  missile: { damage: 30, rate: 1500, range: 150, explosionRadius: 35, speed: 250, minRate: 800 },
  tripleShot: { damage: 12, rate: 500, speed: 600, minRate: 200 },
  pulseWave: { damage: 25, rate: 1200, range: 50, minRate: 600 },
  rapidFire: { damage: 8, rate: 150, speed: 700, minRate: 80 }
};

const ENEMY_CONFIG = {
  normal: { size: 16, hitbox: 6, baseSpeed: 50, speedVariance: 30, baseHp: 10, scoreValue: 10, gemDrop: 1 },
  boss: { size: 40, hitbox: 18, speed: 25, hp: 500, scoreValue: 100, gemDrop: 10, scale: 2.5 },
  red: { size: 18, hitbox: 7, baseSpeed: 70, speedVariance: 40, baseHp: 15, scoreValue: 20, gemDrop: 2 },
  blue: { size: 24, hitbox: 10, baseSpeed: 40, speedVariance: 20, baseHp: 40, scoreValue: 50, gemDrop: 5 }
};

const COLORS = {
  background: '#1a1a2e',
  cyan: 0x00ffff,
  yellow: 0xF9BC13,
  orange: 0xFF5500,
  red: 0xff0000,
  blue: 0x00aaff,
  catOrange: 0xff9933,
  catPink: 0xff66aa,
  white: 0xffffff,
  black: 0x000000,
  green: 0x00ff00,
  darkGreen: 0x00aa00
};

// ============================================================================
// PHASER GAME SETUP
// ============================================================================

const config = {
  type: Phaser.AUTO,
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  backgroundColor: COLORS.background,
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

// ============================================================================
// SHADER DEFINITIONS
// ============================================================================

const CRT_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float time;
uniform vec2 resolution;
varying vec2 outTexCoord;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = outTexCoord;
  // Zoom: scale uv around center
  float zoom = 1.0;
  uv = (uv - 0.5) / zoom + 0.5;

  vec2 centered = uv * 2.0 - 1.0;
  float dist = dot(centered, centered);

  // Barrel distortion

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 color = texture2D(uMainSampler, uv).rgb;

  // Scanlines
  float scan = sin((uv.y + time * 0.5) * resolution.y * 1.5) * 0.08;
  color -= scan;

  // Shadow mask
  float mask = sin(uv.x * resolution.x * 0.75) * 0.05;
  color += mask;

  // Flicker noise
  float noise = rand(vec2(time * 10.0, uv.y)) * 0.03;
  color += noise;

  // Vignette
  float vignette = 1.0 - dist * 0.35;
  color *= vignette;

  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color, 1.0);
}`;

class CRTPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({
      game,
      name: "crtPipeline",
      fragShader: CRT_FRAGMENT_SHADER,
    });
    this._time = 0;
  }

  onPreRender() {
    this._time += this.game.loop.delta / 1000;
    this.set1f("time", this._time);
    const scale = this.game.scale;
    const width = Number(
      scale && typeof scale.width === "number"
        ? scale.width
        : this.game.config.width
    );
    const height = Number(
      scale && typeof scale.height === "number"
        ? scale.height
        : this.game.config.height
    );
    this.set2f("resolution", width, height);
  }
}

// ============================================================================
// GAME STATE
// ============================================================================

let player;
let bananas = [];
let gems = [];
let projectiles = [];
let particles = [];
let explosions = [];
let backgroundParticles = [];
let graphics;
let keys;

// Score and progression
let score = 0;
let xp = 0;
let level = 1;
let hp = GAME_CONFIG.initialHp;
let gameDuration = 0;

// Game flags
let gameOver = false;
let gameStarted = false;
let miniBossSpawned = false;

// Magnet and Fever mode
let magnetActive = false;
let magnetRange = GAME_CONFIG.magnetRange;
let feverMode = false;
let feverTimer = 0;
let recentGemCollects = [];

// Background music
let bgMusicOscillators = [];
let bgMusicGains = [];
let bgMusicPlaying = false;

// Leaderboard
let leaderboard = [];
const MAX_LEADERBOARD_ENTRIES = 10;

// Enemy spawning
let spawnTimer = 0;
let spawnRate = GAME_CONFIG.initialSpawnRate;

// UI elements
let scoreText;
let timeText;
let levelText;
let hpBar;
let xpBar;

// Weapon systems
let weapons = {
  laser: { active: false, level: 0, damage: WEAPON_CONFIG.laser.damage, cooldown: 0, rate: WEAPON_CONFIG.laser.rate },
  missile: { active: false, level: 0, damage: WEAPON_CONFIG.missile.damage, cooldown: 0, rate: WEAPON_CONFIG.missile.rate, range: WEAPON_CONFIG.missile.range, explosionRadius: WEAPON_CONFIG.missile.explosionRadius },
  blueLaser: { active: false, level: 0, damage: WEAPON_CONFIG.blueLaser.damage, cooldown: 0, rate: WEAPON_CONFIG.blueLaser.rate },
  tripleShot: { active: false, level: 0, damage: WEAPON_CONFIG.tripleShot.damage, cooldown: 0, rate: WEAPON_CONFIG.tripleShot.rate },
  pulseWave: { active: false, level: 0, damage: WEAPON_CONFIG.pulseWave.damage, cooldown: 0, rate: WEAPON_CONFIG.pulseWave.rate, range: WEAPON_CONFIG.pulseWave.range },
  rapidFire: { active: false, level: 0, damage: WEAPON_CONFIG.rapidFire.damage, cooldown: 0, rate: WEAPON_CONFIG.rapidFire.rate }
};

// ============================================================================
// SCENE LIFECYCLE FUNCTIONS
// ============================================================================

function preload() {
  // No assets to load - using procedural graphics
}

function create() {
  const scene = this;
  graphics = this.add.graphics();

  // Load leaderboard from localStorage
  loadLeaderboard();

  // Register and apply CRT shader
  const renderer = this.renderer;
  if (renderer && renderer.pipelines) {
    renderer.pipelines.addPostPipeline('crtPipeline', CRTPipeline);
    this.cameras.main.setPostPipeline('crtPipeline');
  }

  // Create player
  player = {
    x: GAME_CONFIG.width / 2,
    y: GAME_CONFIG.height / 2,
    size: GAME_CONFIG.playerSize,
    speed: GAME_CONFIG.playerSpeed,
    vx: 0,
    vy: 0,
    facingAngle: 0
  };

  // Keyboard input
  keys = this.input.keyboard.addKeys({
    up: Phaser.Input.Keyboard.KeyCodes.UP,
    down: Phaser.Input.Keyboard.KeyCodes.DOWN,
    left: Phaser.Input.Keyboard.KeyCodes.LEFT,
    right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    w: Phaser.Input.Keyboard.KeyCodes.W,
    s: Phaser.Input.Keyboard.KeyCodes.S,
    a: Phaser.Input.Keyboard.KeyCodes.A,
    d: Phaser.Input.Keyboard.KeyCodes.D
  });

  // UI setup
  scoreText = this.add.text(780, 20, '0', {
    fontSize: '48px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  // Score label
  this.add.text(780, 5, 'SCORE', {
    fontSize: '12px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  timeText = this.add.text(780, 90, '0:00', {
    fontSize: '28px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);
  
  // Time label
  this.add.text(780, 75, 'TIME', {
    fontSize: '12px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  levelText = this.add.text(780, 150, 'LVL 1', {
    fontSize: '24px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);
  
  // Level label
  this.add.text(780, 135, 'LEVEL', {
    fontSize: '12px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  // HP bar
  const hpBg = this.add.graphics();
  hpBg.fillStyle(0x330000, 0.8);
  hpBg.fillRect(20, 560, 204, 20);
  hpBg.setDepth(100);
  
  hpBar = this.add.graphics();
  hpBar.setDepth(101);

  // XP bar
  const xpBg = this.add.graphics();
  xpBg.fillStyle(0x003300, 0.8);
  xpBg.fillRect(20, 583, 204, 10);
  xpBg.setDepth(100);
  
  xpBar = this.add.graphics();
  xpBar.setDepth(101);

  // Start with laser weapon
  weapons.laser.active = true;
  weapons.laser.level = 1;

  // Initialize background particles
  for (let i = 0; i < 100; i++) {
    backgroundParticles.push({
      x: Math.random() * GAME_CONFIG.width,
      y: Math.random() * GAME_CONFIG.height,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.3 + 0.1,
      color: Math.random() > 0.5 ? COLORS.cyan : COLORS.yellow
    });
  }

  // Instructions
  this.add.text(400, 580, 'WASD/Arrows to Move', {
    fontSize: '14px',
    fontFamily: 'Consolas, monospace',
    color: '#888888'
  }).setOrigin(0.5).setDepth(100);

  // Start screen overlay
  const startOverlay = this.add.graphics();
  startOverlay.fillStyle(0x000000, 0.9);
  startOverlay.fillRect(0, 0, 800, 600);
  startOverlay.setDepth(1000);
  
  // ASCII title
  const titleText = this.add.text(400, 150, 
    '██████╗ ██╗      █████╗ ████████╗ █████╗ ███╗   ██╗██╗   ██╗███████╗\n' +
    '██╔══██╗██║     ██╔══██╗╚══██╔══╝██╔══██╗████╗  ██║██║   ██║██╔════╝\n' +
    '██████╔╝██║     ███████║   ██║   ███████║██╔██╗ ██║██║   ██║███████╗\n' +
    '██╔═══╝ ██║     ██╔══██║   ██║   ██╔══██║██║╚██╗██║██║   ██║╚════██║\n' +
    '██║     ███████╗██║  ██║   ██║   ██║  ██║██║ ╚████║╚██████╔╝███████║\n' +
    '╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝\n' +
    '███████╗██╗   ██╗██████╗ ██╗   ██╗██╗██╗   ██╗██╗   ██╗███████╗\n' +
    '██╔════╝██║   ██║██╔══██╗██║   ██║██║██║   ██║██║   ██║██╔════╝\n' +
    '███████╗██║   ██║██████╔╝██║   ██║██║██║   ██║██║   ██║███████╗\n' +
    '╚════██║██║   ██║██╔══██╗╚██╗ ██╔╝██║╚██╗ ██╔╝██║   ██║╚════██║\n' +
    '███████║╚██████╔╝██║  ██║ ╚████╔╝ ██║ ╚████╔╝ ╚██████╔╝███████║\n' +
    '╚══════╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═══╝   ╚═════╝ ╚══════╝', {
    fontSize: '9px',
    fontFamily: 'Consolas, monospace',
    color: '#F9BC13',
    align: 'center',
    lineSpacing: -2
  }).setOrigin(0.5).setDepth(1001);
  
  // Banana ASCII art
  const bananaArt = this.add.text(400, 330, 
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠛⠋⠀⠀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⡇⠀⠀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣶⡀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⣿⡛⢻⣷⡀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⠃⢸⣿⡇⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⡟⢀⣿⣿⠃⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⡿⠁⣼⣿⡏⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⠟⢀⣾⣿⡟⠀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣿⠟⢁⣴⣿⣿⠋⠀⠀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣿⣿⠿⠋⣁⣴⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀\n' +
    '⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣿⣿⡿⠟⠋⣁⣴⣾⣿⡿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀\n' +
    '⠀⠀⢠⣾⣿⣿⣿⣿⠿⠟⠋⣁⣤⣶⣿⣿⡿⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀\n' +
    '⠀⠀⠈⠉⢉⣁⣤⣴⣶⣾⣿⣿⠿⠟⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀', {
    fontSize: '8px',
    fontFamily: 'Consolas, monospace',
    color: '#F9BC13',
    align: 'center',
    lineSpacing: 0
  }).setOrigin(0.5).setDepth(1001);
  
  const pressStart = this.add.text(400, 420, 'PRESS START', {
    fontSize: '32px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5).setDepth(1001);
  
  // Blinking animation (faster and more energetic)
  scene.tweens.add({
    targets: pressStart,
    alpha: { from: 1, to: 0.2 },
    duration: 400,
    yoyo: true,
    repeat: -1
  });
  
  const controls = this.add.text(400, 480, 
    'WASD or ARROW KEYS to move\n' +
    'Avoid the bananas!', {
    fontSize: '16px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    align: 'center'
  }).setOrigin(0.5).setDepth(1001);
  
  // Wait for any key press to start
  this.input.keyboard.once('keydown', () => {
    gameStarted = true;
    startOverlay.destroy();
    titleText.destroy();
    bananaArt.destroy();
    pressStart.destroy();
    controls.destroy();
    startBackgroundMusic(this);
    playMeow(this);
  });

  playTone(this, 440, 0.1);
}

// ============================================================================
// GAME LOOP
// ============================================================================

function update(time, delta) {
  if (gameOver || !gameStarted) return;

  gameDuration += delta;
  updateTimer();

  // Update fever mode
  updateFeverMode(delta);

  // Update systems
  updatePlayerMovement(delta);
  updateBackgroundParticles(delta);
  updateWeapons(this, delta);
  updateSpawning(delta);
  updateBananas(delta);
  updateProjectiles(this, delta);
  updateParticles(delta);
  updateExplosions(delta);
  updateGems(this);
  checkCollisions(this);

  // Add player movement particles
  if ((player.vx !== 0 || player.vy !== 0) && Math.random() > 0.5) {
    particles.push({
      x: player.x + (Math.random() - 0.5) * player.size,
      y: player.y + (Math.random() - 0.5) * player.size,
      vx: -player.vx * 50 + (Math.random() - 0.5) * 20,
      vy: -player.vy * 50 + (Math.random() - 0.5) * 20,
      life: 200,
      maxLife: 200,
      size: 1.5,
      color: COLORS.cyan
    });
  }

  draw();
}

// ============================================================================
// PLAYER SYSTEMS
// ============================================================================

function updatePlayerMovement(delta) {
  player.vx = 0;
  player.vy = 0;

  if (keys.left.isDown || keys.a.isDown) player.vx = -1;
  if (keys.right.isDown || keys.d.isDown) player.vx = 1;
  if (keys.up.isDown || keys.w.isDown) player.vy = -1;
  if (keys.down.isDown || keys.s.isDown) player.vy = 1;

  // Normalize diagonal movement
  if (player.vx !== 0 && player.vy !== 0) {
    player.vx *= 0.707;
    player.vy *= 0.707;
  }

  player.x += player.vx * player.speed * delta / 1000;
  player.y += player.vy * player.speed * delta / 1000;

  // Update facing direction
  if (player.vx !== 0 || player.vy !== 0) {
    player.facingAngle = Math.atan2(player.vy, player.vx);
  }

  // Keep player in bounds
  player.x = Math.max(player.size, Math.min(GAME_CONFIG.width - player.size, player.x));
  player.y = Math.max(player.size, Math.min(GAME_CONFIG.height - player.size, player.y));
}

// ============================================================================
// ENEMY SPAWNING & DIFFICULTY
// ============================================================================

function updateSpawning(delta) {
  spawnTimer += delta;
  
  // Spawn rate based on level (not time)
  const levelBasedSpawnRate = Math.max(GAME_CONFIG.minSpawnRate, GAME_CONFIG.initialSpawnRate - (level * 15));
  
  if (spawnTimer >= levelBasedSpawnRate) {
    spawnTimer = 0;
    spawnBanana();
  }
  
  // Spawn mini-bosses at level 20+
  if (level >= 20) {
    const levelPast20 = level - 20;
    const maxBosses = 1 + Math.floor(levelPast20 / 3);
    const currentBossCount = bananas.filter(b => b.isBoss).length;
    
    if (currentBossCount < maxBosses && !miniBossSpawned) {
      miniBossSpawned = true;
      spawnMiniBoss();
      setTimeout(() => { miniBossSpawned = false; }, 2000);
    }
  }
}

// ============================================================================
// WEAPON SYSTEMS
// ============================================================================

function updateWeapons(scene, delta) {
  if (weapons.laser.active) {
    weapons.laser.cooldown -= delta;
    if (weapons.laser.cooldown <= 0) {
      weapons.laser.cooldown = weapons.laser.rate;
      fireLaser();
    }
  }
  
  if (weapons.missile.active) {
    weapons.missile.cooldown -= delta;
    if (weapons.missile.cooldown <= 0) {
      weapons.missile.cooldown = weapons.missile.rate;
      fireMissile();
    }
  }
  
  if (weapons.blueLaser.active) {
    weapons.blueLaser.cooldown -= delta;
    if (weapons.blueLaser.cooldown <= 0) {
      weapons.blueLaser.cooldown = weapons.blueLaser.rate;
      fireBlueLaser();
    }
  }
  
  if (weapons.tripleShot.active) {
    weapons.tripleShot.cooldown -= delta;
    if (weapons.tripleShot.cooldown <= 0) {
      weapons.tripleShot.cooldown = weapons.tripleShot.rate;
      fireTripleShot();
    }
  }
  
  if (weapons.pulseWave.active) {
    weapons.pulseWave.cooldown -= delta;
    if (weapons.pulseWave.cooldown <= 0) {
      weapons.pulseWave.cooldown = weapons.pulseWave.rate;
      firePulseWave(scene);
    }
  }
  
  if (weapons.rapidFire.active) {
    weapons.rapidFire.cooldown -= delta;
    if (weapons.rapidFire.cooldown <= 0) {
      weapons.rapidFire.cooldown = weapons.rapidFire.rate;
      fireRapidFire();
    }
  }
}

function fireLaser() {
  if (bananas.length === 0) return;
  
  // Find nearest banana
  let nearest = null;
  let minDist = Infinity;
  
  for (let b of bananas) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = b;
    }
  }
  
  if (nearest) {
    const dx = nearest.x - player.x;
    const dy = nearest.y - player.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    projectiles.push({
      x: player.x,
      y: player.y,
      vx: (dx / len) * 600,
      vy: (dy / len) * 600,
      type: 'laser',
      damage: weapons.laser.damage,
      life: 2000
    });
    
    // Laser fire particles
    for (let i = 0; i < 5; i++) {
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
      const speed = 300 + Math.random() * 200;
      particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 150,
        maxLife: 150,
        size: 1.5,
        color: COLORS.red
      });
    }
  }
}

function fireBlueLaser() {
  if (bananas.length === 0) return;
  
  // Find second nearest banana (or random if only one)
  let targets = [];
  
  for (let b of bananas) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    targets.push({ banana: b, dist: dist });
  }
  
  // Sort by distance
  targets.sort((a, b) => a.dist - b.dist);
  
  // Target second nearest, or first if only one
  let target = targets.length > 1 ? targets[1].banana : targets[0].banana;
  
  if (target) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    projectiles.push({
      x: player.x,
      y: player.y,
      vx: (dx / len) * 600,
      vy: (dy / len) * 600,
      type: 'blueLaser',
      damage: weapons.blueLaser.damage,
      life: 2000
    });
    
    // Blue laser fire particles
    for (let i = 0; i < 5; i++) {
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
      const speed = 300 + Math.random() * 200;
      particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 150,
        maxLife: 150,
        size: 1.5,
        color: COLORS.blue
      });
    }
  }
}

function fireMissile() {
  if (bananas.length === 0) return;
  
  // Find nearest banana
  let nearest = null;
  let minDist = Infinity;
  
  for (let b of bananas) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = b;
    }
  }
  
  if (!nearest) return;
  
  const dx = nearest.x - player.x;
  const dy = nearest.y - player.y;
  const angle = Math.atan2(dy, dx);
  const distance = weapons.missile.range;
  const targetX = player.x + Math.cos(angle) * distance;
  const targetY = player.y + Math.sin(angle) * distance;
  
  projectiles.push({
    x: player.x,
    y: player.y,
    targetX: targetX,
    targetY: targetY,
    vx: Math.cos(angle) * 250,
    vy: Math.sin(angle) * 250,
    type: 'missile',
    damage: weapons.missile.damage,
    explosionRadius: weapons.missile.explosionRadius,
    life: 2000,
    traveled: 0
  });
}

function fireTripleShot() {
  if (bananas.length === 0) return;
  
  // Find nearest banana
  let nearest = null;
  let minDist = Infinity;
  
  for (let b of bananas) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = b;
    }
  }
  
  if (nearest) {
    const dx = nearest.x - player.x;
    const dy = nearest.y - player.y;
    const baseAngle = Math.atan2(dy, dx);
    
    // Fire 3 shots in a spread
    const spreadAngles = [-0.2, 0, 0.2];
    for (let angleOffset of spreadAngles) {
      const angle = baseAngle + angleOffset;
      projectiles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * 600,
        vy: Math.sin(angle) * 600,
        type: 'tripleShot',
        damage: weapons.tripleShot.damage,
        life: 2000
      });
    }
    
    // Triple shot particles
    for (let i = 0; i < 8; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * 0.8;
      const speed = 200 + Math.random() * 150;
      particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 150,
        maxLife: 150,
        size: 1.5,
        color: 0xff00ff
      });
    }
  }
}

function firePulseWave(scene) {
  // Debug: log the actual range value
  console.log('Pulse wave range:', weapons.pulseWave.range);
  
  // Create expanding wave that damages all enemies in range
  explosions.push({
    x: player.x,
    y: player.y,
    radius: 0,
    maxRadius: weapons.pulseWave.range,
    life: 400,
    maxLife: 400,
    isPulseWave: true
  });
  
  // Damage enemies in range
  for (let i = bananas.length - 1; i >= 0; i--) {
    const b = bananas[i];
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < weapons.pulseWave.range) {
      b.hp -= weapons.pulseWave.damage;
      if (b.hp <= 0) {
        killBanana(scene, i);
      } else {
        createSparks(b.x, b.y, 5);
      }
    }
  }
  
  // Pulse wave particles
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2;
    const speed = 200;
    particles.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 400,
      maxLife: 400,
      size: 2,
      color: 0x00ff00
    });
  }
  
  playTone(scene, 300, 0.15);
}

function fireRapidFire() {
  if (bananas.length === 0) return;
  
  // Find nearest banana
  let nearest = null;
  let minDist = Infinity;
  
  for (let b of bananas) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = b;
    }
  }
  
  if (nearest) {
    const dx = nearest.x - player.x;
    const dy = nearest.y - player.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    projectiles.push({
      x: player.x,
      y: player.y,
      vx: (dx / len) * 700,
      vy: (dy / len) * 700,
      type: 'rapidFire',
      damage: weapons.rapidFire.damage,
      life: 2000
    });
    
    // Rapid fire particles (small burst)
    for (let i = 0; i < 3; i++) {
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.3;
      const speed = 400 + Math.random() * 100;
      particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 100,
        maxLife: 100,
        size: 1,
        color: 0xffff00
      });
    }
  }
}

function updateProjectiles(scene, delta) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * delta / 1000;
    p.y += p.vy * delta / 1000;
    p.life -= delta;
    
    // Add trailing particles for lasers
    if ((p.type === 'laser' || p.type === 'blueLaser') && Math.random() > 0.3) {
      particles.push({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        life: 100,
        maxLife: 100,
        size: 1.5,
        color: p.type === 'laser' ? COLORS.red : COLORS.blue
      });
    }
    
    // Add trailing particles for new weapons
    if (p.type === 'tripleShot' && Math.random() > 0.5) {
      particles.push({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        life: 100,
        maxLife: 100,
        size: 1,
        color: 0xff00ff
      });
    }
    
    if (p.type === 'rapidFire' && Math.random() > 0.6) {
      particles.push({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 80,
        maxLife: 80,
        size: 1,
        color: 0xffff00
      });
    }
    
    // Check missile distance traveled
    if (p.type === 'missile') {
      const dx = p.x - player.x;
      const dy = p.y - player.y;
      p.traveled = Math.sqrt(dx * dx + dy * dy);
      
      // Explode if reached max range or expired
      if (p.traveled >= weapons.missile.range || p.life <= 0) {
        createExplosion(scene, p.x, p.y, p.explosionRadius, p.damage);
        projectiles.splice(i, 1);
        continue;
      }
    }
    
    // Remove lasers if out of bounds or expired
    if ((p.type === 'laser' || p.type === 'blueLaser' || p.type === 'tripleShot' || p.type === 'rapidFire') && (p.x < 0 || p.x > 800 || p.y < 0 || p.y > 600 || p.life <= 0)) {
      projectiles.splice(i, 1);
      continue;
    }
    
    // Check collision with bananas
    for (let j = bananas.length - 1; j >= 0; j--) {
      const b = bananas[j];
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < b.hitboxSize + 5) {
        b.hp -= p.damage;
        if (b.hp <= 0) {
          killBanana(scene, j);
        } else {
          // Spawn impact sparks
          createSparks(p.x, p.y, 5);
        }
        
        if (p.type === 'laser' || p.type === 'blueLaser' || p.type === 'tripleShot' || p.type === 'rapidFire') {
          projectiles.splice(i, 1);
        } else if (p.type === 'missile') {
          createExplosion(scene, p.x, p.y, p.explosionRadius, p.damage);
          projectiles.splice(i, 1);
        }
        break;
      }
    }
  }
}

function createExplosion(scene, x, y, radius, damage) {
  console.log('Creating explosion - radius:', radius, 'at level:', level, 'missile explosionRadius:', weapons.missile.explosionRadius);
  
  // Create visual explosion
  explosions.push({
    x: x,
    y: y,
    radius: 0,
    maxRadius: radius,
    life: 300,
    maxLife: 300
  });
  
  // Create many sparks
  createSparks(x, y, 20);
  
  // Damage all bananas in radius
  for (let i = bananas.length - 1; i >= 0; i--) {
    const b = bananas[i];
    const dx = b.x - x;
    const dy = b.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < radius) {
      b.hp -= damage;
      if (b.hp <= 0) {
        killBanana(scene, i);
      }
    }
  }
  
  playTone(scene, 150, 0.2);
}

function updateExplosions(delta) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life -= delta;
    e.radius = e.maxRadius * (1 - e.life / e.maxLife);
    
    if (e.life <= 0) {
      explosions.splice(i, 1);
    }
  }
}

function createSparks(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 100;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 300 + Math.random() * 200,
      maxLife: 300 + Math.random() * 200,
      size: 2 + Math.random() * 2,
      color: Math.random() > 0.5 ? 0xffaa00 : 0xffff00
    });
  }
}

function createDamageParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 150 + Math.random() * 150;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 400 + Math.random() * 300,
      maxLife: 400 + Math.random() * 300,
      size: 3 + Math.random() * 3,
      color: Math.random() > 0.3 ? 0xff0000 : 0xff6666
    });
  }
}

// ============================================================================
// PARTICLE & VISUAL EFFECTS
// ============================================================================

function updateBackgroundParticles(delta) {
  for (let p of backgroundParticles) {
    p.x += p.vx * delta / 1000;
    p.y += p.vy * delta / 1000;
    
    // Wrap around screen
    if (p.x < 0) p.x = GAME_CONFIG.width;
    if (p.x > GAME_CONFIG.width) p.x = 0;
    if (p.y < 0) p.y = GAME_CONFIG.height;
    if (p.y > GAME_CONFIG.height) p.y = 0;
    
    // Slight alpha pulsing
    p.alpha += (Math.random() - 0.5) * 0.02;
    p.alpha = Math.max(0.05, Math.min(0.4, p.alpha));
  }
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * delta / 1000;
    p.y += p.vy * delta / 1000;
    p.life -= delta;
    
    // Slow down over time
    p.vx *= 0.95;
    p.vy *= 0.95;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

// ============================================================================
// ENEMY SYSTEMS
// ============================================================================

function spawnBanana() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  
  if (side === 0) { x = -20; y = Math.random() * 600; }
  else if (side === 1) { x = 820; y = Math.random() * 600; }
  else if (side === 2) { x = Math.random() * 800; y = -20; }
  else { x = Math.random() * 800; y = 620; }
  
  // Determine banana type based on level
  let bananaType = 'normal';
  const rand = Math.random() * 100;
  
  // Red bananas start appearing at level 5 (fast & aggressive)
  if (level >= 5 && rand < 10 + (level * 2)) {
    bananaType = 'red';
  }
  
  // Blue bananas start appearing at level 15 (tanky)
  if (level >= 15 && rand < 5 + level) {
    bananaType = 'blue';
  }
  
  const config = ENEMY_CONFIG[bananaType];
  
  // Scalable speed from level 1 to 100+
  const levelSpeedBonus = Math.min(level * 1.5, 150);
  const baseSpeed = config.baseSpeed + levelSpeedBonus;
  
  // Random speed variance
  const speedMultiplier = 0.3 + Math.random() * 0.7;
  const variance = Math.random() * config.speedVariance;
  const finalSpeed = (baseSpeed * speedMultiplier) + variance;
  
  // HP scales with level
  const hpScaling = 1 + (level * 0.3);
  
  bananas.push({
    x: x,
    y: y,
    size: config.size,
    hitboxSize: config.hitbox,
    speed: finalSpeed,
    hp: Math.floor(config.baseHp * hpScaling),
    maxHp: Math.floor(config.baseHp * hpScaling),
    sprite: null,
    isBoss: false,
    type: bananaType,
    scoreValue: config.scoreValue,
    gemDrop: config.gemDrop
  });
  
  // Spawn particles when banana appears
  const particleColor = bananaType === 'red' ? COLORS.red : bananaType === 'blue' ? COLORS.blue : COLORS.yellow;
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 50;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 300,
      maxLife: 300,
      size: 2,
      color: particleColor
    });
  }
}

function spawnMiniBoss() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  
  if (side === 0) { x = -50; y = Math.random() * 600; }
  else if (side === 1) { x = 850; y = Math.random() * 600; }
  else if (side === 2) { x = Math.random() * 800; y = -50; }
  else { x = Math.random() * 800; y = 650; }
  
  bananas.push({
    x: x,
    y: y,
    size: 40,
    hitboxSize: 18,
    speed: 25,
    hp: 500,
    maxHp: 500,
    sprite: null,
    isBoss: true
  });
  
  // Big boss spawn effect
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 100;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 500,
      maxLife: 500,
      size: 3 + Math.random() * 2,
      color: COLORS.orange
    });
  }
}

function updateBananas(delta) {
  for (let b of bananas) {
    const dx = player.x - b.x;
    const dy = player.y - b.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len > 0) {
      b.x += (dx / len) * b.speed * delta / 1000;
      b.y += (dy / len) * b.speed * delta / 1000;
    }
    
    // Keep bananas within play area
    b.x = Math.max(b.size, Math.min(800 - b.size, b.x));
    b.y = Math.max(b.size, Math.min(600 - b.size, b.y));
    
    // Emit trailing particles for bosses
    if (b.isBoss && Math.random() > 0.7) {
      particles.push({
        x: b.x + (Math.random() - 0.5) * b.size,
        y: b.y + (Math.random() - 0.5) * b.size,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        life: 300,
        maxLife: 300,
        size: 2,
        color: COLORS.orange
      });
    }
  }
}

function killBanana(scene, index) {
  const b = bananas[index];
  const scoreValue = b.isBoss ? 100 : (b.scoreValue || 10);
  score += scoreValue;
  scoreText.setText(score.toString());
  
  // Destroy sprite if it exists
  if (b.sprite) {
    b.sprite.destroy();
  }
  
  // Create death explosion sparks (more for boss)
  const sparkColor = b.type === 'red' ? COLORS.red : b.type === 'blue' ? COLORS.blue : COLORS.yellow;
  createSparks(b.x, b.y, b.isBoss ? 20 : 8, sparkColor);
  
  // Drop gems
  const gemCount = b.isBoss ? 10 : (b.gemDrop || 1);
  for (let i = 0; i < gemCount; i++) {
    const offsetX = (Math.random() - 0.5) * 20;
    const offsetY = (Math.random() - 0.5) * 20;
    gems.push({ x: b.x + offsetX, y: b.y + offsetY, value: 1 });
  }
  
  bananas.splice(index, 1);
  playTone(scene, 660, 0.05);
}

// ============================================================================
// PROGRESSION SYSTEMS
// ============================================================================

function updateFeverMode(delta) {
  // Clean up old gem collect timestamps
  const now = Date.now();
  recentGemCollects = recentGemCollects.filter(time => now - time < 2000);
  
  // Update fever timer
  if (feverMode) {
    feverTimer -= delta;
    if (feverTimer <= 0) {
      feverMode = false;
    }
  } else {
    // Check if we should enter fever mode
    if (recentGemCollects.length >= GAME_CONFIG.feverThreshold) {
      feverMode = true;
      feverTimer = GAME_CONFIG.feverDuration;
    }
  }
}

function updateGems(scene) {
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Emit sparkle particles from gems
    if (Math.random() > 0.8) {
      particles.push({
        x: g.x + (Math.random() - 0.5) * 6,
        y: g.y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        life: 200,
        maxLife: 200,
        size: 1,
        color: COLORS.green
      });
    }
    
    // Magnet effect - increased range if magnet is active or in fever mode
    let effectiveMagnetRange = magnetActive ? magnetRange : 0;
    if (feverMode) {
      effectiveMagnetRange += GAME_CONFIG.feverMagnetBonus;
    }
    
    if (dist < effectiveMagnetRange) {
      const len = Math.max(dist, 1);
      const magnetSpeed = feverMode ? GAME_CONFIG.magnetSpeed * 2 : GAME_CONFIG.magnetSpeed;
      g.x += (dx / len) * magnetSpeed * 0.016;
      g.y += (dy / len) * magnetSpeed * 0.016;
    }
    
    // Collect
    if (dist < player.size + 5) {
      xp += g.value;
      gems.splice(i, 1);
      
      // XP collect sound
      playXPCollectSound(scene);
      
      // Track gem collection for fever mode
      recentGemCollects.push(Date.now());
      
      // Gem collect particles (green)
      for (let j = 0; j < 8; j++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 50;
        particles.push({
          x: g.x,
          y: g.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 200,
          maxLife: 200,
          size: 1.5,
          color: COLORS.green
        });
      }
      
      // Level up every 10 XP
      if (xp >= level * 10) {
        levelUp(scene);
      }
    }
  }
}

function levelUp(scene) {
  level++;
  levelText.setText('LVL ' + level);
  
  // HP bonus every 10 levels
  if (level % 10 === 0) {
    const hpBonus = 20;
    hp = Math.min(hp + hpBonus, 200); // Cap at 200 HP
    
    // HP bonus particles
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 100;
      particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 500,
        maxLife: 500,
        size: 2 + Math.random() * 1,
        color: 0x00ff00
      });
    }
  }
  
  // Level up particles burst!
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 150;
    particles.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 600,
      maxLife: 600,
      size: 2 + Math.random() * 2,
      color: Math.random() > 0.5 ? COLORS.cyan : COLORS.yellow
    });
  }
  
  // Milestone weapon unlocks
  if (level === 5) {
    weapons.missile.active = true;
    weapons.missile.level = 1;
  } else if (level === 10) {
    weapons.blueLaser.active = true;
    weapons.blueLaser.level = 1;
  } else if (level === 25) {
    // Unlock magnet
    magnetActive = true;
    magnetRange = 150;
  } else if (level === 30) {
    weapons.tripleShot.active = true;
    weapons.tripleShot.level = 1;
  } else if (level === 40) {
    weapons.pulseWave.active = true;
    weapons.pulseWave.level = 1;
  } else if (level === 50) {
    weapons.rapidFire.active = true;
    weapons.rapidFire.level = 1;
  } else if (level === 60) {
    // Mega damage boost
    weapons.laser.damage += 20;
    weapons.blueLaser.damage += 20;
    weapons.missile.damage += 30;
  } else if (level === 70) {
    // Mega fire rate boost
    weapons.laser.rate = Math.max(100, weapons.laser.rate - 150);
    weapons.blueLaser.rate = Math.max(100, weapons.blueLaser.rate - 150);
    weapons.tripleShot.rate = Math.max(150, weapons.tripleShot.rate - 200);
    weapons.rapidFire.rate = Math.max(60, weapons.rapidFire.rate - 50);
  } else if (level === 80) {
    // Ultimate boost - missile explosion stays at base size
    // Pulse wave stays at base range
  } else {
    // Random upgrade for other levels
    const upgrades = [];
    if (weapons.laser.level < 15) upgrades.push('laser+');
    if (weapons.missile.active && weapons.missile.level < 15) upgrades.push('missile+');
    if (weapons.blueLaser.active && weapons.blueLaser.level < 15) upgrades.push('blueLaser+');
    if (weapons.tripleShot.active && weapons.tripleShot.level < 15) upgrades.push('tripleShot+');
    if (weapons.pulseWave.active && weapons.pulseWave.level < 15) upgrades.push('pulseWave+');
    if (weapons.rapidFire.active && weapons.rapidFire.level < 15) upgrades.push('rapidFire+');
    
    if (upgrades.length > 0) {
      const choice = upgrades[Math.floor(Math.random() * upgrades.length)];
      applyUpgrade(choice);
    }
  }
  
  playMeow(scene);
}

function applyUpgrade(upgrade) {
  if (upgrade === 'laser+') {
    weapons.laser.level++;
    weapons.laser.damage += 5;
    weapons.laser.rate = Math.max(150, weapons.laser.rate - 30);
  } else if (upgrade === 'missile+') {
    weapons.missile.level++;
    weapons.missile.damage += 10;
    // Explosion radius stays fixed - only damage and rate improve
    weapons.missile.rate = Math.max(800, weapons.missile.rate - 80);
  } else if (upgrade === 'blueLaser+') {
    weapons.blueLaser.level++;
    weapons.blueLaser.damage += 5;
    weapons.blueLaser.rate = Math.max(150, weapons.blueLaser.rate - 25);
  } else if (upgrade === 'tripleShot+') {
    weapons.tripleShot.level++;
    weapons.tripleShot.damage += 4;
    weapons.tripleShot.rate = Math.max(200, weapons.tripleShot.rate - 35);
  } else if (upgrade === 'pulseWave+') {
    weapons.pulseWave.level++;
    weapons.pulseWave.damage += 8;
    // Range stays at 50 - only damage and rate improve
    weapons.pulseWave.rate = Math.max(600, weapons.pulseWave.rate - 70);
  } else if (upgrade === 'rapidFire+') {
    weapons.rapidFire.level++;
    weapons.rapidFire.damage += 3;
    weapons.rapidFire.rate = Math.max(80, weapons.rapidFire.rate - 10);
  }
}

// ============================================================================
// COLLISION DETECTION
// ============================================================================

function checkCollisions(scene) {
  for (let b of bananas) {
    const dx = player.x - b.x;
    const dy = player.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < player.size + b.hitboxSize) {
      hp -= 5;
      
      // Create red damage particles at player position
      createDamageParticles(player.x, player.y, 12);
      
      if (hp <= 0) {
        hp = 0;
        endGame(scene);
      }
      playTone(scene, 220, 0.1);
    }
  }
}

// ============================================================================
// RENDERING
// ============================================================================

function draw() {
  graphics.clear();
  
  // Draw background particles first (behind everything)
  for (let p of backgroundParticles) {
    graphics.fillStyle(p.color, p.alpha);
    graphics.fillCircle(p.x, p.y, p.size);
  }
  
  // Draw play area border (darker)
  graphics.lineStyle(2, 0x00ffff, 0.3);
  graphics.strokeRect(0, 0, 800, 600);
  
  // Draw magnet range indicator removed - magnet still works but no visual circle
  
  // Draw grid (subtle)
  graphics.lineStyle(1, 0x00ffff, 0.05);
  for (let x = 0; x <= 800; x += 50) {
    graphics.lineBetween(x, 0, x, 600);
  }
  for (let y = 0; y <= 600; y += 50) {
    graphics.lineBetween(0, y, 800, y);
  }
  
  // Draw player (Japanese UFO)
  const px = player.x;
  const py = player.y;
  
  // UFO bottom dome (dark gray)
  graphics.fillStyle(0x555555, 1);
  graphics.fillEllipse(px, py + 6, player.size * 0.8, player.size * 0.4);
  
  // UFO main body/dome (silver/gray with gradient effect)
  graphics.fillStyle(0xaaaaaa, 1);
  graphics.fillEllipse(px, py, player.size * 1.2, player.size * 0.7);
  
  // Highlight on dome (bright silver)
  graphics.fillStyle(0xeeeeee, 1);
  graphics.fillEllipse(px - 3, py - 4, player.size * 0.6, player.size * 0.4);
  
  // Top of dome (darker for depth)
  graphics.fillStyle(0x888888, 1);
  graphics.fillEllipse(px, py - 5, player.size * 0.5, player.size * 0.3);
  
  // Cockpit/window (cyan glow)
  graphics.fillStyle(0x00ffff, 0.8);
  graphics.fillCircle(px, py - 2, player.size * 0.35);
  
  // Cockpit detail (darker center)
  graphics.fillStyle(0x00aaaa, 1);
  graphics.fillCircle(px, py - 2, player.size * 0.2);
  
  // UFO ring/rim (metallic gold/yellow)
  graphics.lineStyle(3, 0xffcc00, 1);
  graphics.strokeEllipse(px, py + 2, player.size * 1.3, player.size * 0.5);
  
  // Inner rim detail
  graphics.lineStyle(2, 0xffdd44, 0.7);
  graphics.strokeEllipse(px, py + 2, player.size * 1.1, player.size * 0.4);
  
  // Bottom lights (red and blue alternating)
  const lightPositions = [-10, -5, 0, 5, 10];
  for (let i = 0; i < lightPositions.length; i++) {
    const lightX = px + lightPositions[i];
    const lightY = py + 8;
    const lightColor = i % 2 === 0 ? 0xff0000 : 0x00ff00;
    
    // Light glow
    graphics.fillStyle(lightColor, 0.5);
    graphics.fillCircle(lightX, lightY, 3);
    
    // Light core
    graphics.fillStyle(lightColor, 1);
    graphics.fillCircle(lightX, lightY, 1.5);
  }
  
  // Antenna on top (optional detail)
  graphics.lineStyle(2, 0x888888, 1);
  graphics.lineBetween(px, py - 10, px, py - 14);
  
  // Antenna tip (blinking light)
  const blinkColor = Math.floor(Date.now() / 200) % 2 === 0 ? 0xff0000 : 0xffff00;
  graphics.fillStyle(blinkColor, 1);
  graphics.fillCircle(px, py - 14, 2);
  
  // Draw explosions
  for (let e of explosions) {
    const alpha = e.life / e.maxLife;
    
    if (e.isPulseWave) {
      // Pulse wave effect (green)
      graphics.lineStyle(4, 0x00ff00, alpha * 0.8);
      graphics.strokeCircle(e.x, e.y, e.radius);
      graphics.lineStyle(2, 0x00ffaa, alpha * 0.5);
      graphics.strokeCircle(e.x, e.y, e.radius * 0.8);
    } else {
      // Regular explosion (orange/yellow)
      graphics.lineStyle(3, 0xff6600, alpha);
      graphics.strokeCircle(e.x, e.y, e.radius);
      // Middle ring (yellow)
      graphics.lineStyle(2, 0xffff00, alpha * 0.7);
      graphics.strokeCircle(e.x, e.y, e.radius * 0.7);
      // Inner flash (white)
      if (alpha > 0.5) {
        graphics.fillStyle(0xffffff, (alpha - 0.5) * 2);
        graphics.fillCircle(e.x, e.y, e.radius * 0.3);
      }
    }
  }
  
  // Draw bananas (vector outline)
  for (let b of bananas) {
    const scale = b.isBoss ? 2.5 : 1.0;
    const colorMain = b.isBoss ? 0xFF5500 : 0xF9BC13;
    
    // Draw banana outline as vector shape
    graphics.lineStyle(b.isBoss ? 4 : 2, colorMain, 1);
    graphics.beginPath();
    
    // Banana shape coordinates (relative to center)
    const points = [
      [-8, -3],
      [-3, -3],
      [2, -5],
      [4, -8],
      [4, -10],
      [6, -14],
      [9, -13],
      [7, -11],
      [8, -8],
      [9, -4],
      [6, 1],
      [0, 4],
      [-7, 3],
      [-10, -1],
      [-11, -3],
      [-9, -4],
      [-8, -3]
    ];
    
    // Move to first point
    graphics.moveTo(b.x + points[0][0] * scale, b.y + points[0][1] * scale);
    
    // Draw lines to each point
    for (let i = 1; i < points.length; i++) {
      graphics.lineTo(b.x + points[i][0] * scale, b.y + points[i][1] * scale);
    }
    
    graphics.closePath();
    graphics.strokePath();
    
    // Destroy sprite if it exists (using vectors now)
    if (b.sprite) {
      b.sprite.destroy();
      b.sprite = null;
    }
  }
  
  // Draw projectiles
  for (let p of projectiles) {
    if (p.type === 'laser') {
      graphics.fillStyle(0xff0000, 1);
      graphics.fillRect(p.x - 3, p.y - 3, 6, 6);
      // Add glow
      graphics.fillStyle(0xff0000, 0.3);
      graphics.fillCircle(p.x, p.y, 8);
    } else if (p.type === 'blueLaser') {
      graphics.fillStyle(0x00aaff, 1);
      graphics.fillRect(p.x - 3, p.y - 3, 6, 6);
      // Blue glow
      graphics.fillStyle(0x00aaff, 0.3);
      graphics.fillRect(p.x - 5, p.y - 5, 10, 10);
    } else if (p.type === 'tripleShot') {
      graphics.fillStyle(0xff00ff, 1);
      graphics.fillCircle(p.x, p.y, 3);
      // Purple glow
      graphics.fillStyle(0xff00ff, 0.3);
      graphics.fillCircle(p.x, p.y, 6);
    } else if (p.type === 'rapidFire') {
      graphics.fillStyle(0xffff00, 1);
      graphics.fillCircle(p.x, p.y, 2);
      // Yellow streak
      graphics.fillStyle(0xffff00, 0.5);
      graphics.fillCircle(p.x - p.vx * 0.01, p.y - p.vy * 0.01, 3);
    } else if (p.type === 'missile') {
      // Missile body (larger)
      graphics.fillStyle(0x555555, 1);
      graphics.fillCircle(p.x, p.y, 8);
      graphics.fillStyle(0x333333, 1);
      graphics.fillCircle(p.x, p.y, 6);
      // Missile tip (red)
      graphics.fillStyle(0xff0000, 1);
      graphics.fillCircle(p.x, p.y, 4);
      // Missile trail (bigger and more visible)
      graphics.fillStyle(0xffaa00, 0.6);
      graphics.fillCircle(p.x - p.vx * 0.02, p.y - p.vy * 0.02, 5);
      graphics.fillStyle(0xff6600, 0.4);
      graphics.fillCircle(p.x - p.vx * 0.04, p.y - p.vy * 0.04, 4);
    }
  }
  
  // Draw particles (sparks)
  for (let p of particles) {
    const alpha = p.life / p.maxLife;
    const particleColor = p.color !== undefined ? p.color : 0xffaa00;
    graphics.fillStyle(particleColor, alpha);
    graphics.fillCircle(p.x, p.y, p.size);
  }
  
  // Draw gems (XP)
  for (let g of gems) {
    // Gem glow (green with fever mode enhancement)
    const glowColor = feverMode ? 0x00ff00 : 0x00aa00;
    const glowSize = feverMode ? 10 : 6;
    graphics.fillStyle(glowColor, feverMode ? 0.6 : 0.4);
    graphics.fillCircle(g.x, g.y, glowSize);
    
    // Gem core (green)
    graphics.fillStyle(0x00ff00, 1);
    graphics.fillCircle(g.x, g.y, 4);
    
    // Bright center (lighter green)
    graphics.fillStyle(0x88ff88, 1);
    graphics.fillCircle(g.x, g.y, 2);
    
    // Extra sparkle in fever mode
    if (feverMode && Math.random() > 0.7) {
      graphics.fillStyle(0xffffff, 0.8);
      graphics.fillCircle(g.x, g.y, 1);
    }
  }
  
  // Update HP bar (glowing)
  hpBar.clear();
  const hpPercent = hp / 100;
  
  // Glow effect
  hpBar.fillStyle(0xff0000, 0.3);
  hpBar.fillRect(18, 558, hp * 2 + 4, 24);
  
  // Main bar
  hpBar.fillStyle(0xff0000, 1);
  hpBar.fillRect(20, 560, hp * 2, 20);
  
  // Bright edge
  if (hp > 0) {
    hpBar.fillStyle(0xff6666, 1);
    hpBar.fillRect(20, 560, hp * 2, 4);
  }

  // Update XP bar (green)
  xpBar.clear();
  const xpInLevel = xp % 10; // Current XP progress within the level (0-9)
  const xpPercent = xpInLevel / 10; // Convert to 0.0-1.0
  const xpWidth = 200 * xpPercent;
  
  // Fever mode pulsing effect
  const feverPulse = feverMode ? Math.sin(Date.now() / 100) * 0.2 + 0.3 : 0.3;
  
  // Glow effect (enhanced in fever mode)
  xpBar.fillStyle(0x00ff00, feverPulse);
  xpBar.fillRect(18, 581, xpWidth + 4, 14);
  
  // Main bar (green)
  xpBar.fillStyle(0x00ff00, 1);
  xpBar.fillRect(20, 583, xpWidth, 10);
  
  // Bright edge
  if (xpWidth > 0) {
    xpBar.fillStyle(0x88ff88, 1);
    xpBar.fillRect(20, 583, xpWidth, 2);
  }
  
  // Fever mode indicator
  if (feverMode) {
    const feverAlpha = Math.sin(Date.now() / 80) * 0.3 + 0.7;
    xpBar.fillStyle(0xffff00, feverAlpha);
    xpBar.fillRect(18, 581, 204, 2);
    xpBar.fillRect(18, 593, 204, 2);
  }
}

function updateTimer() {
  const seconds = Math.floor(gameDuration / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timeText.setText(mins + ':' + (secs < 10 ? '0' : '') + secs);
}

// ============================================================================
// GAME STATE MANAGEMENT
// ============================================================================

function loadLeaderboard() {
  try {
    const saved = localStorage.getItem('platanus_survivor_leaderboard');
    if (saved) {
      leaderboard = JSON.parse(saved);
    } else {
      leaderboard = [];
    }
  } catch (e) {
    leaderboard = [];
  }
}

function saveLeaderboard() {
  try {
    localStorage.setItem('platanus_survivor_leaderboard', JSON.stringify(leaderboard));
  } catch (e) {
    // Silent fail if localStorage is not available
  }
}

function addToLeaderboard(newScore, time) {
  leaderboard.push({ score: newScore, time: time, date: Date.now() });
  
  // Sort by score (descending)
  leaderboard.sort((a, b) => b.score - a.score);
  
  // Keep only top entries
  if (leaderboard.length > MAX_LEADERBOARD_ENTRIES) {
    leaderboard = leaderboard.slice(0, MAX_LEADERBOARD_ENTRIES);
  }
  
  saveLeaderboard();
}

function endGame(scene) {
  gameOver = true;
  
  // Stop background music
  stopBackgroundMusic();
  
  // Add current score to leaderboard
  addToLeaderboard(score, gameDuration);
  
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.8);
  overlay.fillRect(0, 0, 800, 600);
  
  // ASCII "GAME OVER"
  scene.add.text(400, 100, 
    ' ██████╗  █████╗ ███╗   ███╗███████╗     ██████╗ ██╗   ██╗███████╗██████╗ \n' +
    '██╔════╝ ██╔══██╗████╗ ████║██╔════╝    ██╔═══██╗██║   ██║██╔════╝██╔══██╗\n' +
    '██║  ███╗███████║██╔████╔██║█████╗      ██║   ██║██║   ██║█████╗  ██████╔╝\n' +
    '██║   ██║██╔══██║██║╚██╔╝██║██╔══╝      ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗\n' +
    '╚██████╔╝██║  ██║██║ ╚═╝ ██║███████╗    ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║\n' +
    ' ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝     ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝', {
    fontSize: '10px',
    fontFamily: 'Consolas, monospace',
    color: '#ff2828ff',
    align: 'center',
    lineSpacing: -2
  }).setOrigin(0.5);
  
  scene.add.text(400, 210, 'SCORE: ' + score, {
    fontSize: '32px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5);
  
  const mins = Math.floor(gameDuration / 60000);
  const secs = Math.floor((gameDuration % 60000) / 1000);
  scene.add.text(400, 250, 'TIME: ' + mins + ':' + (secs < 10 ? '0' : '') + secs, {
    fontSize: '24px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff'
  }).setOrigin(0.5);
  
  // Leaderboard title
  scene.add.text(400, 295, '═══ LEADERBOARD ═══', {
    fontSize: '18px',
    fontFamily: 'Consolas, monospace',
    color: '#F9BC13',
    stroke: '#000000',
    strokeThickness: 3
  }).setOrigin(0.5);
  
  // Display leaderboard entries
  const startY = 325;
  const lineHeight = 22;
  const maxDisplay = Math.min(8, leaderboard.length);
  
  for (let i = 0; i < maxDisplay; i++) {
    const entry = leaderboard[i];
    const rank = i + 1;
    const entryMins = Math.floor(entry.time / 60000);
    const entrySecs = Math.floor((entry.time % 60000) / 1000);
    const timeStr = entryMins + ':' + (entrySecs < 10 ? '0' : '') + entrySecs;
    
    // Highlight current score
    const isCurrentScore = i === 0 || (entry.score === score && entry.time === gameDuration);
    const color = isCurrentScore ? '#00ffff' : '#ffffff';
    const fontSize = isCurrentScore ? '16px' : '14px';
    
    // Rank and score
    const text = `${rank}. ${entry.score.toString().padStart(6, ' ')}  ${timeStr}`;
    
    scene.add.text(400, startY + i * lineHeight, text, {
      fontSize: fontSize,
      fontFamily: 'Consolas, monospace',
      color: color,
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
  }
  
  // Restart button
  const restartBtn = scene.add.text(400, 535, 'RESTART', {
    fontSize: '28px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  
  // Press Enter hint
  scene.add.text(400, 570, 'Press ENTER to restart', {
    fontSize: '16px',
    fontFamily: 'Consolas, monospace',
    color: '#aaaaaa',
    stroke: '#000000',
    strokeThickness: 2
  }).setOrigin(0.5);
  
  restartBtn.on('pointerover', () => {
    restartBtn.setColor('#aaaaaa');
  });
  
  restartBtn.on('pointerout', () => {
    restartBtn.setColor('#ffffff');
  });
  
  restartBtn.on('pointerdown', () => {
    scene.scene.restart();
    resetGame();
  });
  
  // Restart on any key (except movement keys) or Enter
  scene.input.keyboard.once('keydown', (event) => {
    const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];
    if (!movementKeys.includes(event.key) || event.key === 'Enter') {
      scene.scene.restart();
      resetGame();
    }
  });
  
  playGameOver(scene);
}

function resetGame() {
  gameOver = false;
  gameStarted = false;
  score = 0;
  xp = 0;
  level = 1;
  hp = 100;
  gameDuration = 0;
  
  // Destroy all banana sprites
  for (let b of bananas) {
    if (b.sprite) b.sprite.destroy();
  }
  
  bananas = [];
  gems = [];
  projectiles = [];
  particles = [];
  explosions = [];
  spawnTimer = 0;
  spawnRate = 500;
  miniBossSpawned = false;
  
  // Reinitialize background particles
  backgroundParticles = [];
  for (let i = 0; i < 100; i++) {
    backgroundParticles.push({
      x: Math.random() * GAME_CONFIG.width,
      y: Math.random() * GAME_CONFIG.height,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.3 + 0.1,
      color: Math.random() > 0.5 ? COLORS.cyan : COLORS.yellow
    });
  }
  
  // Reset magnet and fever
  magnetActive = false;
  magnetRange = GAME_CONFIG.magnetRange;
  feverMode = false;
  feverTimer = 0;
  recentGemCollects = [];
  
  // Reset music
  stopBackgroundMusic();
  
  weapons.laser.active = true;
  weapons.laser.level = 1;
  weapons.laser.damage = 15;
  weapons.laser.cooldown = 0;
  weapons.laser.rate = 400;
  
  weapons.missile.active = false;
  weapons.missile.level = 0;
  weapons.missile.damage = 30;
  weapons.missile.cooldown = 0;
  weapons.missile.rate = 1500;
  weapons.missile.explosionRadius = 35;
  
  weapons.blueLaser.active = false;
  weapons.blueLaser.level = 0;
  weapons.blueLaser.damage = 20;
  weapons.blueLaser.cooldown = 0;
  weapons.blueLaser.rate = 350;
  
  weapons.tripleShot.active = false;
  weapons.tripleShot.level = 0;
  weapons.tripleShot.damage = 12;
  weapons.tripleShot.cooldown = 0;
  weapons.tripleShot.rate = 500;
  
  weapons.pulseWave.active = false;
  weapons.pulseWave.level = 0;
  weapons.pulseWave.damage = 25;
  weapons.pulseWave.cooldown = 0;
  weapons.pulseWave.rate = 1200;
  weapons.pulseWave.range = 50;
  
  weapons.rapidFire.active = false;
  weapons.rapidFire.level = 0;
  weapons.rapidFire.damage = 8;
  weapons.rapidFire.cooldown = 0;
  weapons.rapidFire.rate = 150;
}

// ============================================================================
// AUDIO SYSTEMS
// ============================================================================

function startBackgroundMusic(scene) {
  if (bgMusicPlaying) return;
  bgMusicPlaying = true;
  
  const audioContext = scene.sound.context;
  
  // Extended jazzy SEGA-style chord progression (16 chords for longer loop)
  // Using jazzy 7th chords with more variation
  const chordProgression = [
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [220.00, 261.63, 329.63, 415.30], // Am7
    [174.61, 220.00, 261.63, 329.63], // Fmaj7
    [196.00, 246.94, 293.66, 369.99], // G7
    [293.66, 369.99, 440.00, 554.37], // Dm7
    [196.00, 246.94, 293.66, 369.99], // G7
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [329.63, 415.30, 493.88, 622.25], // Em7
    [220.00, 261.63, 329.63, 415.30], // Am7
    [293.66, 369.99, 440.00, 554.37], // Dm7
    [196.00, 246.94, 293.66, 369.99], // G7
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [174.61, 220.00, 261.63, 329.63], // Fmaj7
    [329.63, 415.30, 493.88, 622.25], // Em7
    [220.00, 261.63, 329.63, 415.30], // Am7
    [196.00, 246.94, 293.66, 369.99]  // G7
  ];
  
  const bassLine = [
    130.81, 110.00, 87.31, 98.00,
    146.83, 98.00, 130.81, 164.81,
    110.00, 146.83, 98.00, 130.81,
    87.31, 164.81, 110.00, 98.00
  ];
  
  let chordIndex = 0;
  const beatsPerChord = 4; // 4 beats per chord
  let beatCount = 0;
  
  function playBeat() {
    if (!bgMusicPlaying) return;
    
    // Increase BPM based on level (starts at 180, increases by 2 BPM per level, caps at 300)
    const baseBPM = 180;
    const bpmIncrease = Math.min(level * 2, 120); // Cap at +120 BPM
    const bpm = baseBPM + bpmIncrease;
    const beatDuration = 60 / bpm;
    
    const now = audioContext.currentTime;
    const currentChordIndex = Math.floor(beatCount / beatsPerChord) % chordProgression.length;
    const beatInChord = beatCount % beatsPerChord;
    const chord = chordProgression[currentChordIndex];
    const bass = bassLine[currentChordIndex];
    
    // Play chord notes on beats 1 and 3 (syncopated rhythm)
    if (beatInChord === 0 || beatInChord === 2) {
      chord.forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.value = freq;
        osc.type = 'triangle';
        
        const vol = beatInChord === 0 ? 0.025 : 0.018;
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        
        osc.start(now);
        osc.stop(now + 0.2);
      });
    }
    
    // Bass on every beat
    const bassOsc = audioContext.createOscillator();
    const bassGain = audioContext.createGain();
    
    bassOsc.connect(bassGain);
    bassGain.connect(audioContext.destination);
    
    bassOsc.frequency.value = bass;
    bassOsc.type = 'sine';
    
    const bassVol = beatInChord === 0 ? 0.1 : 0.06;
    bassGain.gain.setValueAtTime(bassVol, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    bassOsc.start(now);
    bassOsc.stop(now + 0.3);
    
    // Hi-hat on every beat (lighter on off-beats)
    const hihat = audioContext.createOscillator();
    const hihatGain = audioContext.createGain();
    const hihatFilter = audioContext.createBiquadFilter();
    
    hihat.connect(hihatFilter);
    hihatFilter.connect(hihatGain);
    hihatGain.connect(audioContext.destination);
    
    hihat.frequency.value = 10000;
    hihat.type = 'square';
    hihatFilter.type = 'highpass';
    hihatFilter.frequency.value = 8000;
    
    const hihatVol = (beatInChord % 2 === 0) ? 0.02 : 0.012;
    hihatGain.gain.setValueAtTime(hihatVol, now);
    hihatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    hihat.start(now);
    hihat.stop(now + 0.04);
    
    beatCount++;
    setTimeout(playBeat, beatDuration * 1000);
  }
  
  playBeat();
}

function stopBackgroundMusic() {
  bgMusicPlaying = false;
}

function playTone(scene, frequency, duration) {
  const audioContext = scene.sound.context;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = frequency;
  oscillator.type = 'square';
  
  gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

function playXPCollectSound(scene) {
  const audioContext = scene.sound.context;
  const now = audioContext.currentTime;
  
  // Quick upward blip - very short and sweet
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Quick pitch rise from C to E (satisfying interval)
  oscillator.frequency.setValueAtTime(523.25, now);
  oscillator.frequency.exponentialRampToValueAtTime(659.25, now + 0.05);
  
  oscillator.type = 'sine'; // Soft, pleasant tone
  
  // Very short envelope
  gainNode.gain.setValueAtTime(0.08, now);
  gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
  
  oscillator.start(now);
  oscillator.stop(now + 0.08);
}

function playMeow(scene) {
  const audioContext = scene.sound.context;
  const now = audioContext.currentTime;
  
  // Happy level up sound - ascending arpeggio (C major chord + octave)
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Ascending notes: C5 -> E5 -> G5 -> C6 (happy major chord)
  const notes = [523.25, 659.25, 783.99, 1046.50];
  oscillator.frequency.setValueAtTime(notes[0], now);
  oscillator.frequency.setValueAtTime(notes[1], now + 0.08);
  oscillator.frequency.setValueAtTime(notes[2], now + 0.16);
  oscillator.frequency.setValueAtTime(notes[3], now + 0.24);
  
  // Square wave for retro game sound
  oscillator.type = 'square';
  
  // Volume envelope - bouncy and energetic
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gainNode.gain.setValueAtTime(0.15, now + 0.08);
  gainNode.gain.setValueAtTime(0.15, now + 0.16);
  gainNode.gain.setValueAtTime(0.15, now + 0.24);
  gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
  
  oscillator.start(now);
  oscillator.stop(now + 0.4);
}

function playGameOver(scene) {
  const audioContext = scene.sound.context;
  const now = audioContext.currentTime;
  
  // Create oscillator for game over sound
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Descending chromatic scale with wobble
  const notes = [659, 622, 587, 554, 523, 494, 466, 440, 415, 392, 370, 349, 330, 311, 294, 277, 262];
  
  oscillator.frequency.setValueAtTime(notes[0], now);
  
  for (let i = 1; i < notes.length; i++) {
    oscillator.frequency.setValueAtTime(notes[i], now + i * 0.08);
  }
  
  oscillator.type = 'square';
  
  // Volume envelope
  gainNode.gain.setValueAtTime(0.2, now);
  gainNode.gain.linearRampToValueAtTime(0.15, now + 0.5);
  gainNode.gain.exponentialRampToValueAtTime(0.01, now + notes.length * 0.08);
  
  oscillator.start(now);
  oscillator.stop(now + notes.length * 0.08);
}
