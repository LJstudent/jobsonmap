import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { cellToBoundary } from "h3-js";

interface Props {
  cells: string[];
}

const H3HexLayer = ({ cells }: Props) => {
  const map = useMap();

  useEffect(() => {
    const layer = L.layerGroup().addTo(map);

    cells.forEach((cell) => {
      const boundary = cellToBoundary(cell);

      const latlngs = boundary.map((coord) => [coord[0], coord[1]] as [number, number]);

      L.polygon(latlngs, {
        color: "#ff0000",
        weight: 1,
        fillOpacity: 0.1,
      }).addTo(layer);
    });

    return () => {
      map.removeLayer(layer);
    };
  }, [cells, map]);

  return null;
};

export default H3HexLayer;