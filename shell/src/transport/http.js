// HTTP transport adapter — Sprint 2 builds this out.
// Emits requests over fetch + Server-Sent Events / WebSocket for live
// state. Mirrors the OMP wire protocol in shape, so swapping transports
// is a matter of changing the adapter.
export const httpTransport = { name: "http" };
