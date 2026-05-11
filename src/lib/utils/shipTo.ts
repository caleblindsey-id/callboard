type ShipToFields = {
  name: string | null
  address: string | null
  city: string | null
}

type TicketShipToSources = {
  pm_ship_to?: ShipToFields | null
  equipment?: { ship_to_locations?: ShipToFields | null } | null
}

export function resolveTicketShipTo(ticket: TicketShipToSources): ShipToFields | null {
  return ticket.pm_ship_to ?? ticket.equipment?.ship_to_locations ?? null
}

export function formatShipToLines(shipTo: ShipToFields | null): {
  name: string | null
  street: string | null
} {
  if (!shipTo) return { name: null, street: null }
  const name = shipTo.name?.trim() || null
  const street = [shipTo.address?.trim(), shipTo.city?.trim()]
    .filter((s): s is string => !!s)
    .join(', ') || null
  return { name, street }
}
