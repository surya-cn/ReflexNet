import * as THREE from 'three';
import { TelemetryProcessor, TelemetryEvent } from './telemetry';

// Procedural circle texture generator
function createCircleTexture(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  return new THREE.CanvasTexture(canvas);
}

// Cache texture to avoid memory leaks
const cachedTargetTexture = createCircleTexture('#ffffff');

export class GameArena {
  private container: HTMLElement;
  
  // 3D Engine Setup
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private trackingTarget: THREE.Sprite | null = null;
  private pitchObject = new THREE.Object3D();
  private yawObject = new THREE.Object3D();
  
  // Grid Constants & Targets
  private readonly GRID_ROWS = 5;
  private readonly GRID_COLS = 5;
  private readonly TOTAL_CELLS = 25;
  private readonly MAX_SIMULTANEOUS_TARGETS = 1;
  private occupiedCells = new Set<number>();
  private targetMeshes: { sprite: THREE.Sprite, cellIndex: number }[] = [];
  private lastTargetIndex: number = -1;
  
  // Telemetry State
  private telemetry: TelemetryProcessor;
  private events: TelemetryEvent[] = [];
  private lastHitPosition: { x: number, y: number } | null = null;
  private isFirstTarget: boolean = true;
  
  private mode: string;
  private onDrillComplete: (data: any) => void;
  private onTargetHit: (count: number) => void;
  private onTick: (remainingMs: number) => void;
  
  private isRunning = false;
  private targetsHit = 0;
  
  // Timing Logic
  private elapsedTime = 0;
  private lastFrameTime = 0;
  private readonly DRILL_DURATION_MS = 10000; // 10 seconds for testing

  // Tracking Mode State
  private totalTrackingFrames = 0;
  private hoveredTrackingFrames = 0;
  private trackingVelocity = new THREE.Vector2();
  private nextDirectionChangeTime = 0;
  private ignoreNextMouseMovement = false;

  constructor(
    containerId: string, 
    mode: string, 
    onHit: (c: number) => void, 
    onTick: (ms: number) => void,
    onComplete: (d: any) => void,
    pollingRate: number = 1000
  ) {
    this.container = document.getElementById(containerId)!;
    this.mode = mode;
    this.onTargetHit = onHit;
    this.onTick = onTick;
    this.onDrillComplete = onComplete;
    this.telemetry = new TelemetryProcessor(pollingRate);

    // 3D Three.js Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090b);

    this.camera = new THREE.PerspectiveCamera(59, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    
    this.yawObject.add(this.pitchObject);
    this.pitchObject.add(this.camera);
    this.scene.add(this.yawObject);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    // Clear container
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);
    
    // Subtle grid for depth perception
    const gridHelper = new THREE.GridHelper(100, 100, 0x1f2937, 0x1f2937);
    gridHelper.position.y = -5;
    this.scene.add(gridHelper);

    // Event Listeners
    window.addEventListener('resize', this.onWindowResize);
    document.addEventListener('mousemove', this.onMouseMove, { passive: false });
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.animate();
  }

  public start() {
    this.container.requestPointerLock();
  }

