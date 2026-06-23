// Shared types for billing PDF rendering + the billing PDF API route.
// Single source of truth — do not duplicate these elsewhere.

export interface PartLine {
  productNumber: string | null
  description: string
  quantity: number
  unit_price: number
  // Free-text detail for catch-all items (products.requires_detail), e.g.
  // "SHOP SUPPLIES" → "rags, lubricant, fasteners". Appended after the
  // description on the PDF via partLabel().
  detail?: string | null
}

export interface BillingTicket {
  id: string
  workOrderNumber: number
  // Synergy parts-order # — printed on the billing summary so coordinators can
  // match the exported ticket back to its Synergy record when keying the invoice #
  // (feedback #48). Optional.
  synergyOrderNumber: string | null
  customerName: string
  accountNumber: string | null
  billingAddress: string | null
  serviceLocation: string | null
  arTerms: string | null
  equipmentMake: string | null
  equipmentModel: string | null
  serialNumber: string | null
  locationOnSite: string | null
  equipmentContactName: string | null
  equipmentContactEmail: string | null
  equipmentContactPhone: string | null
  technicianName: string
  completedDate: string
  hoursWorked: number | null
  machineHours: number | null
  dateCode: string | null
  completionNotes: string | null
  partsUsed: PartLine[]
  additionalPartsUsed: PartLine[]
  additionalHoursWorked: number | null
  laborRate: number
  billingAmount: number | null
  billingType: string | null
  flatRate: number | null
  poRequired: boolean
  poNumber: string | null
  billingContactName: string | null
  billingContactEmail: string | null
  billingContactPhone: string | null
  customerSignature: string | null
  customerSignatureName: string | null
  photoUrls: string[]
  // Customer sales-tax rate as a percent (e.g. 7.75); 0 when exempt or none on
  // file. Display-only — applied to additional (out-of-contract) parts only.
  taxRatePercent: number
}
