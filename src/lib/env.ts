// Environment flags. Single source of truth for runtime behavior that must
// differ between production and a dev/preview deployment.
//
// outboundEnabled gates every real-world send (transactional email + web push).
// It defaults to ON so production is unaffected; a dev environment that holds a
// COPY of production data sets CALLBOARD_OUTBOUND_ENABLED=false so triggering an
// estimate email or a tech push there can never reach the real customer/tech.
export const outboundEnabled = process.env.CALLBOARD_OUTBOUND_ENABLED !== 'false'
