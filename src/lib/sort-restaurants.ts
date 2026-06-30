export function sortSouthToNorth<T extends { location?: { lat: number } }>(
  restaurants: T[],
): T[] {
  return restaurants
    .map((restaurant, index) => ({ restaurant, index }))
    .sort((a, b) => {
      const aLat = a.restaurant.location?.lat;
      const bLat = b.restaurant.location?.lat;
      if (aLat === undefined && bLat === undefined) return a.index - b.index;
      if (aLat === undefined) return 1;
      if (bLat === undefined) return -1;
      if (aLat !== bLat) return aLat - bLat;
      return a.index - b.index;
    })
    .map(entry => entry.restaurant);
}
