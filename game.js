// Platanus Survivor - Avoid the platanos!
// A Vampire Survivors-style arcade game

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

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
  float zoom = 1.15;
  uv = (uv - 0.5) / zoom + 0.5;

  vec2 centered = uv * 2.0 - 1.0;
  float dist = dot(centered, centered);

  // Barrel distortion
  centered *= 1.0 + dist * 0.1;
  uv = centered * 0.5 + 0.5;

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

// Game state
let player;
let bananas = [];
let gems = [];
let projectiles = [];
let graphics;
let score = 0;
let xp = 0;
let level = 1;
let hp = 100;
let gameOver = false;
let gameStarted = false;
let gameDuration = 0;
let keys;

// UI elements
let scoreText;
let timeText;
let levelText;
let hpBar;
let xpBar;
let upgradeMenu;

// Weapon systems
let weapons = {
  laser: { active: false, level: 0, damage: 15, cooldown: 0, rate: 1000 },
  missile: { active: false, level: 0, damage: 30, cooldown: 0, rate: 3000, range: 150, explosionRadius: 50 }
};

// Enemy spawning
let spawnTimer = 0;
let spawnRate = 500;
let waveLevel = 1;
let particles = [];
let explosions = [];

function preload() {
  // Load banana sprite from base64
  this.textures.addBase64('banana', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACq0lEQVRYhd1WS47TQBCttrxDCJZuL2DPBdgwx+AUzBwAJksYDhD7FDlG2HCB2Q+LTpag0awLVXWV+xO3YxMZJCpK5PTvvXr1aRtEhFVt/wIBDDCKQTDvfpl4ul4d/PUngKd7MM/ehLGrQKJaHTw3GmNV1iSwL4CPWAVr29M9gMr/TwicsQr+OwL7+fFfh0Ae/9we7uDvlKHaRAKSTTYit9skbbJ9/znpYpfKXySgwG2zzcZ9R51FZqaZ/C4ogSdrjjdwQuTbS4RXH8/X/1QOuBngOq9raA+S9PmlVoq9KYTA7TZ4DniMSKLI8fF0zdvnyX9Ek3CoS9JOAZbmUE8mMYyBw+Ea3PfHQOLHHaTwcJoDJXO7WwlPl04Y7xXf9YrPbwCex0GcIhL48BXM1c+EQTULnZPtC290x2s+mNSiL8MacYKI6KPss6oagYciWk4gJkEyajhIZh7js8l17yBLTc/GQGu7gfhFBJyEgYDIWWuJBA4kYgAkRhgIMllSLWtu1VJw23RDsoXDDaB4y/lHHwI/yjziSekuIuAU3HZDHSt42/QqCmU0f9l7sTxpcxL1HHCK4fBmK+Ct7UVzP6pZr2VGMfcTfjRuVERCS76eAra2h7ZRCAzg5JWUnprSQM4JKT27BafPhR5Sl4CtFdhcctt5T0lqjvONLzXj466esZe8xytA42Mk6nyAwNN8DuCUgGOmzSacsR2OGPrHboMxuYGAkwSjH5Y26lPeI4q3ALMcoePRAyVm3IH5R/bFprdmsQyNlJHvZpJKAqAHa6MbKEjmc1/gBf4ILT/1Prf4zqnVkzidNKPVTekpHow7HcPxutzTKWBVgm9eUcToZRS6HCVaDzo+lBc1GU66D4sA/+CN6DYQaXrxNepqFwKeJTBGZAko51J5NgkuYf8Gzpt+XT54AfEAAAAASUVORK5CYII=');
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

  // Create player (nerd programmer)
  player = {
    x: 400,
    y: 300,
    size: 16,
    speed: 120,
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

  // UI setup - Geometry Wars style (right side) - HIGH DEPTH
  scoreText = this.add.text(780, 20, '0', {
    fontSize: '48px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#00ffff',
    stroke: '#000000',
    strokeThickness: 4,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  // Score label
  this.add.text(780, 5, 'SCORE', {
    fontSize: '12px',
    fontFamily: 'Courier New, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  timeText = this.add.text(780, 90, '0:00', {
    fontSize: '28px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#ffff00',
    stroke: '#000000',
    strokeThickness: 3,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);
  
  // Time label
  this.add.text(780, 75, 'TIME', {
    fontSize: '12px',
    fontFamily: 'Courier New, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  levelText = this.add.text(780, 150, 'LVL 1', {
    fontSize: '24px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#00ff00',
    stroke: '#000000',
    strokeThickness: 3,
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);
  
  // Level label
  this.add.text(780, 135, 'LEVEL', {
    fontSize: '12px',
    fontFamily: 'Courier New, monospace',
    color: '#ffffff',
    align: 'right'
  }).setOrigin(1, 0).setDepth(100);

  // HP bar (bottom left corner - Geometry Wars style) - HIGH DEPTH
  const hpBg = this.add.graphics();
  hpBg.fillStyle(0x330000, 0.8);
  hpBg.fillRect(20, 560, 204, 20);
  hpBg.setDepth(100);
  
  hpBar = this.add.graphics();
  hpBar.setDepth(101);
  
  // HP label
  this.add.text(20, 545, 'HEALTH', {
    fontSize: '12px',
    fontFamily: 'Courier New, monospace',
    color: '#ff0000'
  }).setDepth(100);

  // XP bar (below HP bar)
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
  this.add.text(400, 580, 'WASD/Arrows to Move | Survive!', {
    fontSize: '14px',
    fontFamily: 'Courier New, monospace',
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
    fontFamily: 'Courier New, monospace',
    color: '#00ffff',
    align: 'center',
    lineSpacing: -2
  }).setOrigin(0.5).setDepth(1001);
  
  const pressStart = this.add.text(400, 420, 'PRESS START', {
    fontSize: '32px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#ffff00',
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
    fontFamily: 'Courier New, monospace',
    color: '#ffffff',
    align: 'center'
  }).setOrigin(0.5).setDepth(1001);
  
  // Wait for any key press to start
  this.input.keyboard.once('keydown', () => {
    gameStarted = true;
    startOverlay.destroy();
    titleText.destroy();
    pressStart.destroy();
    controls.destroy();
    playTone(this, 440, 0.1);
  });

  playTone(this, 440, 0.1);
}

function update(time, delta) {
  if (gameOver || !gameStarted) return;

  gameDuration += delta;
  updateTimer();

  // Player movement
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
  player.x = Math.max(player.size, Math.min(800 - player.size, player.x));
  player.y = Math.max(player.size, Math.min(600 - player.size, player.y));

  // Update weapons
  updateWeapons(this, delta);

  // Spawn bananas (slower in first 45 seconds)
  spawnTimer += delta;
  const currentSpawnRate = gameDuration < 45000 ? spawnRate * 2 : spawnRate;
  if (spawnTimer >= currentSpawnRate) {
    spawnTimer = 0;
    spawnBanana();
  }

  // Update bananas
  updateBananas(delta);

  // Update projectiles
  updateProjectiles(this, delta);

  // Update particles
  updateParticles(delta);
  
  // Update explosions
  updateExplosions(delta);

  // Update gems
  updateGems(this);

  // Check collisions
  checkCollisions(this);

  // Difficulty scaling
  waveLevel = 1 + Math.floor(gameDuration / 15000);
  spawnRate = Math.max(200, 500 - waveLevel * 30);

  draw();
}

function updateWeapons(scene, delta) {
  // Laser weapon
  if (weapons.laser.active) {
    weapons.laser.cooldown -= delta;
    if (weapons.laser.cooldown <= 0) {
      weapons.laser.cooldown = weapons.laser.rate;
      fireLaser();
    }
  }
  
  // Missile weapon
  if (weapons.missile.active) {
    weapons.missile.cooldown -= delta;
    if (weapons.missile.cooldown <= 0) {
      weapons.missile.cooldown = weapons.missile.rate;
      fireMissile();
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
      vx: (dx / len) * 400,
      vy: (dy / len) * 400,
      type: 'laser',
      damage: weapons.laser.damage,
      life: 1000
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
    if (p.type === 'laser' && (p.x < 0 || p.x > 800 || p.y < 0 || p.y > 600 || p.life <= 0)) {
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
        
        if (p.type === 'laser') {
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
      size: 2 + Math.random() * 2
    });
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

function spawnBanana() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  
  if (side === 0) { x = -20; y = Math.random() * 600; }
  else if (side === 1) { x = 820; y = Math.random() * 600; }
  else if (side === 2) { x = Math.random() * 800; y = -20; }
  else { x = Math.random() * 800; y = 620; }
  
  const speedMult = 1 + (waveLevel - 1) * 0.15;
  
  bananas.push({
    x: x,
    y: y,
    size: 16,
    hitboxSize: 6,
    speed: (30 + Math.random() * 20) * speedMult,
    hp: 10 + waveLevel * 2,
    maxHp: 10 + waveLevel * 2,
    sprite: null
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
  score += 10;
  scoreText.setText(score.toString());
  
  // Destroy sprite if it exists
  if (b.sprite) {
    b.sprite.destroy();
  }
  
  // Create death explosion sparks
  createSparks(b.x, b.y, 8);
  
  // Drop gem
  gems.push({ x: b.x, y: b.y, value: 1 });
  
  bananas.splice(index, 1);
  playTone(scene, 660, 0.05);
}

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
  } else {
    // Random upgrade for other levels
    const upgrades = [];
    if (weapons.laser.level < 10) upgrades.push('laser+');
    if (weapons.missile.active && weapons.missile.level < 10) upgrades.push('missile+');
    
    if (upgrades.length > 0) {
      const choice = upgrades[Math.floor(Math.random() * upgrades.length)];
      applyUpgrade(choice);
    }
  }
  
  playTone(scene, 880, 0.2);
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
  }
}

function checkCollisions(scene) {
  for (let b of bananas) {
    const dx = player.x - b.x;
    const dy = player.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < player.size + b.hitboxSize) {
      hp -= 5;
      if (hp <= 0) {
        hp = 0;
        endGame(scene);
      }
      playTone(scene, 220, 0.1);
    }
  }
}

function draw() {
  graphics.clear();
  
  // Draw play area border (darker, Geometry Wars style)
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
  
  // Draw player (nerd with glasses)
  graphics.fillStyle(0x00ffff, 1);
  graphics.fillRect(player.x - player.size/2, player.y - player.size/2, player.size, player.size);
  graphics.fillStyle(0xffffff, 1);
  graphics.fillRect(player.x - 6, player.y - 4, 4, 4);
  graphics.fillRect(player.x + 2, player.y - 4, 4, 4);
  
  // Draw facing indicator (dot in front of player)
  const dotDist = 20;
  const dotX = player.x + Math.cos(player.facingAngle) * dotDist;
  const dotY = player.y + Math.sin(player.facingAngle) * dotDist;
  graphics.fillStyle(0x00ff00, 0.8);
  graphics.fillCircle(dotX, dotY, 3);
  
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
  
  // Draw bananas (Asteroids-style vector outline)
  for (let b of bananas) {
    // Draw banana outline as vector shape
    graphics.lineStyle(2, 0xffff00, 1);
    graphics.beginPath();
    
    // Banana shape coordinates (relative to center)
    const scale = 1.0;
    const points = [
  [-16, 7],
  [-11, 4],
  [-1, -4],
  [1, -10],
  [3, -15],
  [8, -15],
  [10, -10],
  [10, -1],
  [8, 5],
  [4, 11],
  [-2, 14],
  [-11, 15],
  [-17, 13],
  [-21, 10],
  [-19, 7],
  [-16, 7]
];
    
    // Move to first point
    graphics.moveTo(b.x + points[0][0] * scale, b.y + points[0][1] * scale);
    
    // Draw lines to each point
    for (let i = 1; i < points.length; i++) {
      graphics.lineTo(b.x + points[i][0] * scale, b.y + points[i][1] * scale);
    }
    
    graphics.strokePath();
    graphics.closePath();
    
    // Destroy sprite if it exists (we're using vectors now)
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
    graphics.fillStyle(0xffaa00, alpha);
    graphics.fillCircle(p.x, p.y, p.size);
  }
  
  // Draw gems (XP)
  for (let g of gems) {
    graphics.fillStyle(0x00ff00, 1);
    graphics.fillCircle(g.x, g.y, 4);
  }
  
  // Update HP bar (Geometry Wars style - glowing)
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
  xpBar.fillStyle(0x00ffff, 0.3);
  xpBar.fillRect(18, 581, xpWidth + 4, 14);
  
  // Main bar
  xpBar.fillStyle(0x00ffff, 1);
  xpBar.fillRect(20, 583, xpWidth, 10);
  
  // Bright edge
  if (xpWidth > 0) {
    xpBar.fillStyle(0x66ffff, 1);
    xpBar.fillRect(20, 583, xpWidth, 2);
  }
}

function updateTimer() {
  const seconds = Math.floor(gameDuration / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timeText.setText(mins + ':' + (secs < 10 ? '0' : '') + secs);
}

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
    fontFamily: 'Courier New, monospace',
    color: '#ff0000',
    align: 'center',
    lineSpacing: -2
  }).setOrigin(0.5);
  
  scene.add.text(400, 340, 'SCORE: ' + score, {
    fontSize: '32px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#00ffff',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5);
  
  const mins = Math.floor(gameDuration / 60000);
  const secs = Math.floor((gameDuration % 60000) / 1000);
  scene.add.text(400, 390, 'TIME: ' + mins + ':' + (secs < 10 ? '0' : '') + secs, {
    fontSize: '24px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#ffff00'
  }).setOrigin(0.5);
  
  // Restart button
  const restartBtn = scene.add.text(400, 480, 'RESTART', {
    fontSize: '32px',
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#00ff00',
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  
  restartBtn.on('pointerover', () => {
    restartBtn.setColor('#ffff00');
  });
  
  restartBtn.on('pointerout', () => {
    restartBtn.setColor('#00ff00');
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
  
  playTone(scene, 220, 0.5);
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
