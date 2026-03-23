export enum AnnotationType {
  CRASH = 'CRASH',
  WEATHER = 'WEATHER',
  SURFACE = 'SURFACE',
  HELMET = 'HELMET',
  GENERAL = 'GENERAL'
}

export interface GPSPoint {
  lat: number;
  lng: number;
  timestamp: number; // relative to video start in seconds
}

export interface Annotation {
  id: string;
  timestamp: number;
  formattedTime: string;
  type: AnnotationType;
  value: string;
  note: string;
  screenshot?: string;
  // AI analysis field removed to keep the project local
  location?: { lat: number, lng: number };
}

export interface SessionData {
  frontVideo: string | null;
  backVideo: string | null;
  gpsData: GPSPoint[];
}