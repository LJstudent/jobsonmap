export interface Business {
  id: string;
  name: string;
  area: string;
  city: 'Amsterdam' | 'Utrecht';
  lat: number;
  lng: number;
  status: 'likely-hiring';
}
