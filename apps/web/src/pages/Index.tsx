import { useMemo, useRef, useState } from 'react';
import Header from '@/components/Header';
import MapView from '@/components/MapView';
import FloatingActions from '@/components/FloatingActions';
import Footer from '@/components/Footer';
import { mockBusinesses } from '@/data/businesses';
import type { Map as LeafletMap } from "leaflet";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const mapRef = useRef<LeafletMap | null>(null);

  const filteredBusinesses = useMemo(() => {
    if (!searchQuery.trim()) {
      return mockBusinesses;
    }

    const query = searchQuery.toLowerCase();
    return mockBusinesses.filter(
      (business) =>
        business.name.toLowerCase().includes(query) ||
        business.area.toLowerCase().includes(query) ||
        business.city.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  return (
    <div className="h-full w-full relative overflow-hidden">
      <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <main className="h-full w-full">
        <MapView businesses={filteredBusinesses} mapRef={mapRef} />
      </main>

      <FloatingActions
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />
      <Footer />
    </div>
  );
};

export default Index;
