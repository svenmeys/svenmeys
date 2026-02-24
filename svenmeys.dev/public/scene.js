(() => {
  'use strict';

  // ── Config ────────────────────────────────
  const RED = '#ff2222';
  const RED_DIM = 'rgba(255, 34, 34, 0.3)';
  const FOV = 500;
  const SCALE = 80;
  const MOBILE = window.innerWidth < 768;
  const BOUNDS = 8;
  const WRAP_XZ = BOUNDS + 2;

  let mouseX = -1, mouseY = -1, mouseHeld = false, fireQueued = false;
  window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -1; mouseY = -1; mouseHeld = false; });
  window.addEventListener('mousedown', e => {
    if (!e.target.closest('main')) { fireQueued = true; mouseHeld = true; }
  });
  window.addEventListener('mouseup', () => { mouseHeld = false; });

  // ── Math ──────────────────────────────────
  const project = (x, y, z, cx, cy) => {
    const s = FOV / (z + FOV + 4);
    return [x * s + cx, y * s + cy, s];
  };

  const rotY = (x, y, z, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [x * c - z * s, y, x * s + z * c];
  };

  const rotX = (x, y, z, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
  };

  // World → screen (rotate + project)
  const w2s = (x, y, z, ay, ax, cx, cy) => {
    const [rx, ry, rz] = rotX(...rotY(x * SCALE, y * SCALE, z * SCALE, ay), ax);
    return project(rx, ry, rz, cx, cy);
  };

  // Screen direction → local 3D direction (inverse rotation)
  const s2l = (sdx, sdy, ay, ax) => {
    const cay = Math.cos(ay), say = Math.sin(ay);
    const cax = Math.cos(ax), sax = Math.sin(ax);
    return [
      sdx * cay - sdy * sax * say,
      sdy * cax,
      -sdx * say - sdy * sax * cay,
    ];
  };

  const wrapAngle = d => {
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  const wrapBounds = (o, yB) => {
    if (o.x > WRAP_XZ) o.x = -WRAP_XZ; if (o.x < -WRAP_XZ) o.x = WRAP_XZ;
    if (o.z > WRAP_XZ) o.z = -WRAP_XZ; if (o.z < -WRAP_XZ) o.z = WRAP_XZ;
    if (o.y > yB) o.y = -yB; if (o.y < -yB) o.y = yB;
  };

  // Depth-forgiving hit test (flattens camera-depth difference)
  const depthHit = (bx, by, bz, tx, ty, tz, tr, ddx, ddy, ddz) => {
    const dx = bx - tx, dy = by - ty, dz = bz - tz;
    const depth = dx * ddx + dy * ddy + dz * ddz;
    const plane = Math.sqrt(dx * dx + dy * dy + dz * dz - depth * depth);
    return plane < tr * 2 && Math.abs(depth) < 2;
  };

  // ── Wireframe Figure ──────────────────────
  function buildFigure() {
    const v = [];
    const e = [];

    const box = (cx, cy, cz, w, h, d) => {
      const s = v.length;
      for (let i = 0; i < 8; i++)
        v.push([cx + (i & 1 ? w : -w), cy + (i & 2 ? h : -h), cz + (i & 4 ? d : -d)]);
      e.push(
        [s, s+1], [s+2, s+3], [s+4, s+5], [s+6, s+7],
        [s, s+2], [s+1, s+3], [s+4, s+6], [s+5, s+7],
        [s, s+4], [s+1, s+5], [s+2, s+6], [s+3, s+7],
      );
    };

    const line = (a, b) => { const s = v.length; v.push(a, b); e.push([s, s + 1]); };

    box(0, -1.9, 0, 0.28, 0.22, 0.22);          // Head
    line([-0.14, -1.94, 0.23], [-0.04, -1.94, 0.23]); // Eyes
    line([0.04, -1.94, 0.23], [0.14, -1.94, 0.23]);
    line([0, -2.12, 0], [0, -2.35, 0]);          // Antenna
    line([-0.08, -2.35, 0], [0.08, -2.35, 0]);
    line([0, -1.68, 0], [0, -1.4, 0]);           // Neck
    line([-0.6, -1.3, 0], [0.6, -1.3, 0]);       // Shoulders
    box(0, -0.55, 0, 0.45, 0.7, 0.22);           // Torso
    line([0, -0.9, 0.23], [-0.12, -0.55, 0.23]);  // Chest diamond
    line([-0.12, -0.55, 0.23], [0, -0.2, 0.23]);
    line([0, -0.2, 0.23], [0.12, -0.55, 0.23]);
    line([0.12, -0.55, 0.23], [0, -0.9, 0.23]);
    line([-0.6, -1.3, 0], [-0.85, -0.6, 0.1]);   // Arms
    line([-0.85, -0.6, 0.1], [-0.75, 0.05, -0.05]);
    line([0.6, -1.3, 0], [0.85, -0.6, -0.1]);
    line([0.85, -0.6, -0.1], [0.75, 0.05, 0.05]);
    line([-0.22, 0.15, 0], [-0.3, 0.85, 0.08]);   // Legs
    line([-0.3, 0.85, 0.08], [-0.35, 1.55, 0]);
    line([0.22, 0.15, 0], [0.3, 0.85, -0.08]);
    line([0.3, 0.85, -0.08], [0.35, 1.55, 0]);

    return { v, e };
  }

  // ── Arm Animation ─────────────────────────
  // Right arm vertex indices (from buildFigure vertex order)
  const ARM_ELBOW_A = 41, ARM_ELBOW_B = 42, ARM_HAND = 43;
  const ARM_POSES = {
    rest:   { elbow: [0.85, -0.6, -0.1],  hand: [0.75, 0.05, 0.05] },
    chest:  { elbow: [0.35, -0.85, 0.15], hand: [0.1, -0.55, 0.25] },
    extend: { elbow: [0.8, -1.0, 0.35],   hand: [1.2, -0.7, 0.5]   },
  };
  // Phase: reach(0→0.5) grab(0.5→0.8) pull(0.8→1.5) hold(1.5→1.7) return(1.7→2.2)
  const SPAWN_PHASES = [
    { end: 0.5, from: 'rest',   to: 'chest'  },
    { end: 0.8, from: 'chest',  to: 'chest'  },
    { end: 1.5, from: 'chest',  to: 'extend' },
    { end: 1.7, from: 'extend', to: 'extend' },
    { end: 2.2, from: 'extend', to: 'rest'   },
  ];
  const lerp3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  const ease = t => t * t * (3 - 2 * t);

  function getSpawnArmPose(timer) {
    let prevEnd = 0;
    for (let i = 0; i < SPAWN_PHASES.length; i++) {
      const p = SPAWN_PHASES[i];
      if (timer < p.end) {
        const t = ease((timer - prevEnd) / (p.end - prevEnd));
        return {
          phase: i,
          elbow: lerp3(ARM_POSES[p.from].elbow, ARM_POSES[p.to].elbow, t),
          hand: lerp3(ARM_POSES[p.from].hand, ARM_POSES[p.to].hand, t),
        };
      }
      prevEnd = p.end;
    }
    return null;
  }

  // ── Asteroid Models ───────────────────────
  const ROID_MODELS = [
    { outline: [[1,0],[.6,.8],[-.3,.9],[-1,.3],[-.8,-.5],[-.2,-1],[.5,-.7]],
      detail: [[-.3,.9],[.1,0],[.5,-.7]] },
    { outline: [[.9,.2],[.3,1],[-.7,.8],[-1,0],[-.5,-.9],[.4,-1],[1,-.3]],
      detail: [[-1,0],[0,.1],[1,-.3]] },
    { outline: [[1,.1],[.7,.7],[0,1],[-.8,.6],[-1,-.1],[-.6,-.8],[.1,-1],[.8,-.5]],
      detail: [[-.8,.6],[0,0],[.8,-.5],[0,0],[0,1],[0,0],[.1,-1]] },
    { outline: [[1.1,0],[.5,.6],[-.4,.8],[-1.1,.2],[-1,-.4],[-.2,-.7],[.6,-.5]],
      detail: [[-1.1,.2],[-.1,-.1],[.6,-.5]] },
    { outline: [[.8,.3],[.2,1.1],[-.6,.7],[-1,0],[-.7,-.8],[.1,-1.1],[.7,-.4]],
      detail: [[.2,1.1],[0,0],[.1,-1.1]] },
  ];

  // ── Game (3D) ─────────────────────────────
  function spawnRoid(size) {
    const r = size || (0.4 + Math.random() * 0.35);
    const model = ROID_MODELS[(Math.random() * ROID_MODELS.length) | 0];
    const ang = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 5;
    return {
      x: Math.cos(ang) * dist,
      y: (Math.random() - 0.5) * 4,
      z: Math.sin(ang) * dist,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.3,
      vz: (Math.random() - 0.5) * 0.8,
      r, model,
      spin: Math.random() * Math.PI * 2,
      spinRate: (Math.random() - 0.5) * 2,
    };
  }

  function spawnCardRoid(el) {
    const name = el.querySelector('strong')?.textContent || '???';
    el.classList.add('card--abducted');
    const ang = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 3;
    return {
      x: Math.cos(ang) * dist,
      y: (Math.random() - 0.5) * 2,
      z: Math.sin(ang) * dist,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.15,
      vz: (Math.random() - 0.5) * 0.3,
      r: 0.7,
      spin: 0,
      spinRate: (Math.random() - 0.5) * 0.8,
      name,
      el,
    };
  }

  function createGame() {
    return {
      ship: { x: 0, y: 0, z: 3, angle: 0, vx: 0, vy: 0, vz: 0 },
      roids: Array.from({ length: 6 }, () => spawnRoid()),
      bullets: [],
      cd: 0,
      kills: 0,
      shots: 0,
      cardRoids: [],
      ghostRobots: [],
      cardsAbducted: false,
    };
  }

  function tickGame(g, dt, t, ay, ax, cx, cy) {
    const s = g.ship;
    g.cd -= dt;

    if (mouseX >= 0 && !g.dead) {
      // Follow cursor — project ship, compute screen delta, un-rotate to local thrust
      const [sx, sy] = w2s(s.x, s.y, s.z, ay, ax, cx, cy);
      const dx = mouseX - sx, dy = mouseY - sy;
      const dist = Math.hypot(dx, dy);

      if (dist > 3) {
        const [lx, ly, lz] = s2l(dx / dist, dy / dist, ay, ax);
        const thrust = Math.min(dist * 0.0012, 1.5);
        s.vx += lx * thrust * 60 * dt;
        s.vy += ly * thrust * 60 * dt;
        s.vz += lz * thrust * 60 * dt;
      }

      // Rotate to face cursor (screen space)
      const d = wrapAngle(Math.atan2(dy, dx) - s.angle);
      s.angle += Math.sign(d) * Math.min(Math.abs(d), 8 * dt);
    } else if (!g.dead) {
      // Autonomous: gentle orbit + aim at nearest asteroid
      s.vx += Math.sin(t * 0.5) * 0.3 * dt;
      s.vz += Math.cos(t * 0.5) * 0.3 * dt;

      let near = null, nd = Infinity;
      for (const r of g.roids) {
        const d = Math.hypot(r.x - s.x, r.y - s.y, r.z - s.z);
        if (d < nd) { nd = d; near = r; }
      }
      if (near) {
        const [nx, ny] = w2s(near.x, near.y, near.z, ay, ax, cx, cy);
        const [sx, sy] = w2s(s.x, s.y, s.z, ay, ax, cx, cy);
        const d = wrapAngle(Math.atan2(ny - sy, nx - sx) - s.angle);
        s.angle += Math.sign(d) * Math.min(Math.abs(d), 3 * dt);

        if (g.cd <= 0 && nd < 6 && Math.abs(d) < 0.3) {
          const [fx, fy, fz] = s2l(Math.cos(s.angle), Math.sin(s.angle), ay, ax);
          g.bullets.push({ x: s.x, y: s.y, z: s.z, vx: fx * 6, vy: fy * 6, vz: fz * 6, life: 2 });
          g.cd = 0.2;
        }
      }
    }

    // Fire — single click or hold to auto-fire (not while dead)
    if (g.dead) {
      fireQueued = false;
    } else if (fireQueued || (mouseHeld && g.cd <= 0)) {
      const [fx, fy, fz] = s2l(Math.cos(s.angle), Math.sin(s.angle), ay, ax);
      g.bullets.push({ x: s.x, y: s.y, z: s.z, vx: fx * 7, vy: fy * 7, vz: fz * 7, life: 2.5 });
      g.shots++;
      g.cd = 0.15;
      fireQueued = false;
    }

    // Camera depth axis (used for hit tests + depth constraint)
    const cay2 = Math.cos(ay), say2 = Math.sin(ay);
    const cax2 = Math.cos(ax);
    const ddx = cax2 * say2, ddy = Math.sin(ax), ddz = cax2 * cay2;

    // Ship physics (skip during respawn fly-in — depth constraint fights convergence)
    if (!g.respawning) {
      s.vx *= 0.95; s.vy *= 0.95; s.vz *= 0.95;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;

      // Soft bounds — rubber-band back toward center
      const sd = Math.hypot(s.x, s.y, s.z);
      if (sd > BOUNDS) {
        const pull = (sd - BOUNDS) * 0.5 * dt;
        s.vx -= (s.x / sd) * pull; s.vy -= (s.y / sd) * pull; s.vz -= (s.z / sd) * pull;
      }

      // Constrain ship to camera-facing plane (no depth drift)
      const vDepth = s.vx * ddx + s.vy * ddy + s.vz * ddz;
      s.vx -= ddx * vDepth; s.vy -= ddy * vDepth; s.vz -= ddz * vDepth;
      const depthErr = s.x * ddx + s.y * ddy + s.z * ddz - 3;
      s.x -= ddx * depthErr * 0.3;
      s.y -= ddy * depthErr * 0.3;
      s.z -= ddz * depthErr * 0.3;
    }

    // All targetable entities
    const allTargets = [...g.roids, ...g.cardRoids, ...g.ghostRobots];

    // Bracketed target — nearest on same camera depth plane as ship
    const shipDepth = s.x * ddx + s.y * ddy + s.z * ddz;
    let bracketTarget = null, bracketDist = Infinity;
    for (const r of allTargets) {
      const roidDepth = r.x * ddx + r.y * ddy + r.z * ddz;
      if (Math.abs(roidDepth - shipDepth) > 2) continue;
      const d = Math.hypot(r.x - s.x, r.y - s.y, r.z - s.z);
      if (d < bracketDist) { bracketDist = d; bracketTarget = r; }
    }
    if (bracketDist >= 8) bracketTarget = null;
    g.bracketTarget = bracketTarget;

    // Bullets — homing + physics
    for (const b of g.bullets) {
      let near = null, nd = Infinity;
      for (const r of allTargets) {
        const d = Math.hypot(r.x - b.x, r.y - b.y, r.z - b.z);
        if (d < nd) { nd = d; near = r; }
      }
      if (near && nd < 10) {
        const str = 1.5 * (1 - nd / 10);
        b.vx += ((near.x - b.x) / nd) * str * dt;
        b.vy += ((near.y - b.y) / nd) * str * dt;
        b.vz += ((near.z - b.z) / nd) * str * dt;
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
    }
    g.bullets = g.bullets.filter(b => b.life > 0);

    // Asteroid physics
    for (const r of g.roids) {
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      r.spin += r.spinRate * dt;
      wrapBounds(r, 5);
    }

    // Card roid physics
    for (const cr of g.cardRoids) {
      cr.x += cr.vx * dt; cr.y += cr.vy * dt; cr.z += cr.vz * dt;
      cr.spin += cr.spinRate * dt;
      wrapBounds(cr, 4);
    }

    // Ghost robot physics
    for (const gr of g.ghostRobots) {
      gr.x += gr.vx * dt; gr.y += gr.vy * dt; gr.z += gr.vz * dt;
      gr.vx *= 0.995; gr.vy *= 0.995; gr.vz *= 0.995;
      gr.spinY += gr.spinYRate * dt;
      gr.spinX += gr.spinXRate * dt;
      wrapBounds(gr, 5);
    }

    // Collision: bullets vs asteroids
    for (const b of g.bullets) {
      for (let i = g.roids.length - 1; i >= 0; i--) {
        const r = g.roids[i];
        if (depthHit(b.x, b.y, b.z, r.x, r.y, r.z, r.r, ddx, ddy, ddz)) {
          b.life = 0;
          g.kills++;
          if (r.r > 0.18) {
            for (let j = 0; j < 2; j++) {
              const nr = spawnRoid(r.r * 0.5);
              nr.x = r.x + (Math.random() - 0.5) * r.r;
              nr.y = r.y + (Math.random() - 0.5) * r.r;
              nr.z = r.z + (Math.random() - 0.5) * r.r;
              nr.vx = r.vx + (Math.random() - 0.5) * 2;
              nr.vy = r.vy + (Math.random() - 0.5) * 1;
              nr.vz = r.vz + (Math.random() - 0.5) * 2;
              nr.spinRate *= 2;
              g.roids.push(nr);
            }
          }
          g.roids.splice(i, 1);
          break;
        }
      }
    }

    // Collision: bullets vs card roids
    for (const b of g.bullets) {
      for (let i = g.cardRoids.length - 1; i >= 0; i--) {
        const cr = g.cardRoids[i];
        if (depthHit(b.x, b.y, b.z, cr.x, cr.y, cr.z, cr.r, ddx, ddy, ddz)) {
          b.life = 0;
          cr.el.classList.remove('card--abducted');
          cr.el.classList.add('card--returned');
          setTimeout(() => cr.el.classList.remove('card--returned'), 600);
          g.cardRoids.splice(i, 1);
          break;
        }
      }
    }

    // Collision: bullets vs ghost robots
    for (const b of g.bullets) {
      for (let i = g.ghostRobots.length - 1; i >= 0; i--) {
        const gr = g.ghostRobots[i];
        if (depthHit(b.x, b.y, b.z, gr.x, gr.y, gr.z, gr.r, ddx, ddy, ddz)) {
          b.life = 0;
          g.ghostRobots.splice(i, 1);
          g.kills++;
          break;
        }
      }
    }

    // Ship vs asteroids — death
    if (!g.dead) {
      for (const r of g.roids) {
        if (Math.hypot(r.x - s.x, r.y - s.y, r.z - s.z) < r.r + 0.3) {
          g.dead = true;
          g.deadTimer = 0;

          // Ship lines fall apart as debris (screen-space pieces)
          const [dsx, dsy, dss] = w2s(s.x, s.y, s.z, ay, ax, cx, cy);
          const sc = Math.max(dss * 1.2, 0.3);
          const pts = [[12,0],[-8,-6],[-5,0],[-8,6]];
          g.debris = [];
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            const mx = (pts[i][0] + pts[j][0]) / 2 * sc;
            const my = (pts[i][1] + pts[j][1]) / 2 * sc;
            const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
            const cx2 = mx * ca - my * sa, cy2 = mx * sa + my * ca;
            g.debris.push({
              x: dsx + cx2, y: dsy + cy2,
              x1: (pts[i][0] - (pts[i][0]+pts[j][0])/2) * sc,
              y1: (pts[i][1] - (pts[i][1]+pts[j][1])/2) * sc,
              x2: (pts[j][0] - (pts[i][0]+pts[j][0])/2) * sc,
              y2: (pts[j][1] - (pts[i][1]+pts[j][1])/2) * sc,
              vx: cx2 * 1.5 + (Math.random() - 0.5) * 40,
              vy: cy2 * 1.5 + (Math.random() - 0.5) * 40,
              angle: s.angle,
              spin: (Math.random() - 0.5) * 6,
              life: 2.5,
            });
          }

          // Ghost robot floats out at ship's 3D position
          g.ghostRobots.push({
            x: s.x, y: s.y, z: s.z,
            vx: (Math.random() - 0.5) * 0.5,
            vy: -0.15,
            vz: (Math.random() - 0.5) * 0.5,
            spinY: 0, spinYRate: 2,
            spinX: 0, spinXRate: 0.7,
            scale: 0.08,
            r: 0.3,
          });

          break;
        }
      }
    }

    // Dead state — debris + respawn
    if (g.dead) {
      g.deadTimer += dt;

      if (g.debris) {
        for (const d of g.debris) {
          d.x += d.vx * dt; d.y += d.vy * dt;
          d.vx *= 0.97; d.vy *= 0.97;
          d.angle += d.spin * dt;
          d.life -= dt;
        }
        g.debris = g.debris.filter(d => d.life > 0);
      }

      // Respawn new ship after 1.5s
      if (g.deadTimer > 1.5) {
        if (!g.respawning) {
          g.respawning = true;
          s.x = 8; s.y = 0; s.z = 3;
          s.vx = 0; s.vy = 0; s.vz = 0;
          s.angle = Math.PI;
        }
        const tx = 0, ty = 0, tz = 3;
        s.x += (tx - s.x) * 2 * dt;
        s.y += (ty - s.y) * 2 * dt;
        s.z += (tz - s.z) * 2 * dt;
        const da = wrapAngle(0 - s.angle);
        s.angle += da * 2 * dt;

        if (Math.hypot(s.x - tx, s.y - ty, s.z - tz) < 0.1) {
          g.dead = false;
          g.respawning = false;
          g.debris = null;
          s.x = tx; s.y = ty; s.z = tz;
          s.angle = 0; s.vx = 0; s.vy = 0; s.vz = 0;
          g.bullets = [];
        }
      }
    }

    // Trigger impact roid
    if (!MOBILE && !g.cardsAbducted && (g.kills >= 50 || g.shots >= 1000)) {
      g.cardsAbducted = true;
      g.impactRoid = {
        x: 5, y: -0.5, z: 0,
        vx: -0.5, vy: 0.1, vz: 2.5,
        spin: 0, spinRate: 5,
        r: 1.8,
        trail: [],
        impacted: false,
        done: false,
        age: 0,
      };
    }

    // Impact roid — gravitational arc around robot
    if (g.impactRoid && !g.impactRoid.done) {
      const ir = g.impactRoid;
      ir.age += dt;
      ir.spin += ir.spinRate * dt;

      const gDist = Math.hypot(ir.x, ir.y, ir.z);
      if (gDist > 0.3) {
        const gStr = 4 / (gDist + 0.5);
        ir.vx -= (ir.x / gDist) * gStr * dt;
        ir.vy -= (ir.y / gDist) * gStr * dt * 0.3;
        ir.vz -= (ir.z / gDist) * gStr * dt;
      }

      ir.x += ir.vx * dt;
      ir.y += ir.vy * dt;
      ir.z += ir.vz * dt;

      ir.trail.push({ x: ir.x, y: ir.y, z: ir.z });
      if (ir.trail.length > 30) ir.trail.shift();

      const [irsx, irsy] = w2s(ir.x, ir.y, ir.z, ay, ax, cx, cy);
      const panelRight = MOBILE ? window.innerWidth * 0.8 : window.innerWidth * 0.05 + 580;

      if (ir.age > 1.5 && irsx < panelRight && !ir.impacted) {
        ir.impacted = true;
        ir.done = true;

        g.explosion = { particles: [] };
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 80 + Math.random() * 250;
          g.explosion.particles.push({
            x: irsx, y: irsy,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            life: 0.5 + Math.random() * 0.8,
            r: 2 + Math.random() * 4,
          });
        }

        document.body.classList.add('shake');
        setTimeout(() => document.body.classList.remove('shake'), 500);

        const cards = document.querySelectorAll('.card:not(.card--abducted)');
        cards.forEach((el, i) => {
          setTimeout(() => {
            g.cardRoids.push(spawnCardRoid(el));
          }, i * 400);
        });
      }

      if (ir.age > 15) ir.done = true;
    }

    // Explosion particles
    if (g.explosion) {
      for (const ep of g.explosion.particles) {
        ep.x += ep.vx * dt;
        ep.y += ep.vy * dt;
        ep.vx *= 0.96;
        ep.vy *= 0.96;
        ep.life -= dt;
      }
      g.explosion.particles = g.explosion.particles.filter(ep => ep.life > 0);
      if (g.explosion.particles.length === 0) g.explosion = null;
    }

    // Asteroid replenishment — robot spawns them one at a time
    if (g.roids.length < 6 && !g.spawnAnim) {
      g.spawnAnim = { timer: 0, roid: spawnRoid(), released: false };
    }

    if (g.spawnAnim) {
      const sa = g.spawnAnim;
      sa.timer += dt;
      const pose = getSpawnArmPose(sa.timer);

      if (!pose) {
        g.spawnAnim = null;
      } else {
        sa.armPose = pose;

        // Roid visible during grab(1) and pull(2) phases — grows during pull
        if (pose.phase >= 1 && pose.phase <= 2 && !sa.released) {
          sa.roidScale = pose.phase === 1 ? 0.3 : 0.3 + 0.7 * ease((sa.timer - 0.8) / 0.7);
          sa.handPos = pose.hand;
        }

        // Release at start of hold phase (3)
        if (pose.phase >= 3 && !sa.released) {
          sa.released = true;
          const h = ARM_POSES.extend.hand;
          const roid = sa.roid;
          roid.x = h[0]; roid.y = h[1]; roid.z = h[2];
          const d = Math.hypot(h[0], h[1], h[2]);
          roid.vx = (h[0] / d) * 2 + (Math.random() - 0.5) * 0.3;
          roid.vy = (h[1] / d) * 0.5;
          roid.vz = (h[2] / d) * 2 + (Math.random() - 0.5) * 0.3;
          g.roids.push(roid);
          sa.handPos = null;
        }
      }
    }
  }

  // ── Drawing ─────────────────────────────────

  // Unified wireframe renderer — draws fig at world position with local rotation
  // opts.alpha: number = flat alpha, null/undefined = depth-based alpha
  function drawWireframe(ctx, fig, ay, ax, cx, cy, opts) {
    const { x: ox = 0, y: oy = 0, z: oz = 0,
            spinY = 0, spinX = 0, scale = 1,
            alpha = null, shadowBlur = 12, lineWidth = 1.5,
            overrides = null } = opts || {};

    const csY = Math.cos(spinY), ssY = Math.sin(spinY);
    const csX = Math.cos(spinX), ssX = Math.sin(spinX);

    ctx.strokeStyle = RED;
    ctx.shadowColor = RED;
    ctx.shadowBlur = shadowBlur;
    ctx.lineWidth = lineWidth;

    for (const [i, j] of fig.e) {
      let [v1x, v1y, v1z] = overrides?.[i] || fig.v[i];
      let [v2x, v2y, v2z] = overrides?.[j] || fig.v[j];
      v1x *= scale; v1y *= scale; v1z *= scale;
      v2x *= scale; v2y *= scale; v2z *= scale;

      // Local rotation (Y then X)
      let r1x = v1x * csY - v1z * ssY, r1z = v1x * ssY + v1z * csY;
      let r2x = v2x * csY - v2z * ssY, r2z = v2x * ssY + v2z * csY;
      let r1y = v1y * csX - r1z * ssX; r1z = v1y * ssX + r1z * csX;
      let r2y = v2y * csX - r2z * ssX; r2z = v2y * ssX + r2z * csX;

      const [px1, py1, ps1] = w2s(ox + r1x, oy + r1y, oz + r1z, ay, ax, cx, cy);
      const [px2, py2, ps2] = w2s(ox + r2x, oy + r2y, oz + r2z, ay, ax, cx, cy);

      if (ps1 > 0 && ps2 > 0) {
        ctx.globalAlpha = alpha !== null ? alpha : (ps1 + ps2) * 0.4 + 0.2;
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;
  }

  function drawGame(ctx, g, ay, ax, cx, cy, fig) {
    // Impact roid — drawn first (behind other objects)
    if (g.impactRoid && !g.impactRoid.done) {
      const ir = g.impactRoid;

      // Trail
      for (let i = 0; i < ir.trail.length; i++) {
        const tp = ir.trail[i];
        const [tx, ty, ts] = w2s(tp.x, tp.y, tp.z, ay, ax, cx, cy);
        if (ts > 0) {
          const fade = i / ir.trail.length;
          ctx.globalAlpha = fade * 0.4 * Math.min(ts + 0.3, 1);
          ctx.fillStyle = '#88ddff';
          ctx.beginPath();
          ctx.arc(tx, ty, Math.max(1, ir.r * SCALE * ts * fade * 0.3), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Main body — white with cyan glow
      const [irx, iry, irs] = w2s(ir.x, ir.y, ir.z, ay, ax, cx, cy);
      if (irs > 0) {
        const screenR = ir.r * SCALE * irs;
        const outline = [
          [1.1, 0.1], [0.7, 0.7], [0.2, 1.0], [-0.4, 0.8], [-0.9, 0.9],
          [-1.2, 0.2], [-1.0, -0.5], [-0.4, -1.0], [0.2, -0.8], [0.8, -0.6],
        ];

        ctx.save();
        ctx.translate(irx, iry);
        ctx.rotate(ir.spin);

        ctx.shadowColor = '#88ddff';
        ctx.shadowBlur = 25;
        ctx.globalAlpha = 0.9 * Math.min(irs + 0.3, 1);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, 3 * irs);
        ctx.beginPath();
        for (let i = 0; i < outline.length; i++) {
          const px = outline[i][0] * screenR, py = outline[i][1] * screenR;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();

        // Inner crack lines — cyan
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#88ddff';
        ctx.lineWidth = Math.max(1, 1.5 * irs);
        ctx.beginPath();
        ctx.moveTo(-0.9 * screenR, 0.9 * screenR);
        ctx.lineTo(0, 0);
        ctx.lineTo(0.8 * screenR, -0.6 * screenR);
        ctx.moveTo(0, 0);
        ctx.lineTo(0.2 * screenR, 1.0 * screenR);
        ctx.stroke();

        ctx.restore();
      }
    }

    // Explosion particles
    if (g.explosion) {
      for (const ep of g.explosion.particles) {
        const alpha = Math.min(ep.life, 1);
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = ep.life > 0.4 ? '#ffffff' : '#88ddff';
        ctx.shadowColor = '#88ddff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.r * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    // Debris — ship lines falling apart
    if (g.debris) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1.5;
      for (const d of g.debris) {
        ctx.globalAlpha = Math.min(d.life, 1) * 0.7;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle);
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Ghost robots — same wireframe model as center figure
    for (const gr of g.ghostRobots) {
      drawWireframe(ctx, fig, ay, ax, cx, cy, {
        x: gr.x, y: gr.y, z: gr.z,
        spinY: gr.spinY, spinX: gr.spinX,
        scale: gr.scale, alpha: 0.85,
        shadowBlur: 6, lineWidth: 1,
      });
    }

    const s = g.ship;

    // Ship (hidden while dead, visible during respawn fly-in)
    const [sx, sy, ss] = w2s(s.x, s.y, s.z, ay, ax, cx, cy);
    if (ss > 0 && (!g.dead || g.respawning)) {
      const sc = Math.max(ss * 1.2, 0.3);
      ctx.globalAlpha = 0.6 * Math.min(ss + 0.3, 1);
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1.5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(s.angle);
      ctx.scale(sc, sc);
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-8, -6); ctx.lineTo(-5, 0); ctx.lineTo(-8, 6);
      ctx.closePath();
      ctx.stroke();
      if (Math.random() > 0.3) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(-10 - Math.random() * 8, -3);
        ctx.lineTo(-10 - Math.random() * 8, 3);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Bullets
    ctx.fillStyle = RED;
    for (const b of g.bullets) {
      const [bx, by, bs] = w2s(b.x, b.y, b.z, ay, ax, cx, cy);
      if (bs > 0) {
        ctx.globalAlpha = 0.7 * Math.min(b.life, 1) * Math.min(bs + 0.3, 1);
        ctx.beginPath();
        ctx.arc(bx, by, Math.max(1.5, 3 * bs), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Asteroids
    for (const r of g.roids) {
      const [rx, ry, rs] = w2s(r.x, r.y, r.z, ay, ax, cx, cy);
      if (rs <= 0) continue;
      const screenR = r.r * SCALE * rs;
      if (screenR < 2) continue;

      const m = r.model;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(r.spin);

      ctx.globalAlpha = 0.5 * Math.min(rs + 0.3, 1);
      ctx.strokeStyle = RED;
      ctx.lineWidth = Math.max(1, 1.5 * rs);
      ctx.beginPath();
      for (let i = 0; i < m.outline.length; i++) {
        const px = m.outline[i][0] * screenR, py = m.outline[i][1] * screenR;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.globalAlpha = 0.25 * Math.min(rs + 0.3, 1);
      ctx.strokeStyle = RED_DIM;
      ctx.lineWidth = Math.max(0.5, rs);
      ctx.beginPath();
      for (let i = 0; i < m.detail.length; i++) {
        const px = m.detail[i][0] * screenR, py = m.detail[i][1] * screenR;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.restore();
    }

    // Targeting brackets
    const nearR = g.bracketTarget;
    if (nearR) {
      const [tx, ty, ts] = w2s(nearR.x, nearR.y, nearR.z, ay, ax, cx, cy);
      if (ts > 0) {
        const tr = nearR.r * SCALE * ts * 1.6;
        const bk = Math.max(4, tr * 0.25);
        const pulse = 0.3 + Math.sin(Date.now() * 0.006) * 0.12;
        ctx.strokeStyle = RED;
        ctx.lineWidth = Math.max(1, 1.5 * ts);
        ctx.globalAlpha = pulse * Math.min(ts + 0.3, 1);
        ctx.beginPath();
        ctx.moveTo(tx - tr, ty - tr + bk); ctx.lineTo(tx - tr, ty - tr); ctx.lineTo(tx - tr + bk, ty - tr);
        ctx.moveTo(tx + tr - bk, ty - tr); ctx.lineTo(tx + tr, ty - tr); ctx.lineTo(tx + tr, ty - tr + bk);
        ctx.moveTo(tx + tr, ty + tr - bk); ctx.lineTo(tx + tr, ty + tr); ctx.lineTo(tx + tr - bk, ty + tr);
        ctx.moveTo(tx - tr + bk, ty + tr); ctx.lineTo(tx - tr, ty + tr); ctx.lineTo(tx - tr, ty + tr - bk);
        ctx.stroke();
      }
    }

    // Card roids
    for (const cr of g.cardRoids) {
      const [rx, ry, rs] = w2s(cr.x, cr.y, cr.z, ay, ax, cx, cy);
      if (rs <= 0) continue;

      const w = cr.r * SCALE * rs * 2.2;
      const h = cr.r * SCALE * rs * 0.9;

      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(cr.spin * 0.3);

      ctx.globalAlpha = 0.7 * Math.min(rs + 0.3, 1);
      ctx.strokeStyle = RED;
      ctx.lineWidth = Math.max(1, 2 * rs);
      ctx.strokeRect(-w / 2, -h / 2, w, h);

      const c = Math.min(w, h) * 0.2;
      ctx.lineWidth = Math.max(1.5, 2.5 * rs);
      ctx.beginPath();
      ctx.moveTo(-w/2, -h/2 + c); ctx.lineTo(-w/2, -h/2); ctx.lineTo(-w/2 + c, -h/2);
      ctx.moveTo(w/2 - c, -h/2); ctx.lineTo(w/2, -h/2); ctx.lineTo(w/2, -h/2 + c);
      ctx.moveTo(w/2, h/2 - c); ctx.lineTo(w/2, h/2); ctx.lineTo(w/2 - c, h/2);
      ctx.moveTo(-w/2 + c, h/2); ctx.lineTo(-w/2, h/2); ctx.lineTo(-w/2, h/2 - c);
      ctx.stroke();

      const fontSize = Math.max(6, w * 0.14);
      ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = RED;
      ctx.globalAlpha = 0.9 * Math.min(rs + 0.3, 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cr.name, 0, 0);

      ctx.restore();
    }
  }

  // ── Particles ─────────────────────────────
  function createParticles(n) {
    return Array.from({ length: n }, () => ({
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 6,
      z: Math.random() * 8,
      speed: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function drawParticles(ctx, parts, t, ay, ax, cx, cy) {
    ctx.fillStyle = RED;
    for (const p of parts) {
      const y = p.y + Math.sin(t * p.speed + p.phase) * 0.4;
      const [sx, sy, ss] = w2s(p.x, y, p.z, ay, ax, cx, cy);
      ctx.globalAlpha = ss * 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.5, ss * 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Grid Floor ────────────────────────────
  function drawGrid(ctx, ay, ax, cx, cy) {
    ctx.strokeStyle = RED_DIM;
    ctx.lineWidth = 1;
    const floorY = 1.8;
    const n = 12;

    for (let z = 1; z <= n; z++) {
      const [x1, y1] = w2s(-n, floorY, z, ay, ax, cx, cy);
      const [x2, y2] = w2s(n, floorY, z, ay, ax, cx, cy);
      ctx.globalAlpha = 0.15 * (1 - z / n);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    for (let x = -n; x <= n; x += 2) {
      const [x1, y1] = w2s(x, floorY, 1, ay, ax, cx, cy);
      const [x2, y2] = w2s(x, floorY, n, ay, ax, cx, cy);
      ctx.globalAlpha = 0.08;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  // ── Effects ───────────────────────────────
  function scanlines(ctx, w, h) {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    if (Math.random() < 0.015) {
      const by = Math.random() * h | 0;
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = RED;
      ctx.fillRect(0, by, w, 2 + Math.random() * 6 | 0);
    }
  }

  function glitch(ctx, w, h) {
    if (Math.random() > 0.06) return;
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * h | 0;
      const bh = (2 + Math.random() * 20) | 0;
      const shift = ((Math.random() - 0.5) * 30) | 0;
      try { const d = ctx.getImageData(0, y, w, bh); ctx.putImageData(d, shift, y); } catch (_) {}
    }
    if (Math.random() < 0.3) {
      const y = Math.random() * h | 0;
      const bh = (5 + Math.random() * 30) | 0;
      try {
        const d = ctx.getImageData(0, y, w, bh);
        ctx.globalAlpha = 0.15;
        ctx.putImageData(d, 3, y);
      } catch (_) {}
    }
  }

  // ── Main ──────────────────────────────────
  function init() {
    const c = document.getElementById('scene');
    if (!c) return;
    const ctx = c.getContext('2d');

    const fig = buildFigure();
    const parts = createParticles(MOBILE ? 20 : 40);
    const game = createGame();
    let last = 0;

    function resize() {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    function loop(ts) {
      const t = ts / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      const w = c.width, h = c.height;
      const cx = MOBILE ? w * 0.6 : w * 0.75;
      const cy = h * 0.4;
      const ay = t * 0.3;
      const ax = Math.sin(t * 0.15) * 0.12;

      ctx.clearRect(0, 0, w, h);

      const flick = Math.random() < 0.008 ? 0.2 : Math.random() < 0.002 ? 0 : 1;
      ctx.save();
      if (flick < 1) ctx.globalAlpha = flick;

      tickGame(game, dt, t, ay, ax, cx, cy);
      drawGame(ctx, game, ay, ax, cx, cy, fig);
      drawGrid(ctx, ay, ax, cx, cy);
      drawParticles(ctx, parts, t, ay, ax, cx, cy);

      // Held asteroid (drawn behind figure)
      const sa = game.spawnAnim;
      if (sa?.handPos && !sa.released) {
        const hp = sa.handPos;
        const sr = sa.roid;
        const [rx, ry, rs] = w2s(hp[0], hp[1], hp[2], ay, ax, cx, cy);
        if (rs > 0) {
          const screenR = sr.r * sa.roidScale * SCALE * rs;
          if (screenR >= 1) {
            const m = sr.model;
            ctx.save();
            ctx.translate(rx, ry);
            ctx.rotate(sr.spin + t * 2);
            ctx.globalAlpha = 0.5 * Math.min(rs + 0.3, 1) * sa.roidScale;
            ctx.strokeStyle = RED;
            ctx.lineWidth = Math.max(1, 1.5 * rs);
            ctx.beginPath();
            for (let i = 0; i < m.outline.length; i++) {
              const px = m.outline[i][0] * screenR, py = m.outline[i][1] * screenR;
              i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Main figure (with arm animation overrides)
      const armOverrides = sa?.armPose ? {
        [ARM_ELBOW_A]: sa.armPose.elbow,
        [ARM_ELBOW_B]: sa.armPose.elbow,
        [ARM_HAND]: sa.armPose.hand,
      } : null;
      drawWireframe(ctx, fig, ay, ax, cx, cy, armOverrides ? { overrides: armOverrides } : undefined);

      ctx.restore();

      scanlines(ctx, w, h);
      glitch(ctx, w, h);

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
