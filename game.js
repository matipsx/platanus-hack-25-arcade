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
  difficultyScaleInterval: 15000,
  easyModeTime: 45000
};

const WEAPON_CONFIG = {
  laser: { damage: 15, rate: 1000, speed: 600, minRate: 300 },
  blueLaser: { damage: 20, rate: 800, speed: 600, minRate: 300 },
  missile: { damage: 30, rate: 3000, range: 150, explosionRadius: 50, speed: 250, minRate: 1500 }
};

const ENEMY_CONFIG = {
  normal: { size: 16, hitbox: 6, baseSpeed: 30, speedVariance: 20, baseHp: 10, scoreValue: 10, gemDrop: 1 },
  boss: { size: 40, hitbox: 18, speed: 25, hp: 500, scoreValue: 100, gemDrop: 10, scale: 2.5 }
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
  black: 0x000000
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

// Enemy spawning
let spawnTimer = 0;
let spawnRate = GAME_CONFIG.initialSpawnRate;
let waveLevel = 1;

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
  blueLaser: { active: false, level: 0, damage: WEAPON_CONFIG.blueLaser.damage, cooldown: 0, rate: WEAPON_CONFIG.blueLaser.rate }
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
  xpBg.fillStyle(0x001a33, 0.8);
  xpBg.fillRect(20, 583, 204, 10);
  xpBg.setDepth(100);
  
  xpBar = this.add.graphics();
  xpBar.setDepth(101);

  // Start with laser weapon
  weapons.laser.active = true;
  weapons.laser.level = 1;

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
  
  // Blinking animation
  scene.tweens.add({
    targets: pressStart,
    alpha: { from: 1, to: 0.3 },
    duration: 600,
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

  // Update systems
  updatePlayerMovement(delta);
  updateWeapons(this, delta);
  updateSpawning(delta);
  updateBananas(delta);
  updateProjectiles(this, delta);
  updateParticles(delta);
  updateExplosions(delta);
  updateGems(this);
  checkCollisions(this);
  updateDifficulty();

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
  const currentSpawnRate = gameDuration < GAME_CONFIG.easyModeTime ? spawnRate * 2 : spawnRate;
  
  let adjustedSpawnRate = currentSpawnRate;
  if (level >= 20) {
    const levelPast20 = level - 20;
    const speedMultiplier = Math.pow(0.85, levelPast20);
    adjustedSpawnRate = currentSpawnRate * speedMultiplier;
    adjustedSpawnRate = Math.max(GAME_CONFIG.minSpawnRate, adjustedSpawnRate);
  }
  
  if (spawnTimer >= adjustedSpawnRate) {
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

function updateDifficulty() {
  waveLevel = 1 + Math.floor(gameDuration / GAME_CONFIG.difficultyScaleInterval);
  spawnRate = Math.max(200, GAME_CONFIG.initialSpawnRate - waveLevel * 30);
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
  }
}

function fireMissile() {
  const angle = player.facingAngle;
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

function updateProjectiles(scene, delta) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * delta / 1000;
    p.y += p.vy * delta / 1000;
    p.life -= delta;
    
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
    if ((p.type === 'laser' || p.type === 'blueLaser') && (p.x < 0 || p.x > 800 || p.y < 0 || p.y > 600 || p.life <= 0)) {
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
        
        if (p.type === 'laser' || p.type === 'blueLaser') {
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
      color: 0xffaa00
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
      color: 0xff0000
    });
  }
}

// ============================================================================
// PARTICLE & VISUAL EFFECTS
// ============================================================================

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
  
  let speedMult = 1 + (waveLevel - 1) * 0.15;
  
  // Exponential speed increase at level 20+
  if (level >= 20) {
    const levelPast20 = level - 20;
    speedMult *= 1 + (levelPast20 * 0.12); // +12% speed per level past 20
  }
  
  bananas.push({
    x: x,
    y: y,
    size: 16,
    hitboxSize: 6,
    speed: (30 + Math.random() * 20) * speedMult,
    hp: 10 + waveLevel * 2,
    maxHp: 10 + waveLevel * 2,
    sprite: null,
    isBoss: false
  });
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
  }
}

