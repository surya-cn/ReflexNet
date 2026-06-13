// Ported directly from the C# math engine to ensure 1:1 behavioral parity.

export interface TelemetryEvent {
  time_to_acquire_ms: number;
  overshoot_count: number;
  undershoot: boolean;
  path_efficiency: number;
}

export interface MetricsSummary {
  overshoot_rate: number;
  undershoot_rate: number;
  ttk_ms: number;
  path_efficiency: number;
}

export class TelemetryProcessor {
  // Constants
  private readonly OVERSHOOT_THRESHOLD_PX = 50.0;
  private readonly ALPHA_ACCEL = 0.15;
  private readonly TICK_RATE_MS: number;

  // State
  private lastProcessTime: number = 0;
  private accDx = 0;
  private accDy = 0;
  
  // Event-specific tracking
  private isEventActive = false;
  private eventStartTime = 0;
  private startDistance = 0;
  private minDistanceToTarget = Number.MAX_VALUE;
  private pathLength = 0;
  private crosshairX = 0;
  private crosshairY = 0;
  private targetX = 0;
  private targetY = 0;
  
  private overshoots = 0;
  private lastVelocityX = 0;
  private lastVelocityY = 0;

  // Welford's Variance
  private accelMean = 0;
  private accelM2 = 0;
  private accelCount = 0;

  private path: { x: number, y: number }[] = [];

  constructor(pollingRate: number = 1000) {
    this.TICK_RATE_MS = 1000.0 / pollingRate;
  }

  public startTracking() {
    this.isEventActive = true;
    this.eventStartTime = performance.now();
    this.lastProcessTime = this.eventStartTime;
    
    this.path = [];
    this.pathLength = 0;
    this.overshoots = 0;
    this.lastVelocityX = 0;
    this.lastVelocityY = 0;
    
    this.accelMean = 0;
    this.accelM2 = 0;
    this.accelCount = 0;
    this.accDx = 0;
    this.accDy = 0;
  }

  // Called directly from the high-frequency mousemove event listener
  public onRawMouseMove(movementX: number, movementY: number) {
    if (!this.isEventActive) return;

    this.accDx += movementX;
    this.accDy += movementY;

    const now = performance.now();
    const dtMs = now - this.lastProcessTime;

    // Independent 250Hz processing loop
    if (dtMs >= this.TICK_RATE_MS) {
      this.processTick(this.accDx, this.accDy, dtMs / 1000.0);
      this.accDx = 0;
      this.accDy = 0;
      this.lastProcessTime = now;
    }
  }

  private processTick(dx: number, dy: number, dt: number) {
    if (dt <= 0) return;

    // 1. Update Spatial Positioning
    this.crosshairX += dx;
    this.crosshairY += dy;
    
    const segmentLength = Math.hypot(dx, dy);
    this.pathLength += segmentLength;

    const currentDistance = Math.hypot(this.targetX - this.crosshairX, this.targetY - this.crosshairY);

    // 2. Velocity & Acceleration (EMA Low-Pass)
    const velX = dx / dt;
    const velY = dy / dt;
    
    const rawAccelX = (velX - this.lastVelocityX) / dt;
    const rawAccelY = (velY - this.lastVelocityY) / dt;
    const accelMag = Math.hypot(rawAccelX, rawAccelY);
    
    // Smooth out micro-stutters
    const smoothedAccel = this.ALPHA_ACCEL * accelMag + (1 - this.ALPHA_ACCEL) * (this.accelMean || 0);

    // 3. Welford's Variance for Jitter
    this.accelCount++;
    const delta = smoothedAccel - this.accelMean;
    this.accelMean += delta / this.accelCount;
    const delta2 = smoothedAccel - this.accelMean;
    this.accelM2 += delta * delta2;

    // 4. CPA Overshoot Detection
    // Condition 1: Distance is increasing (moving away)
    // Condition 2: Min distance achieved was < 50px threshold
    // Condition 3: Velocity vector dot product with Target->Crosshair vector is positive
    if (currentDistance > this.minDistanceToTarget && this.minDistanceToTarget < this.OVERSHOOT_THRESHOLD_PX) {
      const vecToCrosshairX = this.crosshairX - this.targetX;
      const vecToCrosshairY = this.crosshairY - this.targetY;
      const dot = (velX * vecToCrosshairX) + (velY * vecToCrosshairY);
      
      if (dot > 0) {
        this.overshoots++;
        // Reset min distance so we don't trigger repeatedly on the same overshoot
        this.minDistanceToTarget = Number.MAX_VALUE;
      }
    }

    // Update min distance
    if (currentDistance < this.minDistanceToTarget) {
      this.minDistanceToTarget = currentDistance;
    }

    this.lastVelocityX = velX;
    this.lastVelocityY = velY;
  }

  public endEvent(startX: number, startY: number, endX: number, endY: number): TelemetryEvent {
    this.isEventActive = false;
    const ttk = performance.now() - this.eventStartTime;
    
    const idealDistance = Math.hypot(endX - startX, endY - startY);
    const efficiency = idealDistance > 0 ? idealDistance / Math.max(idealDistance, this.pathLength) : 1.0;
    
    // Retroactive overshoot calculation
    let overshoots = 0;
    let minDistanceToTarget = idealDistance;
    
    for (const point of this.path) {
      const distToTarget = Math.hypot(endX - point.x, endY - point.y);
      if (distToTarget < minDistanceToTarget) {
        minDistanceToTarget = distToTarget;
      } else if (distToTarget > minDistanceToTarget + this.OVERSHOOT_THRESHOLD_PX) {
        overshoots++;
        minDistanceToTarget = distToTarget;
      }
    }
    
    return {
      time_to_acquire_ms: ttk,
      overshoot_count: overshoots,
      undershoot: minDistanceToTarget > this.OVERSHOOT_THRESHOLD_PX && ttk > 200, 
      path_efficiency: efficiency
    };
  }

  // Aggregator for the final payload
  public static calculateSummary(events: TelemetryEvent[]): MetricsSummary {
    if (events.length === 0) {
      return { overshoot_rate: 0, undershoot_rate: 0, ttk_ms: 0, path_efficiency: 0 };
    }

    let overshoots = 0;
    let undershoots = 0;
    let totalTtk = 0;
    let totalEff = 0;

    events.forEach(e => {
      if (e.overshoot_count > 0) overshoots++;
      if (e.undershoot) undershoots++;
      totalTtk += e.time_to_acquire_ms;
      totalEff += e.path_efficiency;
    });

    return {
      overshoot_rate: overshoots / events.length,
      undershoot_rate: undershoots / events.length,
      ttk_ms: totalTtk / events.length,
      path_efficiency: totalEff / events.length
    };
  }
}
