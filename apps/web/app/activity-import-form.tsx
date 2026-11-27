'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import ActivitySummary from './activity-summary';
import { notifyActivitiesChanged } from './activity-events.ts';
import {
  getImportErrorMessage,
  isDuplicateActivityError,
  MAX_ACTIVITY_FILE_BYTES,
  parseActivityImportResponse,
  type ActivityImportResponse,
} from './activity-import-utils.ts';

type FormState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; activity: ActivityImportResponse }
  | { status: 'error'; message: string; duplicate: boolean };

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.gpx')) {
    return 'Choose a GPX file ending in .gpx.';
  }
  if (file.size === 0) return 'That file is empty. Choose another GPX file.';
  if (file.size > MAX_ACTIVITY_FILE_BYTES) return 'The file exceeds the 10 MiB limit. Choose a smaller GPX file.';
  return null;
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
        setState({
          status: 'error',
          message: getImportErrorMessage(response.status, payload),
          duplicate: isDuplicateActivityError(payload),
        });
        return;
      }

      notifyActivitiesChanged();
      const activity = parseActivityImportResponse(payload);
      if (!activity) {
        setState({
          status: 'error',
          message: 'The API returned an unexpected response. Confirm it is running locally, then retry.',
          duplicate: false,
        });
        return;
      }
      setFile(null);
      setState({ status: 'success', activity });
    } catch {
      setState({ status: 'error', message: getImportErrorMessage(502, null), duplicate: false });
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
          <ActivitySummary activity={activity} />
          <div className="import-result-actions">
            <Link className="secondary-button" href={`/activities/${activity.activity.id}`}>
              View activity
            </Link>
            <Link className="secondary-button" href="/activities">Activity history</Link>
            <button className="secondary-button" type="button" onClick={importAnother}>
              Import another activity
            </button>
          </div>
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
              {state.status === 'error' && state.duplicate && (
                <> <Link href="/activities" className="inline-link">View activity history</Link>.</>
              )}
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
