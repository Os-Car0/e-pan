export type PickupCoordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type PickupLocation = Readonly<{
  address: string;
  coordinates: PickupCoordinates | null;
}>;

// Official pickup location, maintained exclusively in code by the bakery.
// Coordinates confirmed by the bakery during implementation. Add any further
// address details here; never accept an official location from customer input.
export const pickupLocation: PickupLocation = Object.freeze({
  address: "Cuarta Privada de la Josefa Ortiz de Domínguez, número 510.",
  coordinates: Object.freeze({ latitude: 18.456784, longitude: -97.381228 }),
});

function verifiedCoordinates(location: PickupLocation) {
  const point = location.coordinates;
  if (
    !point ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 85.05112878 ||
    Math.abs(point.longitude) > 180
  ) return null;
  return point;
}

export function getPickupDirectionsUrl(location: PickupLocation = pickupLocation) {
  const point = verifiedCoordinates(location);
  const destination = point
    ? `${point.latitude},${point.longitude}`
    : location.address;
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({ api: "1", destination }).toString();
  return url.toString();
}

export function getPickupMapUrl(location: PickupLocation = pickupLocation) {
  const point = verifiedCoordinates(location);
  if (!point) return null;

  const { latitude, longitude } = point;
  const bounds = [
    Math.max(-180, longitude - 0.006),
    Math.max(-85.05112878, latitude - 0.004),
    Math.min(180, longitude + 0.006),
    Math.min(85.05112878, latitude + 0.004),
  ];
  const url = new URL("https://www.openstreetmap.org/export/embed.html");
  url.search = new URLSearchParams({
    bbox: bounds.join(","),
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  }).toString();
  return url.toString();
}