  public cleanup() {
    this.isRunning = false;
    window.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.container.innerHTML = '';
  }

  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.container) {
      this.ignoreNextMouseMovement = true;
      // If we are starting fresh
      if (!this.isRunning) {
        this.isRunning = true;
        this.targetsHit = 0;
        this.events = [];
        this.totalTrackingFrames = 0;
        this.hoveredTrackingFrames = 0;
        this.trackingVelocity.set(Math.random() > 0.5 ? 4 : -4, Math.random() > 0.5 ? 2 : -2);
        this.nextDirectionChangeTime = 0;
        
        this.elapsedTime = 0;
        this.lastFrameTime = performance.now();
        
        this.onTargetHit(0);
        
        this.occupiedCells.clear();
        this.targetMeshes.forEach(t => this.scene.remove(t.sprite));
        this.targetMeshes = [];
        this.isFirstTarget = true;
        this.lastHitPosition = null;
        this.lastTargetIndex = -1;

        if (this.mode === 'tracking') {
          if (this.trackingTarget) this.scene.remove(this.trackingTarget);
          const spriteMaterial = new THREE.SpriteMaterial({ map: cachedTargetTexture, color: 0x00ffcc });
          this.trackingTarget = new THREE.Sprite(spriteMaterial);
          this.trackingTarget.scale.set(1.6, 1.6, 1);
          this.trackingTarget.position.set(0, 0, -15);
          this.scene.add(this.trackingTarget);
        } else {
          for (let i = 0; i < this.MAX_SIMULTANEOUS_TARGETS; i++) {
            this.spawnTarget();
          }
        }
      }
      document.dispatchEvent(new CustomEvent('drill-resumed'));
    } else {
      document.dispatchEvent(new CustomEvent('drill-paused'));
    }
  }

  private getNextSpawnIndex(lastIndex: number, mode: string): number {
    if (mode === 'flicking' || lastIndex === -1) {
       let newIndex;
       do { newIndex = Math.floor(Math.random() * 25); } while (newIndex === lastIndex);
       return newIndex;
    }

    const col = lastIndex % this.GRID_COLS;
    const row = Math.floor(lastIndex / this.GRID_COLS);
    const neighbors = [];

    for (let r = Math.max(0, row - 1); r <= Math.min(this.GRID_ROWS - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(this.GRID_COLS - 1, col + 1); c++) {
        const index = r * this.GRID_COLS + c;
        if (index !== lastIndex) neighbors.push(index);
      }
    }
    
    return neighbors[Math.floor(Math.random() * neighbors.length)];
  }

  private spawnTarget() {
    if (this.mode === 'tracking') return;

    const randomIndex = this.getNextSpawnIndex(this.lastTargetIndex, this.mode);
    this.lastTargetIndex = randomIndex;
    this.occupiedCells.add(randomIndex);

    const CELL_SPACING = this.mode === 'micro_adjustment' ? 1.2 : 2.2;
    const wallZ = this.camera.position.z - 20;
    
    const gridWidth = (this.GRID_COLS - 1) * CELL_SPACING;
    const gridHeight = (this.GRID_ROWS - 1) * CELL_SPACING;

    const floorY = -5; // GridHelper floor is at -5
    const scale = this.mode === 'micro_adjustment' ? 0.4 : 1.0;
    const targetRadius = scale; 
    const floorPadding = 0.5;
    
    // 1. Calculate floor minCenterY
    const minCenterY = floorY + (gridHeight / 2) + targetRadius + floorPadding;
    
    // 2. Calculate the exact visible height at the grid's Z-distance
    const distance = Math.abs(wallZ - this.camera.position.z);
    const vFovRadians = this.camera.fov * (Math.PI / 180);
    const visibleHeight = 2 * Math.tan(vFovRadians / 2) * distance;

    // 3. Define the absolute highest the center of the grid can be
    const maxScreenY = this.camera.position.y + (visibleHeight / 2) * 0.9;
    const maxCenterY = maxScreenY - (gridHeight / 2) - targetRadius;

    // 4. Apply a double-clamp
    const clampedY = Math.min(Math.max(this.camera.position.y, minCenterY), maxCenterY);
    const centerY = clampedY;

    const col = randomIndex % this.GRID_COLS;
    const row = Math.floor(randomIndex / this.GRID_COLS);
    
    const x = (col * CELL_SPACING) - (gridWidth / 2);
    const y = centerY + ((row * CELL_SPACING) - (gridHeight / 2));
    
    const spriteMaterial = new THREE.SpriteMaterial({ map: cachedTargetTexture, color: 0x00ffcc });
    const targetMesh = new THREE.Sprite(spriteMaterial);
    
    targetMesh.scale.set(scale * 2, scale * 2, 1);
    targetMesh.position.set(x, y, wallZ);
    
    this.scene.add(targetMesh);
    this.targetMeshes.push({ sprite: targetMesh, cellIndex: randomIndex });
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRunning || document.pointerLockElement !== this.container) return;

    if (this.ignoreNextMouseMovement) {
      this.ignoreNextMouseMovement = false;
      return;
    }

    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;

    const PI_2 = Math.PI / 2;
    const sensitivity = 0.002;
    this.yawObject.rotation.y -= movementX * sensitivity;
    this.pitchObject.rotation.x -= movementY * sensitivity;
    this.pitchObject.rotation.x = Math.max(-PI_2, Math.min(PI_2, this.pitchObject.rotation.x));
    
    if (this.mode !== 'tracking') {
      this.telemetry.onRawMouseMove(movementX, movementY);
    }
  }

  private onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.container) return;
    if (!this.isRunning || e.button !== 0 || this.mode === 'tracking') return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    
    const sprites = this.targetMeshes.map(t => t.sprite);
    const intersects = raycaster.intersectObjects(sprites);

    if (intersects.length > 0) {
      const hitSprite = intersects[0].object as THREE.Sprite;
      const hitTargetIndex = this.targetMeshes.findIndex(t => t.sprite === hitSprite);
      if (hitTargetIndex === -1) return;
      
      const hitTarget = this.targetMeshes[hitTargetIndex];
      const currentHitPosition = { x: hitSprite.position.x, y: hitSprite.position.y };

      if (this.isFirstTarget) {
        this.isFirstTarget = false;
        this.lastHitPosition = currentHitPosition;
        this.telemetry.startTracking();
      } else {
        const evt = this.telemetry.endEvent(
          this.lastHitPosition!.x,
          this.lastHitPosition!.y,
          currentHitPosition.x,
          currentHitPosition.y
        );
        this.events.push(evt);
        this.lastHitPosition = currentHitPosition;
        this.telemetry.startTracking();
      }

      this.targetsHit++;
      this.onTargetHit(this.targetsHit);
      
      // Remove and Respawn
      this.scene.remove(hitSprite);
      this.occupiedCells.delete(hitTarget.cellIndex);
      this.targetMeshes.splice(hitTargetIndex, 1);
      
      this.spawnTarget();
    }
  }

  private endDrill() {
    this.isRunning = false;
    document.exitPointerLock();
    
    if (this.mode === 'tracking') {
      this.onDrillComplete({
        tracking_accuracy: this.totalTrackingFrames > 0 ? this.hoveredTrackingFrames / this.totalTrackingFrames : 0,
        hovered_frames: this.hoveredTrackingFrames,
        total_frames: this.totalTrackingFrames
      });
    } else {
      this.onDrillComplete(this.events);
    }
  }

  private onWindowResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const now = performance.now();

    if (this.isRunning && document.pointerLockElement === this.container) {
      const dt = (now - this.lastFrameTime) / 1000;
      
      this.elapsedTime += (now - this.lastFrameTime);
      const remaining = Math.max(0, this.DRILL_DURATION_MS - this.elapsedTime);
      this.onTick(remaining);

      if (remaining === 0) {
        this.endDrill();
        return;
      }

      if (this.mode === 'tracking') {
        if (now > this.nextDirectionChangeTime) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 3.0 + Math.random() * 2.0; 
          this.trackingVelocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed);
          this.nextDirectionChangeTime = now + 500 + Math.random() * 1000;
        }

        if (this.trackingTarget) {
          let nx = this.trackingTarget.position.x + this.trackingVelocity.x * dt;
          let ny = this.trackingTarget.position.y + this.trackingVelocity.y * dt;

          if (nx < -6 || nx > 6) {
            this.trackingVelocity.x *= -1;
            nx = Math.max(-6, Math.min(6, nx));
          }
          if (ny < 2 || ny > 6) {
            this.trackingVelocity.y *= -1;
            ny = Math.max(2, Math.min(6, ny));
          }

          this.trackingTarget.position.x = nx;
          this.trackingTarget.position.y = ny;

          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
          const intersects = raycaster.intersectObject(this.trackingTarget);

          this.totalTrackingFrames++;
          const mat = this.trackingTarget.material as THREE.SpriteMaterial;

          if (intersects.length > 0) {
            this.hoveredTrackingFrames++;
            mat.color.setHex(0xff0000);
          } else {
            mat.color.setHex(0x00ffcc);
          }
          this.onTargetHit(Math.floor((this.hoveredTrackingFrames / this.totalTrackingFrames) * 100));
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.lastFrameTime = now;
  }
}