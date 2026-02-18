export interface Business {
  id: string;
  name: string;
  area: string;
  city: 'Amsterdam' | 'Utrecht';
  lat: number;
  lng: number;
  status: 'likely-hiring';
}

export const mockBusinesses: Business[] = [
  // Amsterdam businesses
  {
    id: '1',
    name: 'De Bakkerswinkel',
    area: 'De Pijp',
    city: 'Amsterdam',
    lat: 52.3547,
    lng: 4.8946,
    status: 'likely-hiring',
  },
  {
    id: '2',
    name: 'Café Restaurant Amsterdam',
    area: 'Jordaan',
    city: 'Amsterdam',
    lat: 52.3738,
    lng: 4.8822,
    status: 'likely-hiring',
  },
  {
    id: '3',
    name: 'Pluk',
    area: 'Centrum',
    city: 'Amsterdam',
    lat: 52.3676,
    lng: 4.8913,
    status: 'likely-hiring',
  },
  {
    id: '4',
    name: 'Coffee & Coconuts',
    area: 'De Pijp',
    city: 'Amsterdam',
    lat: 52.3521,
    lng: 4.8917,
    status: 'likely-hiring',
  },
  {
    id: '5',
    name: 'The Butcher',
    area: 'De Pijp',
    city: 'Amsterdam',
    lat: 52.3555,
    lng: 4.8920,
    status: 'likely-hiring',
  },
  {
    id: '6',
    name: 'Dignita',
    area: 'Oost',
    city: 'Amsterdam',
    lat: 52.3602,
    lng: 4.9163,
    status: 'likely-hiring',
  },
  {
    id: '7',
    name: 'Bar Spek',
    area: 'West',
    city: 'Amsterdam',
    lat: 52.3751,
    lng: 4.8667,
    status: 'likely-hiring',
  },
  {
    id: '8',
    name: 'Bakers & Roasters',
    area: 'De Pijp',
    city: 'Amsterdam',
    lat: 52.3538,
    lng: 4.8953,
    status: 'likely-hiring',
  },
  // Utrecht businesses
  {
    id: '9',
    name: 'Anne & Max',
    area: 'Centrum',
    city: 'Utrecht',
    lat: 52.0907,
    lng: 5.1214,
    status: 'likely-hiring',
  },
  {
    id: '10',
    name: 'Village Coffee & Music',
    area: 'Centrum',
    city: 'Utrecht',
    lat: 52.0894,
    lng: 5.1180,
    status: 'likely-hiring',
  },
  {
    id: '11',
    name: 'De Rechtbank',
    area: 'Oost',
    city: 'Utrecht',
    lat: 52.0912,
    lng: 5.1301,
    status: 'likely-hiring',
  },
  {
    id: '12',
    name: 'Broei',
    area: 'Lombok',
    city: 'Utrecht',
    lat: 52.0920,
    lng: 5.1067,
    status: 'likely-hiring',
  },
  {
    id: '13',
    name: 'Blackbird Coffee',
    area: 'Centrum',
    city: 'Utrecht',
    lat: 52.0885,
    lng: 5.1190,
    status: 'likely-hiring',
  },
  {
    id: '14',
    name: 'De Klub',
    area: 'Centrum',
    city: 'Utrecht',
    lat: 52.0878,
    lng: 5.1156,
    status: 'likely-hiring',
  },
];
