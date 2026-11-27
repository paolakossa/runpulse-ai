'use client';

import { useEffect, useId, useRef } from 'react';
import type { ActivityImportResponse } from './activity-import-utils.ts';
import LocalTimestamp from './local-timestamp';

type DeleteActivityDialogProps = {
  activity: ActivityImportResponse | null;
  isDeleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteActivityDialog({
  activity,
  isDeleting,
  errorMessage,
  onCancel,
  onConfirm,
}: DeleteActivityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activity && !dialog.open) dialog.showModal();
    else if (!activity && dialog.open) dialog.close();
  }, [activity]);

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => {
        event.preventDefault();
        if (!isDeleting) onCancel();
      }}
    >
      <h2 id={titleId}>Delete this activity?</h2>
      <p id={descriptionId}>
        This permanently removes the stored activity summary and metrics from your local database.
        The original GPX file is not stored.
      </p>
      {activity && (
        <p className="dialog-activity-date">
          Activity started <LocalTimestamp value={activity.activity.startTime} />
        </p>
      )}
      {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={isDeleting}>
          Cancel
        </button>
        <button className="danger-button" type="button" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </dialog>
  );
}
