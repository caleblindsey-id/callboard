import PartsPipeline from '@/components/dashboard/PartsPipeline'
import {
  getPartsToReviewCount,
  getPartsToOrderCount,
  getPartsOnOrderCount,
  getPartsReadyForPickupCount,
} from '@/lib/db/service-tickets'

export default async function PartsPipelineSection() {
  const [
    pmPartsToReview,
    pmPartsToOrder,
    pmPartsOnOrder,
    pmPartsReady,
    svcPartsToReview,
    svcPartsToOrder,
    svcPartsOnOrder,
    svcPartsReady,
  ] = await Promise.all([
    getPartsToReviewCount('pm'),
    getPartsToOrderCount('pm'),
    getPartsOnOrderCount(undefined, 'pm'),
    getPartsReadyForPickupCount(undefined, 'pm'),
    getPartsToReviewCount('service'),
    getPartsToOrderCount('service'),
    getPartsOnOrderCount(undefined, 'service'),
    getPartsReadyForPickupCount(undefined, 'service'),
  ])

  return (
    <PartsPipeline
      isTech={false}
      pmPartsToReview={pmPartsToReview}
      pmPartsToOrder={pmPartsToOrder}
      pmPartsOnOrder={pmPartsOnOrder}
      pmPartsReady={pmPartsReady}
      svcPartsToReview={svcPartsToReview}
      svcPartsToOrder={svcPartsToOrder}
      svcPartsOnOrder={svcPartsOnOrder}
      svcPartsReady={svcPartsReady}
    />
  )
}
