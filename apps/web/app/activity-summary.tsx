import {
  formatCoverage,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  type ActivityImportResponse,
} from './activity-import-utils.ts';
import LocalTimestamp from './local-timestamp';

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article className="metric-card">
      <h3>{label}</h3>
      <p className="metric-value">{value}</p>
      {note && <p className="metric-note">{note}</p>}
    </article>
  );
}

function Coverage({ label, value, basis }: { label: string; value: number | null; basis: string }) {
  return (
    <div className="coverage-row">
      <div>
        <strong>{label}</strong>
        <span>{basis}</span>
      </div>
      <strong className="coverage-value">{formatCoverage(value)}</strong>
    </div>
  );
}

export default function ActivitySummary({ activity }: { activity: ActivityImportResponse }) {
  return (
    <section className="activity-summary" aria-label="Activity summary">
      <div className="activity-meta">
        <p><span>Started</span><strong><LocalTimestamp value={activity.activity.startTime} /></strong></p>
        <p><span>Ended</span><strong><LocalTimestamp value={activity.activity.endTime} /></strong></p>
        <p><span>Imported</span><strong><LocalTimestamp value={activity.activity.importedAt} /></strong></p>
        <p><span>Segments</span><strong>{activity.activity.segmentCount}</strong></p>
        <p><span>Track points</span><strong>{activity.activity.trackPointCount}</strong></p>
      </div>

      {activity.metrics.hasOverlappingSegments && (
        <p className="overlap-warning" role="status">
          These segments overlap in time. Average elapsed pace is unavailable for overlapping segments.
        </p>
      )}

      <h2 className="subheading">Performance</h2>
      <div className="metric-grid">
        <Metric label="Total distance" value={formatDistance(activity.metrics.totalDistanceMeters)} />
        <Metric label="Elapsed duration" value={formatDuration(activity.metrics.elapsedSeconds)} />
        <Metric
          label="Recorded duration"
          value={formatDuration(activity.metrics.recordedDurationSeconds)}
          note="Not moving time"
        />
        <Metric label="Average elapsed pace" value={formatPace(activity.metrics.averageElapsedPaceSecondsPerKm)} />
        <Metric label="Elevation gain" value={formatElevation(activity.metrics.totalElevationGainMeters)} />
        <Metric label="Elevation loss" value={formatElevation(activity.metrics.totalElevationLossMeters)} />
        <Metric label="Average heart rate" value={formatHeartRate(activity.metrics.averageHeartRateBpm)} />
        <Metric label="Maximum heart rate" value={formatHeartRate(activity.metrics.maxHeartRateBpm)} />
      </div>

      <h2 className="subheading">Data coverage</h2>
      <div className="coverage-list">
        <Coverage label="Distance" value={activity.coverage.distance} basis="Adjacent within-segment pairs" />
        <Coverage label="Elevation" value={activity.coverage.elevation} basis="Adjacent within-segment pairs" />
        <Coverage label="Heart rate" value={activity.coverage.heartRate} basis="Recorded time with eligible readings" />
      </div>
      <p className="coverage-note">
        Coverage is an availability indicator, not a sensor accuracy score. Heart-rate coverage is time-based;
        distance and elevation coverage are pair-based.
      </p>
    </section>
  );
}
