import { useMemo, useRef, useState } from 'react';
import Header from '@/components/Header';
import MapView from '@/components/MapView';
import FloatingActions from '@/components/FloatingActions';
import Footer from '@/components/Footer';
import type { Map as LeafletMap } from "leaflet";
import { useBusinessesQuery } from '@/lib/businesses-api';

const Index = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const mapRef = useRef<LeafletMap | null>(null);
  const { data, isLoading, isError, error } = useBusinessesQuery();

  const filteredBusinesses = useMemo(() => {
    const businesses = data?.businesses ?? [];

    if (!searchQuery.trim()) {
      return businesses;
    }

    const query = searchQuery.toLowerCase();
    return businesses.filter(
      (business) =>
        business.name.toLowerCase().includes(query) ||
        business.city.toLowerCase().includes(query)
    );
  }, [data?.businesses, searchQuery]);

  return (
    <div className="h-full w-full relative overflow-hidden">
      <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <main className="h-full w-full">
        <MapView businesses={filteredBusinesses} mapRef={mapRef} />
      </main>

      {isLoading && (
        <div className="fixed top-20 left-4 z-[1000] rounded-md border border-border bg-background/90 px-3 py-2 text-sm text-muted-foreground backdrop-blur-sm">
          Loading businesses...
        </div>
      )}

      {isError && (
        <div className="fixed top-20 left-4 z-[1000] max-w-sm rounded-md border border-destructive/40 bg-background/90 px-3 py-2 text-sm text-destructive backdrop-blur-sm">
          {error instanceof Error ? error.message : 'Failed to load businesses'}
        </div>
      )}

      <FloatingActions
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />
      <Footer />
    </div>
  );
};

export default Index;
