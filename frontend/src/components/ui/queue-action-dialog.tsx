import { Button } from './button'
import { Dialog } from './dialog'
import type { QueueEntry } from '../../types'

export type ConfirmedQueueAction = 'cancel' | 'skip' | 'awaiting_return' | 'delete'

export function QueueActionDialog({
  entry,
  action,
  busy = false,
  onClose,
  onConfirm,
}: {
  entry: QueueEntry | null
  action: ConfirmedQueueAction | null
  busy?: boolean
  onClose: () => void
  onConfirm: (entry: QueueEntry, action: ConfirmedQueueAction) => void
}) {
  if (!entry || !action) return null
  const isCancel = action === 'cancel'
  const isAwaitingReturn = action === 'awaiting_return'
  const isDelete = action === 'delete'
  const title = isCancel
    ? `Cancel ${entry.queueNumber}?`
    : isAwaitingReturn
      ? `Place ${entry.queueNumber} on hold?`
      : isDelete
        ? `Delete ${entry.queueNumber}?`
        : `Mark ${entry.queueNumber} as no-show?`
  const description = isCancel
    ? 'This will remove the queue from active service and the student will no longer be able to continue this queue.'
    : isAwaitingReturn
      ? `${entry.queueNumber} will remain in the system and can be called again when processing is complete.`
      : isDelete
        ? `${entry.queueNumber} will be removed from the current queue records, while its archived history remains protected for reporting.`
        : `Queue ${entry.queueNumber} will be removed from the active queue. This cannot be undone.`

  return (
    <Dialog
      open={Boolean(entry && action)}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {isCancel ? 'Keep queue' : isAwaitingReturn ? 'Keep serving' : isDelete ? 'Keep record' : 'Keep in queue'}
          </Button>
          <Button variant={isCancel || isDelete ? 'destructive' : 'default'} onClick={() => onConfirm(entry, action)} loading={busy}>
            {isCancel ? 'Cancel queue' : isAwaitingReturn ? 'Await Return' : isDelete ? 'Delete queue' : 'Mark as no-show'}
          </Button>
        </>
      }
    />
  )
}
