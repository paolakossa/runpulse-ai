'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { deleteActivity, fetchActivity } from './activity-client.ts';
import ActivitySummary from './activity-summary';
import DeleteActivityDialog from './delete-activity-dialog';
import { notifyActivitiesChanged } from './activity-events.ts';
import {
  getActivityApiErrorMessage,
  type ActivityImportResponse,
} from './activity-import-utils.ts';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: ActivityImportResponse };

export default function ActivityDetail({ id }: { id: string }) {
  const router = useRouter();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [deleteTarget, setDeleteTarget] = useState<ActivityImportResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteInFlight = useRef(false);
  const isMounted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });

    void fetchActivity(id, controller.signal).then(result => {
      if (!active) return;
      if (result.ok === true) setState({ status: 'ready', value: result.value });
      else setState({ status: 'error', message: result.message });
    }).catch(() => {
      if (active && !controller.signal.aborted) {
        setState({ status: 'error', message: getActivityApiErrorMessage(502, null) });
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, refreshVersion]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await deleteActivity(
        deleteTarget.activity.id,
        new AbortController().signal,
      );
      if (result.ok === true) {
        notifyActivitiesChanged();
        if (isMounted.current) router.push('/activities');
        return;
      }
      if (result.ok === false && result.status === 404) {
        notifyActivitiesChanged();
        if (isMounted.current) {
          setDeleteTarget(null);
          setState({ status: 'error', message: result.message });
        }
        return;
      }
      if (result.ok === false && isMounted.current) setDeleteError(result.message);
    } catch {
      if (isMounted.current) setDeleteError(getActivityApiErrorMessage(502, null));
    } finally {
      deleteInFlight.current = false;
      if (isMounted.current) setIsDeleting(false);
    }
  }

  function retry(): void {
    setRefreshVersion(current => current + 1);
  }

  return (
    <main className="page-content" aria-labelledby="activity-detail-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">ACTIVITY DETAILS</p>
          <h1 id="activity-detail-title">Activity details</h1>
          <p>Review the saved summary, metrics, and data coverage for this activity.</p>
        </div>
        <Link className="secondary-button" href="/activities">Back to activities</Link>
      </header>

      {state.status === 'loading' && (
        <div className="loading-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading activity details…</p>
        </div>
      )}

      {state.status === 'error' && (
        <section className="error-state" role="alert">
          <p>{state.message}</p>
          <div className="activity-detail-actions">
            <button className="secondary-button" type="button" onClick={retry}>Retry</button>
            <Link className="secondary-button" href="/activities">Return to activity history</Link>
          </div>
        </section>
      )}

      {state.status === 'ready' && (
        <section className="content-panel">
          <ActivitySummary activity={state.value} />
          <div className="activity-detail-actions">
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeleteTarget(state.value);
              }}
            >
              Delete activity
            </button>
            <Link className="secondary-button" href="/import">Import another activity</Link>
          </div>
        </section>
      )}

      <DeleteActivityDialog
        activity={deleteTarget}
        isDeleting={isDeleting}
        errorMessage={deleteError}
        onCancel={() => {
          if (!isDeleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => { void confirmDelete(); }}
      />
    </main>
  );
}
