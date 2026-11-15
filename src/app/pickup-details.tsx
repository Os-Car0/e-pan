import { MapPin, Navigation } from "lucide-react";
import { getPickupDirectionsUrl, getPickupMapUrl, pickupLocation } from "@/lib/pickup-location";

export default function PickupDetails() {
  return (
    <div className="pickup-details">
      <p className="pickup-label"><MapPin size={18} aria-hidden="true" /> Punto de recogida</p>
      <address>{pickupLocation.address}</address>
      <a className="primary pickup-directions" href={getPickupDirectionsUrl()} target="_blank" rel="noopener noreferrer">
        <Navigation size={17} aria-hidden="true" /> Cómo llegar
        <span className="sr-only"> (abre Google Maps en otra pestaña)</span>
      </a>
      {!getPickupMapUrl() && (
        <p className="pickup-note">Confirma el punto exacto con la panadería antes de salir. Google Maps buscará la dirección indicada.</p>
      )}
    </div>
  );
}
