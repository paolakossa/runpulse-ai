/** Format-independent observations. Units are explicit; missing sensors stay absent. */
export interface ActivitySample {
  /** UTC ISO 8601 timestamp, normalized to millisecond precision. */
  timestamp: string;
  /** Optional for future indoor FIT/TCX activities; required by the GPX importer. */
  position?: { latitude: number; longitude: number };
  elevationMeters?: number;
  heartRateBpm?: number;
}

export interface ActivitySegment {
  /** Ordered observations. Analytics must never join points across segments. */
  samples: ActivitySample[];
}

export interface Activity {
  segments: ActivitySegment[];
}
