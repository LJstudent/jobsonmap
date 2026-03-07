import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { cellToBoundary } from "h3-js";

// nerdview
// const areaPolygon = [
//   [52.1710, 5.0200], // NW - west of Maarssen
//   [52.1750, 5.2000], // N  - north of Bilthoven
//   [52.1350, 5.3000], // NE - east Zeist
//   [52.0400, 5.3300], // E  - east Driebergen
//   [51.9850, 5.2000], // SE - south Houten
//   [51.9800, 5.0200], // S  - south IJsselstein
//   [52.0400, 4.9300], // SW - west De Meern
//   [52.1200, 4.9500], // W  - west Maarssen
// ];

// const cells = polygonToCells(areaPolygon, 7);

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