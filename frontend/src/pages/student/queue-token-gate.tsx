import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { queueService } from '../../services/api'
import { LoadingState } from '../../components/ui/states'
import { ThemeSelector } from '../../components/ui/theme-selector'
import { QueueAccessRequiredPage } from './queue-access-required'

export function QueueTokenGate() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [invalid, setInvalid] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setInvalid(true)
      setLoading(false)
      return
    }

    async function validate() {
      try {
        const details = await queueService.validateAccessToken(token)
        navigate(`/queue/${details.clinicIdentifier}/join?token=${encodeURIComponent(token)}`, { replace: true })
      } catch {
        setInvalid(true)
      } finally {
        setLoading(false)
      }
    }

    void validate()
  }, [navigate, token])

  if (loading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4">
        <div className="flex w-full justify-end">
          <ThemeSelector />
        </div>
        <LoadingState label="Validating queue access..." />
      </div>
    )
  }
  if (invalid) return <QueueAccessRequiredPage />

  return null
}
