'use client';

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import {
  formatCoverage,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  getImportErrorMessage,
  MAX_ACTIVITY_FILE_BYTES,
  parseActivityImportResponse,
  type ActivityImportResponse,
} from './activity-import-utils.ts';

type FormState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; activity: ActivityImportResponse }
  | { status: 'error'; message: string };

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.gpx')) {
    return 'Choose a GPX file ending in .gpx.';
  }
  if (file.size === 0) return 'That file is empty. Choose another GPX file.';
  if (file.size > MAX_ACTIVITY_FILE_BYTES) return 'The file exceeds the 10 MiB limit. Choose a smaller GPX file.';
  return null;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return 'N/A';
  return `${new Date(value).toLocaleString()} (local time)`;
}

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

export default function ActivityImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<FormState>({ status: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [selectingError, setSelectingError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const isUploading = state.status === 'uploading';

  function chooseFile(candidate: File | undefined): void {
    if (submitting.current) return;
    setSelectingError(null);
    if (!candidate) return;

    const validationError = validateFile(candidate);
    if (validationError) {
      setFile(null);
      setState({ status: 'idle' });
      setSelectingError(validationError);
      return;
    }

    setFile(candidate);
    setState({ status: 'idle' });
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    chooseFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    if (isUploading) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setFile(null);
      setState({ status: 'idle' });
      setSelectingError('Drop one GPX file at a time.');
      return;
    }
    chooseFile(files[0]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    if (!file) {
      setSelectingError('Choose a GPX file before importing.');
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      setSelectingError(validationError);
      return;
    }

    submitting.current = true;
    setSelectingError(null);
    setState({ status: 'uploading' });
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/activities/import', {
        method: 'POST',
        body: formData,
        cache: 'no-store',
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        setState({ status: 'error', message: getImportErrorMessage(response.status, payload) });
        return;
      }

      const activity = parseActivityImportResponse(payload);
      if (!activity) {
        setState({
          status: 'error',
          message: 'The API returned an unexpected response. Confirm it is running locally, then retry.',
        });
        return;
      }
      setFile(null);
      setState({ status: 'success', activity });
    } catch {
      setState({ status: 'error', message: getImportErrorMessage(502, null) });
    } finally {
      submitting.current = false;
    }
  }

  function importAnother(): void {
    if (submitting.current) return;
    setFile(null);
    setSelectingError(null);
    setState({ status: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  }

  const activity = state.status === 'success' ? state.activity : null;

  return (
    <section className="import-panel" aria-labelledby="import-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACTIVITY IMPORT</p>
          <h2 id="import-title">{activity ? 'Your activity summary' : 'Import a GPX activity'}</h2>
        </div>
        <span className="format-badge">GPX · up to 10 MiB</span>
      </div>

      {activity ? (
        <div className="results" aria-live="polite">
          <div className="activity-meta">
            <p><span>Started</span><strong>{formatTimestamp(activity.activity.startTime)}</strong></p>
            <p><span>Ended</span><strong>{formatTimestamp(activity.activity.endTime)}</strong></p>
            <p><span>Segments</span><strong>{activity.activity.segmentCount}</strong></p>
            <p><span>Track points</span><strong>{activity.activity.trackPointCount}</strong></p>
          </div>

          {activity.metrics.hasOverlappingSegments && (
            <p className="overlap-warning" role="status">
              These segments overlap in time. Average elapsed pace is unavailable for overlapping segments.
            </p>
          )}

          <h3 className="subheading">Performance</h3>
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

          <h3 className="subheading">Data coverage</h3>
          <div className="coverage-list">
            <Coverage label="Distance" value={activity.coverage.distance} basis="Adjacent within-segment pairs" />
            <Coverage label="Elevation" value={activity.coverage.elevation} basis="Adjacent within-segment pairs" />
            <Coverage label="Heart rate" value={activity.coverage.heartRate} basis="Recorded time with eligible readings" />
          </div>
          <p className="coverage-note">
            Coverage is an availability indicator, not a sensor accuracy score. Heart-rate coverage is time-based;
            distance and elevation coverage are pair-based.
          </p>
          <button className="secondary-button" type="button" onClick={importAnother}>
            Import another activity
          </button>
        </div>
      ) : (
        <form className="upload-form" onSubmit={onSubmit}>
          <label
            className={`drop-zone${dragging ? ' is-dragging' : ''}${isUploading ? ' is-disabled' : ''}`}
            htmlFor="gpx-file"
            onDragOver={event => {
              event.preventDefault();
              if (!isUploading) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              id="gpx-file"
              type="file"
              accept=".gpx"
              aria-describedby="file-guidance"
              disabled={isUploading}
              onChange={onFileChange}
            />
            <span className="upload-icon" aria-hidden="true">↑</span>
            <span className="drop-title">{file ? file.name : 'Drop your GPX file here'}</span>
            <span className="drop-caption">{file ? 'Choose a different file or import this activity' : 'or choose a file from your device'}</span>
          </label>
          <p id="file-guidance" className="file-guidance">One .gpx file · maximum size 10 MiB</p>

          {(selectingError || state.status === 'error') && (
            <p className="error-message" role="alert">
              {state.status === 'error' ? state.message : selectingError}
            </p>
          )}

          {isUploading && (
            <p className="upload-status" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              Uploading and analyzing your activity…
            </p>
          )}

          <button className="primary-button" type="submit" disabled={!file || isUploading}>
            {isUploading ? 'Processing…' : 'Import activity'}
          </button>
        </form>
      )}

      <aside className="privacy-notice">
        <span aria-hidden="true">◇</span>
        <p>
          Your activity summary and metrics are stored in your local PostgreSQL database. Original GPX files and GPS coordinates are not retained.
        </p>
      </aside>
    </section>
  );
}
