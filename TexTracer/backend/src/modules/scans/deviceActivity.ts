/**
 * In-memory record of every request the ESP32 readers make to POST /api/scans/device - including the ones that FAIL
 * (wrong key, bad body, database down). Failed requests never reach scan_logs, so without this the only symptom of a
 * mis-configured reader is "nothing shows up". Lost on backend restart on purpose (diagnostics, not audit data).
 */
export interface DeviceAttempt {
  at: string;
  ip: string;
  readerCode: string | null;
  rfidUid: string | null;
  httpStatus: number;
  /** scan result (accepted, duplicate, rejected_*) or an error code (INVALID_DEVICE_KEY, VALIDATION_ERROR, ...) */
  outcome: string;
  message: string | null;
}
export interface DeviceSeen {
  readerCode: string;
  lastContactAt: string;
  lastIp: string;
  lastHttpStatus: number;
  lastOutcome: string;
  lastUid: string | null;
  attempts: number;
  failures: number;
}

export class DeviceActivity {
  private recent: DeviceAttempt[] = [];
  private seen = new Map<string, DeviceSeen>();
  constructor(private readonly max = 200) {}

  record(a: Omit<DeviceAttempt, "at">): void {
    const at = new Date().toISOString();
    this.recent.unshift({ at, ...a });
    if (this.recent.length > this.max) this.recent.length = this.max;
    const code = a.readerCode ?? "(unknown)";
    const prev = this.seen.get(code);
    const failed = a.httpStatus >= 400 && !/^rejected_|SCAN_REJECTED/.test(a.outcome);
    this.seen.set(code, {
      readerCode: code,
      lastContactAt: at,
      lastIp: a.ip,
      lastHttpStatus: a.httpStatus,
      lastOutcome: a.outcome,
      lastUid: a.rfidUid ?? prev?.lastUid ?? null,
      attempts: (prev?.attempts ?? 0) + 1,
      failures: (prev?.failures ?? 0) + (failed ? 1 : 0),
    });
  }
  snapshot(limit = 50) {
    return { readers: [...this.seen.values()], recent: this.recent.slice(0, limit) };
  }
}
