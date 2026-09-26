import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { queueService } from '../../services/api'
import { LoadingState } from '../../components/ui/states'
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

  if (loading) return <LoadingState label="Validating queue access..." />
  if (invalid) return <QueueAccessRequiredPage />

  return null
}
