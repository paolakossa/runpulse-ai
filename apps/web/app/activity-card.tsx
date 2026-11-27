import Link from 'next/link';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  type ActivityImportResponse,
} from './activity-import-utils.ts';
import LocalTimestamp from './local-timestamp';

type ActivityCardProps = {
  activity: ActivityImportResponse;
  onDelete?: (activity: ActivityImportResponse) => void;
};

export default function ActivityCard({ activity, onDelete }: ActivityCardProps) {
  return (
    <article className="activity-card">
      <div className="activity-card-heading">
        <div>
          <h2>
            <Link
              href={`/activities/${activity.activity.id}`}
              aria-label={`View activity details started ${activity.activity.startTime ?? 'at an unknown time'}`}
            >
              Activity details
            </Link>
          </h2>
          <p className="activity-date">
            Started <LocalTimestamp value={activity.activity.startTime} />
          </p>
          <p className="activity-imported">
            Imported <LocalTimestamp value={activity.activity.importedAt} />
          </p>
        </div>
        {onDelete && (
          <button
            className="text-button delete-button"
            type="button"
            onClick={() => onDelete(activity)}
            aria-label={`Delete activity started ${activity.activity.startTime ?? 'at an unknown time'}`}
          >
            Delete
          </button>
        )}
      </div>
      <dl className="activity-card-metrics">
        <div><dt>Distance</dt><dd>{formatDistance(activity.metrics.totalDistanceMeters)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(activity.metrics.elapsedSeconds)}</dd></div>
        <div><dt>Avg. pace</dt><dd>{formatPace(activity.metrics.averageElapsedPaceSecondsPerKm)}</dd></div>
        <div><dt>Avg. heart rate</dt><dd>{formatHeartRate(activity.metrics.averageHeartRateBpm)}</dd></div>
        <div><dt>Elevation gain</dt><dd>{formatElevation(activity.metrics.totalElevationGainMeters)}</dd></div>
      </dl>
    </article>
  );
}