function killBanana(scene, index) {
  const b = bananas[index];
  const scoreValue = b.isBoss ? 100 : 10;
  score += scoreValue;
  scoreText.setText(score.toString());
  
  // Destroy sprite if it exists
  if (b.sprite) {
    b.sprite.destroy();
  }
  
  // Create death explosion sparks (more for boss)
  createSparks(b.x, b.y, b.isBoss ? 20 : 8);
  
  // Drop more gems for boss
  const gemCount = b.isBoss ? 10 : 1;
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

function updateGems(scene) {
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Magnet effect
    if (dist < 100) {
      const len = Math.max(dist, 1);
      g.x += (dx / len) * 200 * 0.016;
      g.y += (dy / len) * 200 * 0.016;
    }
    
    // Collect
    if (dist < player.size + 5) {
      xp += g.value;
      gems.splice(i, 1);
      
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
  
  // Unlock missile at level 5
  if (level === 5) {
    weapons.missile.active = true;
    weapons.missile.level = 1;
  } else if (level === 10) {
    // Unlock blue laser at level 10
    weapons.blueLaser.active = true;
    weapons.blueLaser.level = 1;
  } else {
    // Random upgrade for other levels
    const upgrades = [];
    if (weapons.laser.level < 10) upgrades.push('laser+');
    if (weapons.missile.active && weapons.missile.level < 10) upgrades.push('missile+');
    if (weapons.blueLaser.active && weapons.blueLaser.level < 10) upgrades.push('blueLaser+');
    
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
    weapons.laser.rate = Math.max(300, weapons.laser.rate - 100);
  } else if (upgrade === 'missile+') {
    weapons.missile.level++;
    weapons.missile.damage += 10;
    weapons.missile.explosionRadius += 10;
    weapons.missile.rate = Math.max(1500, weapons.missile.rate - 200);
  } else if (upgrade === 'blueLaser+') {
    weapons.blueLaser.level++;
    weapons.blueLaser.damage += 5;
    weapons.blueLaser.rate = Math.max(300, weapons.blueLaser.rate - 80);
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
  
  // Draw play area border (darker)
  graphics.lineStyle(2, 0x00ffff, 0.3);
  graphics.strokeRect(0, 0, 800, 600);
  
  // Draw grid (subtle)
  graphics.lineStyle(1, 0x00ffff, 0.05);
  for (let x = 0; x <= 800; x += 50) {
    graphics.lineBetween(x, 0, x, 600);
  }
  for (let y = 0; y <= 600; y += 50) {
    graphics.lineBetween(0, y, 800, y);
  }
  
  // Draw player (cat face)
  const px = player.x;
  const py = player.y;
  
  // Cat head (circle)
  graphics.fillStyle(0xff9933, 1);
  graphics.fillCircle(px, py, player.size);
  
  // Left ear (triangle)
  graphics.fillStyle(0xff9933, 1);
  graphics.fillTriangle(
    px - 10, py - 10,
    px - 16, py - 20,
    px - 4, py - 16
  );
  
  // Right ear (triangle)
  graphics.fillTriangle(
    px + 10, py - 10,
    px + 16, py - 20,
    px + 4, py - 16
  );
  
  // Inner ears (pink)
  graphics.fillStyle(0xff66aa, 1);
  graphics.fillTriangle(
    px - 10, py - 10,
    px - 13, py - 16,
    px - 7, py - 14
  );
  graphics.fillTriangle(
    px + 10, py - 10,
    px + 13, py - 16,
    px + 7, py - 14
  );
  
  // Left eye (white)
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(px - 6, py - 3, 4);
  
  // Right eye (white)
  graphics.fillCircle(px + 6, py - 3, 4);
  
  // Left pupil (black)
  graphics.fillStyle(0x000000, 1);
  graphics.fillCircle(px - 6, py - 2, 2);
  
  // Right pupil (black)
  graphics.fillCircle(px + 6, py - 2, 2);
  
  // Nose (pink triangle)
  graphics.fillStyle(0xff66aa, 1);
  graphics.fillTriangle(
    px, py + 2,
    px - 2, py + 5,
    px + 2, py + 5
  );
  
  // Mouth (two curves)
  graphics.lineStyle(2, 0x000000, 1);
  graphics.beginPath();
  graphics.arc(px - 3, py + 5, 4, 0, Math.PI, false);
  graphics.strokePath();
  
  graphics.beginPath();
  graphics.arc(px + 3, py + 5, 4, 0, Math.PI, false);
  graphics.strokePath();
  
  // Whiskers (left side)
  graphics.lineStyle(1, 0x000000, 0.8);
  graphics.lineBetween(px - 16, py, px - 8, py - 1);
  graphics.lineBetween(px - 16, py + 3, px - 8, py + 2);
  graphics.lineBetween(px - 16, py + 6, px - 8, py + 5);
  
  // Whiskers (right side)
  graphics.lineBetween(px + 16, py, px + 8, py - 1);
  graphics.lineBetween(px + 16, py + 3, px + 8, py + 2);
  graphics.lineBetween(px + 16, py + 6, px + 8, py + 5);
  
  // Draw explosions
  for (let e of explosions) {
    const alpha = e.life / e.maxLife;
    // Outer ring (orange)
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
    } else if (p.type === 'blueLaser') {
      graphics.fillStyle(0x00aaff, 1);
      graphics.fillRect(p.x - 3, p.y - 3, 6, 6);
      // Blue glow
      graphics.fillStyle(0x00aaff, 0.3);
      graphics.fillRect(p.x - 5, p.y - 5, 10, 10);
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
    graphics.fillStyle(0xF9BC13, 1);
    graphics.fillCircle(g.x, g.y, 4);
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

  // Update XP bar
  xpBar.clear();
  const xpInLevel = xp % 10; // Current XP progress within the level (0-9)
  const xpPercent = xpInLevel / 10; // Convert to 0.0-1.0
  const xpWidth = 200 * xpPercent;
  
  // Glow effect
  xpBar.fillStyle(0xF9BC13, 0.3);
  xpBar.fillRect(18, 581, xpWidth + 4, 14);
  
  // Main bar
  xpBar.fillStyle(0xF9BC13, 1);
  xpBar.fillRect(20, 583, xpWidth, 10);
  
  // Bright edge
  if (xpWidth > 0) {
    xpBar.fillStyle(0xFCD470, 1);
    xpBar.fillRect(20, 583, xpWidth, 2);
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

function endGame(scene) {
  gameOver = true;
  
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.8);
  overlay.fillRect(0, 0, 800, 600);
  
  // ASCII "GAME OVER"
  scene.add.text(400, 180, 
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
  
  scene.add.text(400, 340, 'SCORE: ' + score, {
    fontSize: '32px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5);
  
  const mins = Math.floor(gameDuration / 60000);
  const secs = Math.floor((gameDuration % 60000) / 1000);
  scene.add.text(400, 390, 'TIME: ' + mins + ':' + (secs < 10 ? '0' : '') + secs, {
    fontSize: '24px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff'
  }).setOrigin(0.5);
  
  // Restart button
  const restartBtn = scene.add.text(400, 480, 'RESTART', {
    fontSize: '32px',
    fontFamily: 'Consolas, monospace',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  
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
  
  // Restart on any key (except movement keys)
  scene.input.keyboard.once('keydown', (event) => {
    const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];
    if (!movementKeys.includes(event.key)) {
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
  waveLevel = 1;
  miniBossSpawned = false;
  
  weapons.laser.active = true;
  weapons.laser.level = 1;
  weapons.laser.damage = 15;
  weapons.laser.cooldown = 0;
  weapons.laser.rate = 1000;
  
  weapons.missile.active = false;
  weapons.missile.level = 0;
  weapons.missile.damage = 30;
  weapons.missile.cooldown = 0;
  weapons.missile.rate = 3000;
  weapons.missile.explosionRadius = 50;
  
  weapons.blueLaser.active = false;
  weapons.blueLaser.level = 0;
  weapons.blueLaser.damage = 20;
  weapons.blueLaser.cooldown = 0;
  weapons.blueLaser.rate = 800;
}

// ============================================================================
// AUDIO SYSTEMS
// ============================================================================

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

function playMeow(scene) {
  const audioContext = scene.sound.context;
  const now = audioContext.currentTime;
  
  // Create oscillator for meow sound
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Happy meow - starts high, dips, then goes back up
  oscillator.frequency.setValueAtTime(900, now);
  oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.08);
  oscillator.frequency.exponentialRampToValueAtTime(750, now + 0.15);
  
  oscillator.type = 'sine';
  
  // Volume envelope - snappier and brighter
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.2, now + 0.01);
  gainNode.gain.linearRampToValueAtTime(0.15, now + 0.08);
  gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
  
  oscillator.start(now);
  oscillator.stop(now + 0.18);
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
