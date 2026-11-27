'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchActivityPage } from './activity-client.ts';
import ActivityCard from './activity-card';
import { ACTIVITIES_CHANGED_EVENT } from './activity-events.ts';
import type { ActivityPageResponse } from './activity-import-utils.ts';
import { getActivityApiErrorMessage } from './activity-import-utils.ts';

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: ActivityPageResponse };

export default function ActivityOverview() {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  useEffect(() => {
    const refresh = (): void => setRefreshVersion(current => current + 1);
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVITIES_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });

    void fetchActivityPage(1, 5, controller.signal).then(result => {
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
  }, [refreshVersion]);

  return (
    <main className="page-content" aria-labelledby="overview-title">
      <header className="hero">
        <p className="eyebrow">RUNNING, WITH CONTEXT</p>
        <h1 id="overview-title">Every run<br />tells a <span>story.</span></h1>
        <p className="hero-copy">A clear view of your imported activity history, stored locally on your device.</p>
      </header>

      <section className="content-panel" aria-label="Activity overview">
        {state.status === 'loading' && (
          <div className="loading-state" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>Loading your activity overview…</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="error-state" role="alert">
            <p>{state.message}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRefreshVersion(current => current + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <p className="overview-stat">
              <strong>{state.value.total}</strong>
              <span>{state.value.total === 1 ? 'stored activity' : 'stored activities'}</span>
            </p>
            {state.value.items.length === 0 ? (
              <section className="empty-state" aria-labelledby="overview-empty-title">
                <h2 id="overview-empty-title">Start with your first activity</h2>
                <p>Import a GPX file to see its summary here and in your activity history.</p>
                <Link className="primary-link" href="/import">Import activity</Link>
              </section>
            ) : (
              <>
                <div className="section-title-row">
                  <h2>Recently imported</h2>
                  <Link href="/activities">View all activities</Link>
                </div>
                <section className="activity-list" aria-label="Five most recently imported activities">
                  {state.value.items.map(activity => (
                    <ActivityCard key={activity.activity.id} activity={activity} />
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
