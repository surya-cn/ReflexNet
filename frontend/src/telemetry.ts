// Ported directly from the C# math engine to ensure 1:1 behavioral parity.

export interface TelemetryEvent {
  time_to_acquire_ms: number;
  overshoot_count: number;
  undershoot: boolean;
  path_efficiency: number;
  wide_flick_efficiency?: number;
  micro_correction_efficiency?: number;
}

export interface MetricsSummary {
  overshoot_rate: number;
  undershoot_rate: number;
  ttk_ms: number;
  path_efficiency: number;
  wide_flick_efficiency?: number;
  micro_correction_efficiency?: number;
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
    
    this.path.push({ x: this.crosshairX, y: this.crosshairY });
    
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

  public endEvent(): TelemetryEvent {
    this.isEventActive = false;
    const ttk = performance.now() - this.eventStartTime;
    
    if (this.path.length === 0) {
      return {
        time_to_acquire_ms: ttk,
        overshoot_count: 0,
        undershoot: false,
        path_efficiency: 0,
        wide_flick_efficiency: undefined,
        micro_correction_efficiency: undefined
      };
    }

    const finalPoint = this.path[this.path.length - 1];
    const idealDistance = Math.hypot(finalPoint.x, finalPoint.y);
    const efficiency = idealDistance > 0 ? idealDistance / Math.max(idealDistance, this.pathLength) : 1.0;
    
    // Retroactive overshoot calculation
    let overshoots = 0;
    let minDistanceToTarget = idealDistance;
    let enteredRadiusIndex = -1;
    const ENTER_RADIUS = this.OVERSHOOT_THRESHOLD_PX * 2;
    
    for (let i = 0; i < this.path.length; i++) {
      const point = this.path[i];
      const distToTarget = Math.hypot(finalPoint.x - point.x, finalPoint.y - point.y);
      
      if (enteredRadiusIndex === -1 && distToTarget <= ENTER_RADIUS) {
        enteredRadiusIndex = i;
      }
      
      if (distToTarget < minDistanceToTarget) {
        minDistanceToTarget = distToTarget;
      } else if (distToTarget > minDistanceToTarget + this.OVERSHOOT_THRESHOLD_PX) {
        overshoots++;
        minDistanceToTarget = distToTarget;
      }
    }

    let wideFlickEff: number | undefined = undefined;
    let microEff: number | undefined = undefined;

    if (enteredRadiusIndex !== -1 && enteredRadiusIndex > 0) {
      let widePathLen = 0;
      for (let i = 1; i <= enteredRadiusIndex; i++) {
        widePathLen += Math.hypot(this.path[i].x - this.path[i-1].x, this.path[i].y - this.path[i-1].y);
      }
      const wideIdeal = Math.hypot(this.path[enteredRadiusIndex].x, this.path[enteredRadiusIndex].y);
      wideFlickEff = wideIdeal > 0 ? wideIdeal / Math.max(wideIdeal, widePathLen) : 1.0;

      if (enteredRadiusIndex < this.path.length - 1) {
        let microPathLen = 0;
        for (let i = enteredRadiusIndex + 1; i < this.path.length; i++) {
          microPathLen += Math.hypot(this.path[i].x - this.path[i-1].x, this.path[i].y - this.path[i-1].y);
        }
        const microIdeal = Math.hypot(finalPoint.x - this.path[enteredRadiusIndex].x, finalPoint.y - this.path[enteredRadiusIndex].y);
        microEff = microIdeal > 0 ? microIdeal / Math.max(microIdeal, microPathLen) : 1.0;
      }
    }
    
    return {
      time_to_acquire_ms: ttk,
      overshoot_count: Math.max(this.overshoots, overshoots),
      undershoot: minDistanceToTarget > this.OVERSHOOT_THRESHOLD_PX && ttk > 200, 
      path_efficiency: efficiency,
      wide_flick_efficiency: wideFlickEff,
      micro_correction_efficiency: microEff
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
    let totalWideEff = 0;
    let totalMicroEff = 0;
    let wideCount = 0;
    let microCount = 0;

    events.forEach(e => {
      if (e.overshoot_count > 0) overshoots++;
      if (e.undershoot) undershoots++;
      totalTtk += e.time_to_acquire_ms;
      totalEff += e.path_efficiency;
      if (e.wide_flick_efficiency !== undefined) {
        totalWideEff += e.wide_flick_efficiency;
        wideCount++;
      }
      if (e.micro_correction_efficiency !== undefined) {
        totalMicroEff += e.micro_correction_efficiency;
        microCount++;
      }
    });

    const result: MetricsSummary = {
      overshoot_rate: overshoots / events.length,
      undershoot_rate: undershoots / events.length,
      ttk_ms: totalTtk / events.length,
      path_efficiency: totalEff / events.length
    };

    if (wideCount > 0) result.wide_flick_efficiency = totalWideEff / wideCount;
    if (microCount > 0) result.micro_correction_efficiency = totalMicroEff / microCount;

    return result;
  }
}
