import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'
import type { SourcingCandidate } from './sourcingComparison'
export { subscribeSourcingDecisions, subscribeSourcingState, type SourcingDecision } from './sourcingDecisionRepository'

export async function selectSourcingCandidate(rfqId: string, rfqItemId: string, candidate: SourcingCandidate, selectedQuantity: number, shippingCost: number, reason: string): Promise<void> {
  await httpsCallable(firebaseFunctions, 'selectSourcingCandidate')({ rfqId, rfqItemId, selectedQuantity, shippingCost, reason, candidate: { id: candidate.id, sourceType: candidate.sourceType, sourceQuoteId: candidate.sourceQuoteId } })
}
export async function cancelSourcingDecision(rfqId: string, rfqItemId: string, decisionId: string): Promise<void> {
  await httpsCallable(firebaseFunctions, 'cancelSourcingDecision')({ rfqId, rfqItemId, decisionId })
}
