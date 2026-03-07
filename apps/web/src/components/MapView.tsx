import { Business } from '@/data/businesses';
import type { Map as LeafletMap } from "leaflet";
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Briefcase } from 'lucide-react';
import { MutableRefObject, useEffect, useMemo } from 'react';
import { renderToString } from 'react-dom/server';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import BusinessCard from './BusinessCard';

interface MapViewProps {
  businesses: Business[];
  mapRef: MutableRefObject<LeafletMap | null>;
}

// Custom marker icon
const createCustomIcon = () => {
  const iconHtml = renderToString(
    <div className="custom-marker">
      <Briefcase size={16} />
    </div>
  );

  return L.divIcon({
    html: iconHtml,
    className: 'custom-div-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
};

// Component to fit map bounds to markers
const FitBounds = ({ businesses }: { businesses: Business[] }) => {
  const map = useMap();

  useEffect(() => {
    if (businesses.length === 0) {
      // Default view showing both Amsterdam and Utrecht
      map.fitBounds([
        [52.0800, 4.8500], // Southwest
        [52.4000, 5.1500], // Northeast
      ], { padding: [50, 50] });
    } else if (businesses.length === 1) {
      map.setView([businesses[0].lat, businesses[0].lng], 14);
    } else {
      const bounds = L.latLngBounds(
        businesses.map((b) => [b.lat, b.lng] as [number, number])
      );
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
    }
  }, [businesses, map]);

  return null;
};

const MapView = ({ businesses, mapRef }: MapViewProps) => {
  const customIcon = useMemo(() => createCustomIcon(), []);

  // Center between Amsterdam and Utrecht
  const defaultCenter: [number, number] = [52.23, 4.98];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={10}
      className="w-full h-full"
      zoomControl={false}
      ref={mapRef}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitBounds businesses={businesses} />
      {businesses.map((business) => (
        <Marker
          key={business.id}
          position={[business.lat, business.lng]}
          icon={customIcon}
        >
          <Popup>
            <BusinessCard business={business} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default MapView;
