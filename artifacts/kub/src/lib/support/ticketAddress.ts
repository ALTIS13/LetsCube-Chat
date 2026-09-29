/**
 * Which support ticket the address has open (D-143).
 *
 * The address is the only copy of the selection: `SupportTab` reads it to show
 * the ticket, and `AdminLayout` reads it to know that, on a phone, the ticket
 * is a page of its own and the administration's chrome steps aside. One reader,
 * so the two can never disagree about whether a ticket is open.
 */
const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readSupportTicketFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("ticket");
  return value && TICKET_ID.test(value) ? value : null;
}
