'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { deleteActivity, fetchActivityPage } from './activity-client.ts';
import { ACTIVITIES_CHANGED_EVENT, notifyActivitiesChanged } from './activity-events.ts';
import ActivityCard from './activity-card';
import DeleteActivityDialog from './delete-activity-dialog';
import type { ActivityImportResponse, ActivityPageResponse } from './activity-import-utils.ts';
import { getActivityApiErrorMessage } from './activity-import-utils.ts';

const PAGE_SIZE = 20;

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: ActivityPageResponse };

export default function ActivityHistory() {
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const [deleteTarget, setDeleteTarget] = useState<ActivityImportResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const deleteInFlight = useRef(false);
  const isMounted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });

    void fetchActivityPage(page, PAGE_SIZE, controller.signal).then(result => {
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
  }, [page, refreshVersion]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const refresh = (): void => setRefreshVersion(current => current + 1);
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVITIES_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const lastPage = Math.max(1, state.value.totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [page, state]);

  function requestDelete(activity: ActivityImportResponse): void {
    setDeleteError(null);
    setDeleteTarget(activity);
  }

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
      if (result.ok === true || result.status === 404) {
        const alreadyDeleted = result.ok === false && result.status === 404;
        notifyActivitiesChanged();
        if (!isMounted.current) return;
        const shouldMoveToPreviousPage =
          state.status === 'ready' && state.value.items.length <= 1 && page > 1;
        setDeleteTarget(null);
        setAnnouncement(alreadyDeleted
          ? 'This activity was already deleted. Activity history has been refreshed.'
          : 'Activity deleted.');
        if (shouldMoveToPreviousPage) setPage(current => Math.max(1, current - 1));
        headingRef.current?.focus();
      } else if (result.ok === false && isMounted.current) {
        setDeleteError(result.message);
      }
    } catch {
      if (isMounted.current) setDeleteError(getActivityApiErrorMessage(502, null));
    } finally {
      deleteInFlight.current = false;
      if (isMounted.current) setIsDeleting(false);
    }
  }

  function retry(): void {
    setAnnouncement(null);
    setRefreshVersion(current => current + 1);
  }

  const pageData = state.status === 'ready' ? state.value : null;
  const firstItem = pageData && pageData.total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = pageData ? Math.min(page * PAGE_SIZE, pageData.total) : 0;

  return (
    <main className="page-content" aria-labelledby="activities-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">YOUR RUNNING HISTORY</p>
          <h1 id="activities-title" ref={headingRef} tabIndex={-1}>Activities</h1>
          <p>Browse stored activity summaries and review the metrics from each import.</p>
        </div>
        <Link className="primary-link" href="/import">Import activity</Link>
      </header>

      {announcement && <p className="inline-status" role="status">{announcement}</p>}

      {state.status === 'loading' && (
        <div className="loading-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading activity history…</p>
        </div>
      )}

      {state.status === 'error' && (
        <section className="error-state" role="alert">
          <p>{state.message}</p>
          <button className="secondary-button" type="button" onClick={retry}>Retry</button>
        </section>
      )}

      {pageData && pageData.total === 0 && (
        <section className="empty-state" aria-labelledby="empty-history-title">
          <h2 id="empty-history-title">No activities yet</h2>
          <p>Import a GPX file to create your first activity summary.</p>
          <Link className="primary-link" href="/import">Import activity</Link>
        </section>
      )}

      {pageData && pageData.total > 0 && (
        <>
          <section className="activity-list" aria-label="Activity history">
            {pageData.items.map(activity => (
              <ActivityCard key={activity.activity.id} activity={activity} onDelete={requestDelete} />
            ))}
          </section>
          <nav className="pagination" aria-label="Activity history pagination">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <p aria-live="polite">
              Showing {firstItem}–{lastItem} of {pageData.total} activities · Page {page} of {pageData.totalPages}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPage(current => Math.min(pageData.totalPages, current + 1))}
              disabled={pageData.totalPages === 0 || page >= pageData.totalPages}
            >
              Next
            </button>
          </nav>
        </>
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
