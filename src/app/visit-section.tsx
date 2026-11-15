"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { getPickupDirectionsUrl, getPickupMapUrl, pickupLocation } from "@/lib/pickup-location";
import PickupDetails from "./pickup-details";

function PickupMap({ src }: { src: string | null }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!src || status !== "loading" || !containerRef.current) return;
    // Lazy frames may not start loading until scrolled into view. Start the
    // timeout only near the map, so reading the catalog cannot trigger an error.
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      timer = window.setTimeout(() => setStatus("error"), 15000);
      observer.disconnect();
    }, { rootMargin: "200px" });
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [src, status, attempt]);

  if (!src) {
    return (
      <div className="visit-map visit-map-pending">
        <MapPin size={36} strokeWidth={1.5} aria-hidden="true" />
        <h3>Estamos confirmando el punto exacto</h3>
        <p>La dirección de recogida ya está disponible. Publicaremos el mapa cuando la panadería confirme su ubicación.</p>
      </div>
    );
  }

  return (
    <div className="visit-map-container">
      <div className="visit-map" ref={containerRef} aria-busy={status === "loading"}>
        <iframe
          key={attempt}
          src={src}
          title={`Mapa del punto de recogida de E-Pan: ${pickupLocation.address}`}
          width="640"
          height="400"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
        {status !== "loaded" && (
          <div className="visit-map-message" role="status">
            <MapPin size={30} aria-hidden="true" />
            <p>{status === "loading" ? "Cargando mapa…" : "No pudimos cargar el mapa. Puedes abrir la ubicación en Google Maps."}</p>
            {status === "error" && (
              <button className="add" type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Reintentar mapa</button>
            )}
          </div>
        )}
      </div>
      {/* Cross-origin iframe errors cannot always be detected by the parent. */}
      <p className="visit-map-help">
        ¿No se muestra el mapa? <a href={getPickupDirectionsUrl()} target="_blank" rel="noopener noreferrer">Abrir en Google Maps<span className="sr-only"> (otra pestaña)</span></a>.
        {" "}Mapa: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© colaboradores de OpenStreetMap<span className="sr-only"> (otra pestaña)</span></a>.
      </p>
    </div>
  );
}

export default function VisitSection() {
  const mapUrl = getPickupMapUrl();
  return (
    <section className="section wrap visit-section" id="visitanos" aria-labelledby="visit-title" tabIndex={-1}>
      <div className="sectionHead">
        <div>
          <span className="eyebrow visit-eyebrow">Te esperamos</span>
          <h2 id="visit-title">Visítanos</h2>
          <p>Recoge aquí tu pan recién horneado</p>
        </div>
      </div>
      <div className="visit-card">
        <div className="visit-copy"><PickupDetails /></div>
        <PickupMap key={mapUrl ?? "pending"} src={mapUrl} />
      </div>
    </section>
  );
}
