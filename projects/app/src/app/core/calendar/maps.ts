/**
 * A place, on Google Maps: the search Maps opens for a place's words, by
 * Google's documented URL (`maps/search/?api=1&query=…`) — an address, a
 * venue's name, "Room 4" alike. Null for no place at all.
 */
export function mapsUrl(place: string): string | null {
  const query = place.trim();
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}
