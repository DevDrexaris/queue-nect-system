import { Button } from './button'
import { Dialog } from './dialog'
import type { QueueEntry } from '../../types'

export type ConfirmedQueueAction = 'cancel' | 'skip'

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
  const title = isCancel ? `Cancel ${entry.queueNumber}?` : `Mark ${entry.queueNumber} as no-show?`
  const description = isCancel
    ? 'This will remove the queue from active service and the student will no longer be able to continue this queue.'
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
            {isCancel ? 'Keep queue' : 'Keep in queue'}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(entry, action)} loading={busy}>
            {isCancel ? 'Cancel queue' : 'Mark as no-show'}
          </Button>
        </>
      }
    />
  )
}
